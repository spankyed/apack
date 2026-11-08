import { writeInstalledPackFixture } from './runtime/build-fixture.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_RECORD_RECOVERY, prepareHostDataDirs, recoverStagingDirs } from '../../src/packs/staging.ts';
import { stagingDirName } from '../../src/replace-dir.ts';
import { readInstalledPackBuild, discoverPacks } from '../../src/packs/discovery.ts';
import { readInstalledPacks, writeInstalledPacks } from '../../src/packs/installed.ts';

const recordedPacks = () => readInstalledPacks();

import { readHostCompatibility } from '../../src/packs/host-info.ts';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { execFileWhileWorking } from '@apackdev/sdk/progress';


let root: string;
let packsDir: string;
const env = { APACK_ENV: process.env.APACK_ENV, APACK_USER_DATA_DIR: process.env.APACK_USER_DATA_DIR };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-'));
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = root;
  packsDir = path.join(root, 'packs');
  fs.mkdirSync(packsDir);
});
afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.chmodSync(packsDir, 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

const exitedPid = async () => {
  const exited = execFileWhileWorking(process.execPath, ['-e', '']);
  await exited;
  return exited.child.pid!;
};
const mkdir = (name: string) => fs.mkdirSync(path.join(packsDir, name));
const remaining = () => fs.readdirSync(packsDir).sort();

function writePack(name: string, id = 'demo-pack'): void {
  writeInstalledPackFixture(path.join(packsDir, name), { id, name: 'Demo', version: '1.0.0' });
}

describe('recoverStagingDirs', () => {
  it("removes staging dirs whose process is gone and keeps another process's install in progress", async () => {
    const exited = await exitedPid();
    const running = process.ppid;
    mkdir('demo-pack');
    mkdir(`.demo-pack.installing-${exited}-a1B2c3`);
    mkdir(`.demo-pack.retired-${exited}-9f8e7d6c`);
    mkdir(`.base-pack.installing-${exited}`);
    mkdir(`.other-pack.installing-${running}-d4E5f6`);
    mkdir(`.other-pack.previous-${process.pid}-0a1b2c3d`);

    const result = recoverStagingDirs(packsDir);
    expect(result.removed.sort()).toEqual([
      `.base-pack.installing-${exited}`,
      `.demo-pack.installing-${exited}-a1B2c3`,
      `.demo-pack.retired-${exited}-9f8e7d6c`,
    ]);
    expect(result.restored).toEqual([]);
    expect(remaining()).toEqual([`.other-pack.installing-${running}-d4E5f6`, `.other-pack.previous-${process.pid}-0a1b2c3d`, 'demo-pack'].sort());
  });

  it('restores a pack whose install crashed between moving it aside and placing the new copy, and keeps it enabled', async () => {
    writePack('demo-pack');
    writeInstalledPacks([{ id: 'demo-pack', enabled: true }]);
    // The crash: the old copy moved aside, the new one never placed
    fs.renameSync(path.join(packsDir, 'demo-pack'), path.join(packsDir, `.demo-pack.previous-${await exitedPid()}-1a2b3c4d`));
    mkdir(`.demo-pack.installing-${await exitedPid()}-x1Y2z3`);

    expect(recoverStagingDirs(packsDir)).toMatchObject({ restored: ['demo-pack'], failed: [] });
    expect(remaining()).toEqual(['demo-pack']);
    expect(discoverPacks(packsDir).map((p) => p.manifest.id)).toEqual(['demo-pack']);
    expect(recordedPacks()).toMatchObject([{ id: 'demo-pack', enabled: true }]);
  });

  it('leaves a directory whose name carries no process id', () => {
    mkdir('.other-pack.installing-Xy12Zw');

    expect(recoverStagingDirs(packsDir)).toMatchObject({ restored: [], removed: [], failed: [] });
    expect(remaining()).toEqual(['.other-pack.installing-Xy12Zw']);
  });

  it("treats a dir written before this boot as stale, whatever process holds its id now", () => {
    // A crashed install's dir whose PID a running process now has: only its age says the install is gone
    const reused = process.ppid;
    mkdir(`.demo-pack.installing-${reused}-a1B2c3`);
    const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 60_000);
    fs.utimesSync(path.join(packsDir, `.demo-pack.installing-${reused}-a1B2c3`), beforeBoot, beforeBoot);

    expect(recoverStagingDirs(packsDir)).toMatchObject({ removed: [`.demo-pack.installing-${reused}-a1B2c3`], failed: [] });
    expect(remaining()).toEqual([]);
  });

  it("restores an interrupted install's copy whatever the record says about the pack", async () => {
    writePack(`.demo-pack.previous-${await exitedPid()}-1a2b3c4d`);
    writeInstalledPacks([]);

    expect(recoverStagingDirs(packsDir)).toMatchObject({ restored: ['demo-pack'], failed: [] });
    expect(remaining()).toEqual(['demo-pack']);
  });

  // Deleting an interrupted install's only copy is the bug this function exists to avoid; it once did
  // exactly that, on the first boot after installed-packs.json was renamed away.
  it.each([
    ['there is no record of what is installed', () => {}],
    ['the record cannot be parsed', () => fs.writeFileSync(path.join(root, 'installed-packs.json'), 'not json')],
  ])('restores every interrupted install when %s', async (_how, makeRecordUnreadable) => {
    writePack(`.demo-pack.previous-${await exitedPid()}-1a2b3c4d`);
    makeRecordUnreadable();

    prepareHostDataDirs({ userDataDir: root, packsDir, version: '0.3.14' });

    expect(remaining()).toEqual(['demo-pack']);
  });

  it('ignores a packs dir that does not exist yet', () => {
    expect(recoverStagingDirs(path.join(packsDir, 'missing'))).toEqual({ restored: [], removed: [], failed: [] });
  });

  it('names staging dirs uniquely per process and call, in the owned format', () => {
    const name = stagingDirName('demo-pack', 'previous');
    expect(name).toMatch(new RegExp(`^\\.demo-pack\\.previous-${process.pid}-[0-9a-f]{8}$`));
    expect(stagingDirName('demo-pack', 'previous')).not.toBe(name);
  });
});

describe('prepareHostDataDirs', () => {
  it('logs instead of failing when staging dirs or host.json cannot be written', async () => {
    const staging = `.demo-pack.installing-${await exitedPid()}-a1B2c3`;
    mkdir(staging);
    fs.writeFileSync(path.join(packsDir, staging, 'file'), '');
    fs.chmodSync(packsDir, 0o555);
    const log = { info: vi.fn(), warn: vi.fn() };

    expect(() => prepareHostDataDirs({ userDataDir: path.join(packsDir, 'unwritable'), packsDir, version: '1.0.0' }, log)).not.toThrow();
    expect(log.warn.mock.calls.flat().join('\n')).toMatch(/Could not record the host version[\s\S]*Could not clean up \.demo-pack\.installing-/);
  });

  it('records the host version and the pack format it reads, atomically', () => {
    prepareHostDataDirs({ userDataDir: root, packsDir, version: '2.1.0' }, { info: vi.fn(), warn: vi.fn() });
    expect(readHostCompatibility(root)).toEqual({ version: '2.1.0', packFormat: PACK_SNAPSHOT_FORMAT });
    expect(fs.readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});


it('restores the previous build and its ownership after interrupted candidate acceptance', async () => {
  const previous = `.demo-pack.previous-${await exitedPid()}-a1b2c3`;
  writePack(previous);
  writePack('demo-pack');
  fs.writeFileSync(path.join(packsDir, 'demo-pack', 'candidate'), 'not accepted');
  const file = path.join(root, 'installed-packs.json');
  const old = { id: 'demo-pack', enabled: false, updatesWith: 'user' as const, installedFrom: 'old/source' };
  writeInstalledPacks([old], path.join(packsDir, previous, INSTALL_RECORD_RECOVERY));
  writeInstalledPacks([{ id: 'demo-pack', enabled: true, suppressAppInstall: true }, { id: 'other', enabled: false }], file);
  expect(() => readInstalledPackBuild(path.join(packsDir, 'demo-pack'))).toThrow('Interrupted replacement');
  expect(recoverStagingDirs(packsDir, file)).toMatchObject({ restored: ['demo-pack'], failed: [] });
  expect(fs.existsSync(path.join(packsDir, 'demo-pack', 'candidate'))).toBe(false);
  expect(readInstalledPackBuild(path.join(packsDir, 'demo-pack')).snapshot.manifest.id).toBe('demo-pack');
  expect(readInstalledPacks(file)).toEqual([{ id: 'other', enabled: false }, old]);
  expect(remaining()).toEqual(['demo-pack']);
});

it('preserves an ambiguous recovery and refuses to load its candidate', async () => {
  const pid = await exitedPid();
  const previous = [`.demo-pack.previous-${pid}-a1b2c3`, `.demo-pack.previous-${pid}-d4e5f6`];
  for (const name of previous) writePack(name);
  writePack('demo-pack');
  const result = recoverStagingDirs(packsDir);
  expect(result.failed).toHaveLength(2);
  expect(result.removed).toEqual([]);
  expect(remaining()).toEqual([...previous, 'demo-pack'].sort());
  expect(() => readInstalledPackBuild(path.join(packsDir, 'demo-pack'))).toThrow('Interrupted replacement');
});


it('keeps an incumbent when recovery fails and never sweeps it as litter', async () => {
  const previous = `.demo-pack.previous-${await exitedPid()}-a1b2c3`;
  writePack(previous);
  writePack('demo-pack');
  fs.chmodSync(packsDir, 0o555);
  const result = recoverStagingDirs(packsDir);
  expect(result.failed).toMatchObject([{ name: previous }]);
  expect(result.removed).toEqual([]);
  expect(fs.existsSync(path.join(packsDir, previous))).toBe(true);
  expect(() => readInstalledPackBuild(path.join(packsDir, 'demo-pack'))).toThrow('Interrupted replacement');
});

it('leaves the restored build verifiable when a refused install cannot restore its record', async () => {
  const { installPackFromLocal } = await import('../../src/packs/installer.ts');
  const { verifyPack } = await import('../../src/packs/assets.ts');
  const source = path.join(root, 'source');
  writeInstalledPackFixture(source, { id: 'demo-pack', name: 'Demo', version: '1.0.0' });
  const recordsDir = path.join(root, 'records');
  fs.mkdirSync(recordsDir);
  const installedPacksFile = path.join(recordsDir, 'installed-packs.json');
  await installPackFromLocal(source, packsDir, { installedPacksFile });
  try {
    await expect(installPackFromLocal(source, packsDir, { installedPacksFile, accept: () => {
      // Restoring the record now fails, as a full or read-only disk would make it
      fs.chmodSync(recordsDir, 0o555);
      throw new Error('acceptance refused');
    } })).rejects.toThrow('record rollback failed');
  } finally { fs.chmodSync(recordsDir, 0o755); }
  expect(() => verifyPack(path.join(packsDir, 'demo-pack'))).not.toThrow();
  expect(remaining()).toEqual(['demo-pack']);
});
