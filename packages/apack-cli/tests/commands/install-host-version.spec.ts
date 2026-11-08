import { _declarationRevision } from '@apackdev/sdk/build';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordHostCompatibility, sealPackBuild } from '@apackdev/host/packs';
import { install } from '../../src/commands/pack-install';
import { uninstall } from '../../src/commands/pack-uninstall';
import { publishRunningApp, findDatabaseWriter } from '@apackdev/host/database';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { _appDirOf } from '@apackdev/sdk/env';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-host-version-'));
  vi.stubEnv('APACK_USER_DATA_DIR', path.join(tmp, 'data'));
  vi.stubEnv('APACK_HOST_ROOT', path.join(tmp, 'host'));
  vi.stubEnv('APACK_HOST_EXECUTABLE', '');
  fs.mkdirSync(path.join(tmp, 'host', 'packages'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A pack dir as `apack pack build` leaves it. */
function builtPack(hostVersion: string): string {
  const root = path.join(tmp, 'pack');
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('apack.json', JSON.stringify({ id: 'demo-pack', name: 'Demo Pack', version: '1.0.0', hostVersion }));
  write('dist/runtime/index.cjs', 'module.exports = { registration: { id: "demo-pack" } };');
  write('dist/types/snapshot.json', JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  sealPackBuild(path.join(root, 'dist'), JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf8')));
  return root;
}

describe('apack pack install', () => {
  it('refuses install and uninstall while the selected app is running, preserving installed files', async () => {
    const source = builtPack('>=0.3.0');
    const data = path.join(tmp, 'data');
    await install([source]);
    const manifest = path.join(_appDirOf(data), 'packs', 'demo-pack', 'apack.json');
    const before = fs.readFileSync(manifest, 'utf8');
    const stop = publishRunningApp(data);
    try {
      await expect(install([source])).rejects.toThrow('Quit the app');
      await expect(uninstall(['demo-pack'])).rejects.toThrow('Quit the app');
      expect(fs.readFileSync(manifest, 'utf8')).toBe(before);
      expect(findDatabaseWriter(data)).toBeNull();
    } finally { stop(); }
    await uninstall(['demo-pack']);
    expect(fs.existsSync(manifest)).toBe(false);
  });

  it("refuses a pack whose hostVersion the data dir's apack doesn't satisfy", async () => {
    recordHostCompatibility(path.join(tmp, 'data'), { version: '0.3.14', packFormat: PACK_SNAPSHOT_FORMAT });
    await expect(install([builtPack('>=99.0.0')])).rejects.toThrow(/requires apack >=99\.0\.0/);
  });

  it("installs when the data dir's apack satisfies it", async () => {
    recordHostCompatibility(path.join(tmp, 'data'), { version: '0.3.14', packFormat: PACK_SNAPSHOT_FORMAT });
    await install([builtPack('>=0.3.0')]);
    expect(fs.existsSync(path.join(_appDirOf(path.join(tmp, 'data')), 'packs', 'demo-pack', 'apack.json'))).toBe(true);
  });

  // The app records the pack format it reads, which need not be the one this CLI builds
  it("refuses a pack built in a format other than the data dir's apack reads", async () => {
    recordHostCompatibility(path.join(tmp, 'data'), { version: '0.3.14', packFormat: PACK_SNAPSHOT_FORMAT + 1 });
    await expect(install([builtPack('>=0.3.0')])).rejects.toThrow(
      `Pack "demo-pack" can't be installed: its snapshot is format ${PACK_SNAPSHOT_FORMAT}, written by an older apack CLI; this apack reads format ${PACK_SNAPSHOT_FORMAT + 1}`,
    );
    expect(fs.existsSync(path.join(_appDirOf(path.join(tmp, 'data')), 'packs', 'demo-pack'))).toBe(false);
  });

  it("notes that hostVersion wasn't checked before the app has used the data dir", async () => {
    await install([builtPack('>=99.0.0')]);
    expect(vi.mocked(console.warn).mock.calls.flat().join('\n')).toContain("hostVersion wasn't checked");
  });
});

// Tooling runs host code with no app bound: @apackdev/host/packs logs through @apackdev/sdk/logger, which writes to the console
describe('the apack bin', () => {
  it('installs a pack, printing what @apackdev/host/packs logs', async () => {
    const cli = path.resolve(__dirname, '..', '..', 'bin', 'apack.mjs');
    let result: { code: number | null; stdout: string; stderr: string };
    try {
      result = { code: 0, ...await execFileWhileWorking(process.execPath, [cli, 'pack', 'install', builtPack('>=0.3.0')], {
        cwd: tmp,
        env: { ...process.env, APACK_USER_DATA_DIR: path.join(tmp, 'data'), NO_COLOR: '1', FORCE_COLOR: '0' },
      }) };
    } catch (error) {
      const { code, stdout, stderr } = error as { code: number | null; stdout: string; stderr: string };
      result = { code, stdout, stderr };
    }
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('[pack-installer] Installed "Demo Pack" v1.0.0');
    expect(fs.existsSync(path.join(_appDirOf(path.join(tmp, 'data')), 'packs', 'demo-pack', 'apack.json'))).toBe(true);
  });
});
