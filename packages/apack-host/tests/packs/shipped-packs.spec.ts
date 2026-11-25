import { sealBuild } from './runtime/build-fixture.ts';
import { _declarationRevision } from '@apackdev/pack-format';
// The packs the app ships are installed packs: the boot installs them into the data dir, so there is one
// kind of pack on disk and one load path to it. What this pins is when the boot writes and when it does not
// — unchanged app-managed installs stay untouched, and user-owned copies or removals survive refresh.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installShippedPacks, installPackFromLocal, uninstallPack, restoreShippedPack, updateShippedPack } from '../../src/packs/installer.ts';
import { PACK_LAYOUT, readPackIntegrity, readPackBuild, stagePack, verifyPack } from '../../src/packs/layout.ts';
import { readInstalledPacks, writeInstalledPacks, forgetPacksExcept } from '../../src/packs/installed.ts';
import { registry } from './runtime/test-host.ts';
import { loadAppPacks } from '../../src/packs/runtime/loader.ts';
import { reloadPackById } from '../../src/packs/runtime/reload.ts';
import { readAppPackSources } from '../../src/packs/app-sources.ts';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';

let tmp: string;
let shipped: string;
let packsDir: string;
let installedPacksFile: string;
const recordsFile = () => installedPacksFile;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-packs-'));
  shipped = path.join(tmp, 'resources', 'packages');
  packsDir = path.join(tmp, 'data', 'packs');
  installedPacksFile = path.join(tmp, 'data', 'installed-packs.json');
  fs.mkdirSync(shipped, { recursive: true });
  fs.mkdirSync(packsDir, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A pack as the app ships one: its manifest and its `dist/`, unstaged — which is what `files` carries */
function shipPack(id: string, runtime = `exports.registration = { id: ${JSON.stringify(id)} };`, manifest = {}): string {
  const dir = path.join(shipped, id);
  fs.mkdirSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeDir), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist', PACK_LAYOUT.typesDir), { recursive: true });
  fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify({ id, name: id, version: '1.0.0', ...manifest }));
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeEntry), runtime + `\nif (exports.registration) exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf8')))}';`);
  sealBuild(dir);
  return dir;
}

const outcomes = async () => (await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() })).map((r) => `${r.id}=${r.outcome}`);

describe('installing the packs the app ships', () => {
  it('installs into the packs dir, in the pack layout, on a first boot', async () => {
    shipPack('shipped-pack');

    expect(await outcomes()).toEqual(['shipped-pack=installed']);

    // A real installed pack, not a copy of the shipped directory: staged, with the integrity that verifies it
    const installed = path.join(packsDir, 'shipped-pack');
    expect(fs.readdirSync(installed).sort()).toEqual([PACK_LAYOUT.manifest, PACK_LAYOUT.integrity, PACK_LAYOUT.runtimeDir, PACK_LAYOUT.typesDir].sort());
    expect(readPackIntegrity(installed).id).toBe('shipped-pack');
    expect(readInstalledPacks(recordsFile(), { strict: true })).toMatchObject([{
      id: 'shipped-pack', updatesWith: 'app', shippedRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
  });

  // The reason the comparison is over content: a boot that re-installed every time would rewrite the pack's
  // directory on every start, and `placePack` renames a fresh copy in, so every file's mtime would move
  it('writes nothing on a second boot', async () => {
    shipPack('shipped-pack');
    await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() });
    const before = fs.statSync(path.join(packsDir, 'shipped-pack', PACK_LAYOUT.integrity)).mtimeMs;

    expect(await outcomes()).toEqual(['shipped-pack=unchanged']);
    expect(fs.statSync(path.join(packsDir, 'shipped-pack', PACK_LAYOUT.integrity)).mtimeMs).toBe(before);
  });

  // A version bump is the ordinary cause. A user who edited an installed file is the other, and it could not
  // happen while a shipped pack was loaded from `resources/` in place
  it('re-installs when the shipped copy differs from the installed one', async () => {
    const dir = shipPack('shipped-pack');
    await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() });

    fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeEntry), 'exports.registration = { id: "shipped-pack", v: 2 };');
    sealBuild(dir);
    expect(await outcomes()).toEqual(['shipped-pack=updated']);
    expect(fs.readFileSync(path.join(packsDir, 'shipped-pack', PACK_LAYOUT.runtimeEntry), 'utf-8')).toContain('v: 2');
  });

  it('leaves local edits untouched when the shipped source has not changed', async () => {
    shipPack('shipped-pack');
    await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() });
    fs.writeFileSync(path.join(packsDir, 'shipped-pack', PACK_LAYOUT.runtimeEntry), '// a user got in here');

    expect(await outcomes()).toEqual(['shipped-pack=unchanged']);
    expect(() => verifyPack(path.join(packsDir, 'shipped-pack'))).toThrow();
    expect(fs.readFileSync(path.join(packsDir, 'shipped-pack', PACK_LAYOUT.runtimeEntry), 'utf-8')).toBe('// a user got in here');
  });

  it.each(['missing', 'malformed', 'wrong-owner', 'extra-link'])('does not repair invalid installed files at boot; build admission reports the defect: %s', async kind => {
    shipPack('shipped-pack');
    await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() });
    const dir = path.join(packsDir, 'shipped-pack');
    const file = path.join(dir, PACK_LAYOUT.integrity);
    if (kind === 'missing') fs.rmSync(file);
    else if (kind === 'malformed') fs.writeFileSync(file, '{}');
    else if (kind === 'wrong-owner') fs.writeFileSync(file, JSON.stringify({ ...readPackIntegrity(dir), id: 'other-pack' }));
    else fs.symlinkSync('index.cjs', path.join(dir, PACK_LAYOUT.runtimeDir, 'link.cjs'));
    expect(await outcomes()).toEqual(['shipped-pack=unchanged']);
    expect(() => readPackBuild(dir)).toThrow();
    if (kind === 'extra-link') expect(fs.existsSync(path.join(dir, PACK_LAYOUT.runtimeDir, 'link.cjs'))).toBe(true);
  });

  // Reported rather than thrown, and **not** loaded from `resources/` instead: a read-only second load path
  // is what this change removed, so a pack the app could not install is a pack that is not there
  it('reports a shipped directory that is not a built pack, naming what it lacks', async () => {
    const dir = path.join(shipped, 'unbuilt-pack');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify({ id: 'unbuilt-pack', name: 'Unbuilt', version: '1.0.0' }));

    const [result] = await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() });
    expect(result).toMatchObject({ id: 'unbuilt-pack', outcome: 'failed' });
    expect(result!.error).toContain(`dist/${PACK_LAYOUT.runtimeEntry}`);
    expect(fs.existsSync(path.join(packsDir, 'unbuilt-pack'))).toBe(false);
  });

  it('installs the other packs when one of them fails', async () => {
    shipPack('good-pack');
    fs.mkdirSync(path.join(shipped, 'bad-pack'), { recursive: true });
    fs.writeFileSync(path.join(shipped, 'bad-pack', PACK_LAYOUT.manifest), JSON.stringify({ id: 'bad-pack', name: 'Bad', version: '1.0.0' }));

    expect((await outcomes()).sort()).toEqual(['bad-pack=failed', 'good-pack=installed']);
  });

  it('is nothing to do when the app ships no packs directory', async () => {
    expect(await installShippedPacks(path.join(tmp, 'nowhere'), packsDir, { installedPacksFile: recordsFile() })).toEqual([]);
  });

  it('skips a directory that is not a pack, and the staging dirs an interrupted install leaves', async () => {
    shipPack('shipped-pack');
    fs.mkdirSync(path.join(shipped, 'not-a-pack'), { recursive: true });
    fs.mkdirSync(path.join(shipped, '.shipped-pack.installing-123'), { recursive: true });

    expect(await outcomes()).toEqual(['shipped-pack=installed']);
  });
});


describe('explicit installation ownership', () => {
  it('refuses a wrong restore identity without changing either namespace or the incumbent', async () => {
    shipPack('shipped-pack');
    await outcomes();
    const before = readPackBuild(path.join(packsDir, 'shipped-pack'));
    const records = readInstalledPacks(recordsFile(), { strict: true });
    const other = shipPack('other-pack');
    await expect(restoreShippedPack('shipped-pack', other, packsDir, { installedPacksFile: recordsFile() }))
      .rejects.toThrow('Restore expected pack');
    expect(readPackBuild(path.join(packsDir, 'shipped-pack'))).toEqual(before);
    expect(fs.existsSync(path.join(packsDir, 'other-pack'))).toBe(false);
    expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual(records);
  });

  it('keeps removal suppression when explicit restoration is refused', async () => {
    const source = shipPack('shipped-pack');
    await outcomes();
    await uninstallPack('shipped-pack', packsDir, { installedPacksFile: recordsFile() });
    const before = readInstalledPacks(recordsFile(), { strict: true });
    await expect(restoreShippedPack('shipped-pack', source, packsDir, {
      installedPacksFile: recordsFile(), accept: () => { throw new Error('restore refused'); },
    })).rejects.toThrow('restore refused');
    expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual(before);
    expect(fs.existsSync(path.join(packsDir, 'shipped-pack'))).toBe(false);
    expect(await outcomes()).toEqual(['shipped-pack=suppressed']);
  });

  it('reports a non-directory installation path without overwriting it', async () => {
    shipPack('shipped-pack');
    const file = path.join(packsDir, 'shipped-pack');
    fs.writeFileSync(file, 'user-owned file');
    expect(await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() }))
      .toMatchObject([{ outcome: 'failed', error: expect.stringContaining('not a directory') }]);
    expect(fs.readFileSync(file, 'utf8')).toBe('user-owned file');
    expect(fs.existsSync(recordsFile())).toBe(false);
  });

  it('records the selected app source without retaining an unrelated remote update source', async () => {
    shipPack('shipped-pack');
    writeInstalledPacks([{ id: 'shipped-pack', enabled: false, installedFrom: 'old/repo',
      availableVersion: '3.0.0', availableTag: 'v3.0.0', updateCheckError: 'old failure',
    }], recordsFile());
    expect(await outcomes()).toEqual(['shipped-pack=installed']);
    const record = readInstalledPacks(recordsFile(), { strict: true })[0];
    expect(record).toMatchObject({ enabled: false, updatesWith: 'app' });
    for (const key of ['installedFrom', 'availableVersion', 'availableTag', 'updateCheckError']) {
      expect(record).not.toHaveProperty(key);
    }
  });

  it('does not adopt an unrecorded build, even when its bytes equal the app build', async () => {
    const source = shipPack('shipped-pack');
    stagePack(source, path.join(packsDir, 'shipped-pack'));
    const before = readPackBuild(path.join(packsDir, 'shipped-pack'));
    expect(await outcomes()).toEqual(['shipped-pack=preserved']);
    fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.runtimeEntry), 'exports.registration = { id: "shipped-pack", changed: true };');
    sealBuild(source);
    expect(await outcomes()).toEqual(['shipped-pack=preserved']);
    expect(readPackBuild(path.join(packsDir, 'shipped-pack'))).toEqual(before);
    expect(fs.existsSync(recordsFile())).toBe(false);
  });

  it('preserves a recorded user fork across a shipped rebuild and an id-specific refresh', async () => {
    const source = shipPack('shipped-pack');
    await outcomes();
    const fork = path.join(tmp, 'fork');
    fs.cpSync(source, fork, { recursive: true });
    fs.writeFileSync(path.join(fork, 'dist', PACK_LAYOUT.runtimeEntry), 'exports.registration = { id: "shipped-pack", fork: true };');
    sealBuild(fork);
    await installPackFromLocal(fork, packsDir, { installedPacksFile: recordsFile() });
    expect(readInstalledPacks(recordsFile())[0]).toMatchObject({ updatesWith: 'user' });
    expect(readInstalledPacks(recordsFile())[0]).not.toHaveProperty('shippedRevision');
    const before = readPackBuild(path.join(packsDir, 'shipped-pack'));
    fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.runtimeEntry), 'exports.registration = { id: "shipped-pack", changed: true };');
    sealBuild(source);
    expect(await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile(), only: 'shipped-pack' }))
      .toEqual([{ id: 'shipped-pack', outcome: 'preserved' }]);
    expect(readPackBuild(path.join(packsDir, 'shipped-pack'))).toEqual(before);
  });

  it('restores app ownership when a proposed user installation is refused', async () => {
    const source = shipPack('shipped-pack');
    await outcomes();
    const before = readPackBuild(path.join(packsDir, 'shipped-pack'));
    const records = readInstalledPacks(recordsFile(), { strict: true });
    await expect(installPackFromLocal(source, packsDir, { installedPacksFile: recordsFile(), accept: () => {
      expect(readInstalledPacks(recordsFile())[0].updatesWith).toBe('user');
      throw new Error('runtime refused');
    } })).rejects.toThrow('runtime refused');
    expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual(records);
    expect(readPackBuild(path.join(packsDir, 'shipped-pack'))).toEqual(before);
  });

  it('retains disabled intent through an app-managed refresh', async () => {
    const source = shipPack('shipped-pack');
    await outcomes();
    writeInstalledPacks(readInstalledPacks(recordsFile()).map(record => ({ ...record, enabled: false })), recordsFile());
    fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.runtimeEntry), 'exports.registration = { id: "shipped-pack", changed: true };');
    sealBuild(source);
    expect(await outcomes()).toEqual(['shipped-pack=updated']);
    expect(readInstalledPacks(recordsFile())[0]).toMatchObject({ enabled: false, updatesWith: 'app' });
  });

  it('keeps deliberate removal suppressed across pruning and repeated boots', async () => {
    shipPack('shipped-pack');
    await outcomes();
    await uninstallPack('shipped-pack', packsDir, { installedPacksFile: recordsFile() });
    expect(forgetPacksExcept(new Set(), recordsFile())).toBe(true);
    expect(await outcomes()).toEqual(['shipped-pack=suppressed']);
    expect(await outcomes()).toEqual(['shipped-pack=suppressed']);
    expect(fs.existsSync(path.join(packsDir, 'shipped-pack'))).toBe(false);
    expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual([
      { id: 'shipped-pack', enabled: true, suppressAppInstall: true },
    ]);
  });

  it('restores build and ownership records when candidate acceptance refuses', async () => {
    const source = shipPack('shipped-pack');
    await outcomes();
    const before = readPackBuild(path.join(packsDir, 'shipped-pack'));
    const records = readInstalledPacks(recordsFile(), { strict: true });
    fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.runtimeEntry), 'exports.registration = { id: "shipped-pack", changed: true };');
    sealBuild(source);
    const accept = vi.fn(() => { throw new Error('runtime refused'); });
    expect(await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile(), accept }))
      .toMatchObject([{ outcome: 'failed', error: 'runtime refused' }]);
    expect(accept).toHaveBeenCalledOnce();
    expect(readPackBuild(path.join(packsDir, 'shipped-pack'))).toEqual(before);
    expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual(records);
  });

  it('does not publish files when installation intent cannot be saved', async () => {
    shipPack('shipped-pack');
    fs.mkdirSync(recordsFile());
    expect(await outcomes()).toEqual(['shipped-pack=failed']);
    expect(fs.existsSync(path.join(packsDir, 'shipped-pack'))).toBe(false);
  });

  it('keeps the incumbent build and record when saving the new ownership revision fails', async () => {
    const source = shipPack('shipped-pack');
    await outcomes();
    const before = readPackBuild(path.join(packsDir, 'shipped-pack'));
    const records = readInstalledPacks(recordsFile(), { strict: true });
    fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.runtimeEntry), 'exports.registration = { id: "shipped-pack", changed: true };');
    sealBuild(source);
    const parent = path.dirname(recordsFile());
    fs.chmodSync(parent, 0o500);
    try {
      expect(await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile() }))
        .toMatchObject([{ outcome: 'failed', error: expect.stringContaining('Cannot save installation decisions') }]);
      expect(readPackBuild(path.join(packsDir, 'shipped-pack'))).toEqual(before);
      expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual(records);
    } finally { fs.chmodSync(parent, 0o700); }
  });

  it('refuses a first candidate without leaving ownership or build behind', async () => {
    shipPack('shipped-pack');
    expect(await installShippedPacks(shipped, packsDir, { installedPacksFile: recordsFile(), accept: () => {
      throw new Error('candidate refused');
    } })).toMatchObject([{ outcome: 'failed', error: 'candidate refused' }]);
    expect(fs.existsSync(recordsFile())).toBe(false);
    expect(fs.existsSync(path.join(packsDir, 'shipped-pack'))).toBe(false);
  });

  it('restores prior records after filesystem deletion fails', async () => {
    shipPack('shipped-pack');
    await outcomes();
    const before = readInstalledPacks(recordsFile(), { strict: true });
    const dir = path.join(packsDir, 'shipped-pack');
    fs.chmodSync(dir, 0o500);
    try {
      await expect(uninstallPack('shipped-pack', packsDir, { installedPacksFile: recordsFile() })).rejects.toThrow();
      expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual(before);
    } finally { fs.chmodSync(dir, 0o700); }
  });
});


it('preserves the running app-owned build, catalog and record when a shipped reload collides', async () => {
  const previousEnv = { env: process.env.APACK_ENV, data: process.env.APACK_USER_DATA_DIR, shipped: process.env.SHIPPED_PACKS_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = path.join(tmp, 'profile');
  process.env.SHIPPED_PACKS_DIR = shipped;
  const context = resolveAppEnvironment();
  packsDir = context.packsDir;
  installedPacksFile = context.installedPacksFile;
  const id = 'shipped-pack';
  const bus = { send: vi.fn() };
  try {
    shipPack(id);
    expect(await outcomes()).toEqual([`${id}=installed`]);
    loadAppPacks(registry);
    const previousRegistration = registry.getPackRegistration(id);
    const previousRuntime = registry.getPackRuntime(id);
    const previousBuild = readPackBuild(path.join(packsDir, id));
    const previousCatalog = registry.catalog.getSnapshot();
    const previousRecords = readInstalledPacks(recordsFile(), { strict: true });
    registry.registerPack({ id: 'collision-owner', services: { taken: {} } });
    shipPack(id, `exports.registration = { id: '${id}', services: { taken: {} } };`, {
      extensions: { services: { taken: 'service.ts#taken' } },
    });
    await expect(reloadPackById(registry, id, bus as never)).rejects.toThrow('Service collision');
    expect(registry.getPackRegistration(id)).toBe(previousRegistration);
    expect(registry.getPackRuntime(id)).toEqual(previousRuntime);
    expect(readPackBuild(path.join(packsDir, id))).toEqual(previousBuild);
    expect(registry.catalog.getSnapshot().packs).toEqual(previousCatalog.packs);
    expect(readInstalledPacks(recordsFile(), { strict: true })).toEqual(previousRecords);
    expect(bus.send).not.toHaveBeenCalled();
  } finally {
    for (const packId of [id, 'collision-owner']) if (registry.getPackRegistration(packId)) registry.unregisterPack(packId);
    if (previousEnv.env === undefined) delete process.env.APACK_ENV;
    else process.env.APACK_ENV = previousEnv.env;
    if (previousEnv.data === undefined) delete process.env.APACK_USER_DATA_DIR;
    else process.env.APACK_USER_DATA_DIR = previousEnv.data;
    if (previousEnv.shipped === undefined) delete process.env.SHIPPED_PACKS_DIR;
    else process.env.SHIPPED_PACKS_DIR = previousEnv.shipped;
  }
});


it('refuses an app update when ownership changes during preparation, retaining incumbent bytes', async () => {
  const dir = shipPack('shipped-pack');
  await installShippedPacks(shipped, packsDir, { installedPacksFile });
  const before = readPackBuild(path.join(packsDir, 'shipped-pack')).revision;
  fs.appendFileSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeEntry), '\n// update');
  sealBuild(dir);
  const source = readAppPackSources(shipped).sources[0];
  await expect(updateShippedPack('shipped-pack', dir, packsDir, {
    installedPacksFile, expectedSourceRevision: source.sourceRevision,
    beforePlace: () => { writeInstalledPacks([{ id: 'shipped-pack', enabled: false, updatesWith: 'user' }], installedPacksFile); },
  })).rejects.toThrow('no longer app-managed');
  expect(readPackBuild(path.join(packsDir, 'shipped-pack')).revision).toBe(before);
  expect(readInstalledPacks(installedPacksFile, { strict: true })).toEqual([{ id: 'shipped-pack', enabled: false, updatesWith: 'user' }]);
});


it('refreshes a disabled app-owned build without loading or initializing its runtime', async () => {
  vi.stubEnv('APACK_ENV', 'test');
  vi.stubEnv('APACK_USER_DATA_DIR', path.join(tmp, 'disabled-profile'));
  vi.stubEnv('SHIPPED_PACKS_DIR', shipped);
  try {
    const context = resolveAppEnvironment();
    packsDir = context.packsDir;
    installedPacksFile = context.installedPacksFile;
    shipPack('disabled-pack');
    await outcomes();
    writeInstalledPacks(readInstalledPacks(recordsFile()).map(record => ({ ...record, enabled: false })), recordsFile());
    const marker = path.join(tmp, 'executed');
    shipPack('disabled-pack', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); exports.registration = { id: 'disabled-pack' };`);
    const bus = { send: vi.fn() };
    await reloadPackById(registry, 'disabled-pack', bus as never);
    expect(fs.readFileSync(path.join(packsDir, 'disabled-pack', PACK_LAYOUT.runtimeEntry), 'utf8')).toContain(marker);
    expect(fs.existsSync(marker)).toBe(false);
    expect(registry.getPackRegistration('disabled-pack')).toBeNull();
    expect(registry.catalog.get('disabled-pack')?.enabled).toBe(false);
    expect(bus.send.mock.calls.map(([event]) => event.type)).toEqual(['PACK_CHANGED']);
  } finally { vi.unstubAllEnvs(); }
});
