import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAppCommand } from '../../src/app/app-command.ts';
import { manageInstalledApp, pickAppRelease, type AppCommandDependencies } from '../../src/app/installed-app.ts';

const release = (version: string, prerelease = false) => {
  const name = `${prerelease ? 'apack-Beta' : 'apack'}-${version}-mac-arm64.zip`;
  return { tag_name: `v${version}`, prerelease, assets: [
    { name, browser_download_url: 'https://fixture.test/app.zip' },
    { name: `${name}.sha256`, browser_download_url: 'https://fixture.test/app.sha256' },
  ] };
};

describe('app command arguments', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('defaults to production even in a beta-bundled CLI', () => {
    vi.stubEnv('APACK_CLI_CHANNEL', 'beta');
    expect(parseAppCommand('install', []).channel).toBe('production');
    expect(parseAppCommand('install', ['--channel', 'beta']).channel).toBe('beta');
  });
  it('accepts an exact version, leading v, and explicit replacement', () => {
    expect(parseAppCommand('install', ['v0.4.0', '--replace'])).toMatchObject({ version: '0.4.0', replace: true });
    expect(parseAppCommand('install', ['latest']).version).toBeUndefined();
  });
  it('refuses ambiguous or unsupported inputs', () => {
    for (const args of [['0.4'], ['--force'], ['0.4.0', '0.5.0'], ['--app', 'preview'], ['0.4.0-beta.1']]) {
      expect(() => parseAppCommand('install', args)).toThrow();
    }
    expect(() => parseAppCommand('uninstall', ['0.4.0'])).toThrow();
    expect(() => parseAppCommand('upgrade', ['--replace'])).toThrow();
  });
  it('never substitutes a different release for a requested version', () => {
    const releases = [release('0.4.1'), release('0.4.0')];
    expect(pickAppRelease(releases, 'production', '0.4.0')?.version).toBe('0.4.0');
    expect(pickAppRelease(releases, 'production', '0.3.14')).toBeNull();
    expect(pickAppRelease([release('0.4.1-beta.1', true)], 'production')).toBeNull();
    expect(pickAppRelease([{ ...release('0.4.1'), assets: release('0.4.0').assets }], 'production')).toBeNull();
  });
  it("passes over a newer release that holds no macOS files yet, as another platform's workflow leaves one", () => {
    const windowsOnly = { tag_name: 'v0.4.1', prerelease: false, assets: [{ name: 'apack-0.4.1-win-x64.exe', browser_download_url: 'https://fixture.test/app.exe' }] };
    expect(pickAppRelease([windowsOnly, release('0.4.0')], 'production')?.version).toBe('0.4.0');
    expect(pickAppRelease([windowsOnly, release('0.4.0')], 'production', '0.4.1')).toBeNull();
  });
});

describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('app lifecycle with temporary bundles', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

  function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-app-install-spec-'));
    dirs.push(dir);
    const applications = path.join(dir, 'Applications');
    fs.mkdirSync(applications);
    const app = path.join(applications, 'apack.app');
    const source = path.join(dir, 'incoming', 'apack.app');
    const data = path.join(dir, 'data');
    fs.writeFileSync(data, 'user data');
    const bundle = (dest: string, version: string, id = 'dev.apack.app') => {
      fs.mkdirSync(path.join(dest, 'Contents', 'MacOS'), { recursive: true });
      fs.writeFileSync(path.join(dest, 'Contents', 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
      fs.writeFileSync(path.join(dest, 'Contents', 'MacOS', id === 'dev.apack.beta' ? 'apack Beta' : 'apack'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.writeFileSync(path.join(dest, 'version'), version);
    };
    bundle(source, '0.4.0');
    const quit = vi.fn(async () => {});
    const listReleases = vi.fn(async () => [release('0.4.0')]);
    const bytes = Buffer.from('fixture zip');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const download = vi.fn(async (url: string) => Readable.from([url.endsWith('.sha256') ? digest : bytes]));
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command !== 'ditto') return;
      if (args[0] === '-x') fs.cpSync(path.dirname(source), args[3]!, { recursive: true });
      else fs.cpSync(args[0]!, args[1]!, { recursive: true });
    });
    const deps: AppCommandDependencies = { applicationsDir: applications, quit, listReleases, download, run, log: () => {} };
    return { app, source, data, applications, bundle, quit, download, listReleases, run, deps };
  }

  it('installs a verified release and cleans staging and locks', async () => {
    const f = fixture();
    await manageInstalledApp({ action: 'install', channel: 'production', relaunch: true }, f.deps);
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.4.0');
    expect(fs.readdirSync(f.applications)).toEqual(['apack.app']);
    expect(f.quit).not.toHaveBeenCalled();
    expect(f.run).toHaveBeenCalledWith('open', [f.app]);
  });
  it('refuses replacement even when the existing version is unreadable', async () => {
    const f = fixture();
    fs.mkdirSync(f.app);
    await expect(manageInstalledApp({ action: 'install', channel: 'production' }, f.deps)).rejects.toThrow('--replace');
    expect(f.listReleases).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
  });
  it('replaces an existing bundle only after the new one is ready', async () => {
    const f = fixture();
    f.bundle(f.app, '0.3.14');
    f.quit.mockImplementation(async () => {
      expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.3.14');
      expect(fs.readdirSync(f.applications).some(name => name.includes('.installing-'))).toBe(true);
    });
    await manageInstalledApp({ action: 'install', channel: 'production', replace: true }, f.deps);
    expect(f.quit).toHaveBeenCalledOnce();
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.4.0');
  });
  it('preserves the old app on checksum failure', async () => {
    const f = fixture();
    f.bundle(f.app, '0.3.14');
    f.download.mockImplementation(async () => Readable.from(['bad bytes']));
    await expect(manageInstalledApp({ action: 'install', channel: 'production', replace: true }, f.deps)).rejects.toThrow('Checksum mismatch');
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.3.14');
    expect(f.quit).not.toHaveBeenCalled();
    expect(fs.readdirSync(f.applications)).toEqual(['apack.app']);
  });
  it('preserves the old app when staging the replacement fails', async () => {
    const f = fixture();
    f.bundle(f.app, '0.3.14');
    const normal = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (command, args) => {
      if (command === 'ditto' && args[0] !== '-x') throw new Error('copy failed');
      await normal(command, args);
    });
    await expect(manageInstalledApp({ action: 'install', channel: 'production', replace: true }, f.deps)).rejects.toThrow('copy failed');
    expect(f.quit).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.3.14');
    expect(fs.readdirSync(f.applications)).toEqual(['apack.app']);
  });
  it('refuses an app that appears while the download is in progress', async () => {
    const f = fixture();
    const normal = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (command, args) => {
      await normal(command, args);
      if (command === 'ditto' && args[0] !== '-x') f.bundle(f.app, '0.5.0');
    });
    await expect(manageInstalledApp({ action: 'install', channel: 'production' }, f.deps)).rejects.toThrow('appeared during installation');
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.5.0');
    expect(f.quit).not.toHaveBeenCalled();
  });
  it('refuses symlink destinations rather than following them', async () => {
    const f = fixture();
    fs.symlinkSync(f.source, f.app);
    await expect(manageInstalledApp({ action: 'uninstall', channel: 'production' }, f.deps)).rejects.toThrow('not an app directory');
    expect(fs.existsSync(f.source)).toBe(true);
  });
  it('refuses a concurrent app operation before downloading or quitting', async () => {
    const f = fixture();
    const lock = path.join(f.applications, '.apack.manage.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, machine: os.hostname(), what: 'another app install', since: new Date().toISOString() }));
    await expect(manageInstalledApp({ action: 'install', channel: 'production' }, f.deps)).rejects.toThrow('Another app operation');
    expect(f.download).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
    expect(fs.existsSync(lock)).toBe(true);
  });
  it('rejects a mismatched bundle before touching the old app', async () => {
    const f = fixture();
    f.bundle(f.app, '0.3.14');
    f.bundle(f.source, '0.5.0');
    await expect(manageInstalledApp({ action: 'install', channel: 'production', replace: true }, f.deps)).rejects.toThrow('does not match');
    expect(f.quit).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.3.14');
  });
  it('preserves the old app and cleans up when quitting fails', async () => {
    const f = fixture();
    f.bundle(f.app, '0.3.14');
    f.quit.mockRejectedValue(new Error('still running'));
    await expect(manageInstalledApp({ action: 'upgrade', channel: 'production' }, f.deps)).rejects.toThrow('still running');
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.3.14');
    expect(fs.readdirSync(f.applications)).toEqual(['apack.app']);
  });
  it('requires an installed app for upgrade and skips a downgrade without force', async () => {
    const f = fixture();
    await expect(manageInstalledApp({ action: 'upgrade', channel: 'production' }, f.deps)).rejects.toThrow('install first');
    f.bundle(f.app, '0.5.0');
    await manageInstalledApp({ action: 'upgrade', channel: 'production' }, f.deps);
    expect(f.download).not.toHaveBeenCalled();
    await manageInstalledApp({ action: 'upgrade', channel: 'production', force: true }, f.deps);
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.4.0');
  });
  it('uninstalls only the app, retaining data and other channels', async () => {
    const f = fixture();
    f.bundle(f.app, '0.4.0');
    fs.mkdirSync(path.join(f.applications, 'apack Beta.app'));
    await manageInstalledApp({ action: 'uninstall', channel: 'production' }, f.deps);
    expect(fs.existsSync(f.app)).toBe(false);
    expect(fs.readFileSync(f.data, 'utf8')).toBe('user data');
    expect(fs.readdirSync(f.applications)).toEqual(['apack Beta.app']);
    await manageInstalledApp({ action: 'uninstall', channel: 'production' }, f.deps);
    expect(f.quit).toHaveBeenCalledOnce();
  });
  it('installs beta separately without replacing production', async () => {
    const f = fixture();
    f.bundle(f.app, '0.4.0');
    f.bundle(path.join(path.dirname(f.source), 'apack Beta.app'), '0.4.1-beta.1', 'dev.apack.beta');
    f.listReleases.mockResolvedValue([release('0.4.1-beta.1', true)]);
    await manageInstalledApp({ action: 'install', channel: 'beta' }, f.deps);
    expect(fs.readFileSync(path.join(f.app, 'version'), 'utf8')).toBe('0.4.0');
    expect(fs.readFileSync(path.join(f.applications, 'apack Beta.app', 'version'), 'utf8')).toBe('0.4.1-beta.1');
    expect(f.quit).not.toHaveBeenCalled();
  });
});
