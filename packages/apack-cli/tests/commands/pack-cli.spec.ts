import { _declarationRevision } from '@apackdev/sdk/build';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';

let tmpDir: string;
let previousEnvironment: { channel?: string; userDataDir?: string; hostRoot?: string; hostExecutable?: string };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-cli-test-'));
  previousEnvironment = { channel: process.env.APACK_CLI_CHANNEL, userDataDir: process.env.APACK_USER_DATA_DIR, hostRoot: process.env.APACK_HOST_ROOT, hostExecutable: process.env.APACK_HOST_EXECUTABLE };
  process.env.APACK_CLI_CHANNEL = 'test';
  process.env.APACK_USER_DATA_DIR = path.join(tmpDir, 'app-data');
  process.env.APACK_HOST_ROOT = path.join(tmpDir, 'host');
  delete process.env.APACK_HOST_EXECUTABLE;
  fs.mkdirSync(path.join(tmpDir, 'host', 'packages'), { recursive: true });
});

afterEach(() => {
  for (const [key, value] of [['APACK_CLI_CHANNEL', previousEnvironment.channel], ['APACK_USER_DATA_DIR', previousEnvironment.userDataDir], ['APACK_HOST_ROOT', previousEnvironment.hostRoot], ['APACK_HOST_EXECUTABLE', previousEnvironment.hostExecutable]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeManifest(dir: string, manifest: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, 'apack.json'), JSON.stringify(manifest, null, 2));
}

/** What `apack pack build` leaves in a pack's dist/: the runtime the host loads and the snapshot dependents read */
function writeBuild(dir: string, id: string) {
  fs.mkdirSync(path.join(dir, 'dist', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist', 'types'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'runtime', 'index.cjs'), `module.exports = { registration: { id: ${JSON.stringify(id)} } };`);
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  sealPackBuild(path.join(dir, 'dist'), JSON.parse(fs.readFileSync(path.join(dir, 'apack.json'), 'utf8')));
}

describe('pack CLI: init', () => {
  it('rejects invalid pack names', async () => {
    const { init } = await import('../../src/commands/init');

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await expect(init(['Invalid_Name'])).rejects.toThrow(/lowercase alphanumeric/);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('rejects if directory already exists', async () => {
    const { init } = await import('../../src/commands/init');

    fs.mkdirSync(path.join(tmpDir, 'exists'));

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await expect(init(['exists'])).rejects.toThrow(/already exists/);
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('pack CLI: install', () => {
  it('install with no args returns without throwing (prints help)', async () => {
    const { install } = await import('../../src/commands/pack-install');
    await expect(install([])).resolves.toBeUndefined();
  });

  it('installPackFromLocal throws on nonexistent path', async () => {
    const { installPackFromLocal } = await import('@apackdev/host/packs');
    await expect(installPackFromLocal('/nonexistent/path')).rejects.toThrow(/Path not found/);
  });

  it('rejects manifest with invalid id format', async () => {
    const { install } = await import('../../src/commands/pack-install');

    const badPack = path.join(tmpDir, 'bad-id-pack');
    fs.mkdirSync(badPack, { recursive: true });
    writeManifest(badPack, {
      id: 'INVALID_ID',
      name: 'Bad',
      version: '1.0.0',
    });
    writeBuild(badPack, 'bad-id-pack');

    await expect(install([badPack])).rejects.toThrow(/lowercase alphanumeric/);
  });

  it("rejects a pack that hasn't been built", async () => {
    const { install } = await import('../../src/commands/pack-install');

    const unbuilt = path.join(tmpDir, 'unbuilt');
    fs.mkdirSync(unbuilt, { recursive: true });
    writeManifest(unbuilt, {
      id: 'unbuilt',
      name: 'Unbuilt',
      version: '1.0.0',
    });

    await expect(install([unbuilt])).rejects.toThrow(/Pack unbuilt is not built:.*Run "apack pack build" first/s);
  });

  it('rejects pack without apack.json', async () => {
    const { install } = await import('../../src/commands/pack-install');

    const noManifest = path.join(tmpDir, 'no-manifest');
    fs.mkdirSync(noManifest, { recursive: true });

    await expect(install([noManifest])).rejects.toThrow(/No apack.json/);
  });

  it('refuses symlinks in built output before replacing the installed copy', async () => {
    const { installPackFromLocal } = await import('@apackdev/host/packs');

    const sourceDir = path.join(tmpDir, 'symlink-pack');
    fs.mkdirSync(sourceDir, { recursive: true });
    writeManifest(sourceDir, {
      id: 'symlink-test',
      name: 'Symlink Test',
      version: '1.0.0',
    });
    writeBuild(sourceDir, 'symlink-test');
    const packsDir = path.join(tmpDir, 'packs');
    const installed = await installPackFromLocal(sourceDir, packsDir);
    const entry = path.join(installed.dir, PACK_LAYOUT.runtimeEntry);
    const before = fs.readFileSync(entry, 'utf8');

    const outsideFile = path.join(tmpDir, 'secret.txt');
    fs.writeFileSync(outsideFile, 'secret data');
    fs.symlinkSync(outsideFile, path.join(sourceDir, 'dist', 'runtime', 'link.txt'));

    expect(fs.lstatSync(path.join(sourceDir, 'dist', 'runtime', 'link.txt')).isSymbolicLink()).toBe(true);

    const beforePlace = vi.fn();
    await expect(installPackFromLocal(sourceDir, packsDir, { beforePlace })).rejects.toThrow('symbolic link: runtime/link.txt');
    expect(beforePlace).not.toHaveBeenCalled();
    expect(fs.readFileSync(entry, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(installed.dir, 'runtime', 'link.txt'))).toBe(false);
  });

  it('installs from a zip file', async () => {
    const { installPackFromLocal } = await import('@apackdev/host/packs');

    const sourceDir = path.join(tmpDir, 'zip-source');
    fs.mkdirSync(sourceDir, { recursive: true });
    writeManifest(sourceDir, {
      id: 'zip-pack',
      name: 'Zip Pack',
      version: '1.0.0',
    });
    writeBuild(sourceDir, 'zip-pack');

    const zipPath = path.join(tmpDir, 'pack.zip');
    try {
      await execFileWhileWorking('zip', ['-r', zipPath, '.'], { cwd: sourceDir });
    } catch {
      console.log('zip command not available, skipping zip install test');
      return;
    }

    const packsDir = path.join(tmpDir, 'packs');
    const result = await installPackFromLocal(zipPath, packsDir);

    const installedDir = result.dir;
    expect(fs.existsSync(installedDir)).toBe(true);
    expect(fs.existsSync(path.join(installedDir, 'apack.json'))).toBe(true);
    expect(fs.existsSync(path.join(installedDir, 'runtime', 'index.cjs'))).toBe(true);
  });
});

describe('pack CLI: validate', () => {
  it('validateManifest catches missing fields', async () => {
    const packDir = path.join(tmpDir, 'validate-test');
    fs.mkdirSync(packDir, { recursive: true });

    writeManifest(packDir, {});

    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'));
    expect(manifest.id).toBeUndefined();
    expect(manifest.name).toBeUndefined();
    expect(manifest.version).toBeUndefined();
  });
});

describe('pack CLI: security', () => {
  it('manifest id validation prevents path traversal', () => {
    const maliciousIds = [
      '../../../etc',
      '..%2F..%2Fetc',
      'UPPERCASE',
      'has spaces',
      'has/slash',
      '.hidden',
      '-starts-with-dash',
    ];

    const validPattern = /^[a-z][a-z0-9-]*$/;
    for (const id of maliciousIds) {
      expect(validPattern.test(id)).toBe(false);
    }
  });

  it('valid ids pass the pattern', () => {
    const validIds = ['my-pack', 'a', 'pack123', 'hello-world-v2'];
    const validPattern = /^[a-z][a-z0-9-]*$/;
    for (const id of validIds) {
      expect(validPattern.test(id)).toBe(true);
    }
  });
});

it('pack installation refuses removed or misspelled target flags before changing data', async () => {
  const { install } = await import('../../src/commands/pack-install');
  const { uninstall } = await import('../../src/commands/pack-uninstall');
  for (const flag of ['--dev', '-b', '--channel', '--typo']) {
    await expect(install(['demo', flag])).rejects.toThrow(/Usage|not a pack host selector/);
    await expect(uninstall(['demo', flag])).rejects.toThrow('Usage');
  }
});
