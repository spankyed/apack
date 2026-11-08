import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { manageInstalledApp, installedVersion } from '../../src/app/installed-app.ts';
import { execFileWhileWorking } from '@apackdev/host/build/process-progress';

it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('installs, upgrades and removes a real zipped bundle while preserving permissions, symlinks and user data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-install-integration-'));
  try {
    const applications = path.join(root, 'Applications');
    fs.mkdirSync(applications);
    const source = path.join(root, 'source', 'apack.app');
    const contents = path.join(source, 'Contents');
    for (const dir of ['MacOS', 'Resources', 'Frameworks']) fs.mkdirSync(path.join(contents, dir), { recursive: true });
    fs.writeFileSync(path.join(contents, 'MacOS', 'apack'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(contents, 'Resources', 'build.txt'), 'fixture');
    fs.symlinkSync('../Resources/build.txt', path.join(contents, 'Frameworks', 'build-link'));
    const data = path.join(root, 'user-data');
    fs.writeFileSync(data, 'keep me');
    const archive = path.join(root, 'fixture.zip');
    let version = '0.4.0';
    const prepare = async () => {
      fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.apack.app</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
      await execFileWhileWorking('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, archive], { timeout: 60_000 });
    };
    const quit = vi.fn(async () => {});
    const deps = {
      applicationsDir: applications,
      quit,
      log: () => {},
      listReleases: async () => [{ tag_name: `v${version}`, prerelease: false, assets: [
        { name: `apack-${version}-mac-arm64.zip`, browser_download_url: 'https://fixture.test/app.zip' },
        { name: `apack-${version}-mac-arm64.zip.sha256`, browser_download_url: 'https://fixture.test/app.sha256' },
      ] }],
      download: async (url: string) => url.endsWith('.sha256')
        ? Readable.from([createHash('sha256').update(fs.readFileSync(archive)).digest('hex')])
        : fs.createReadStream(archive),
    };
    await prepare();
    await manageInstalledApp({ action: 'install', channel: 'production', version }, deps);
    const app = path.join(applications, 'apack.app');
    expect(installedVersion(app)).toBe('0.4.0');
    expect(fs.readlinkSync(path.join(app, 'Contents', 'Frameworks', 'build-link'))).toBe('../Resources/build.txt');
    fs.accessSync(path.join(app, 'Contents', 'MacOS', 'apack'), fs.constants.X_OK);
    await expect(manageInstalledApp({ action: 'install', channel: 'production' }, deps)).rejects.toThrow('--replace');

    version = '0.4.1';
    await prepare();
    await manageInstalledApp({ action: 'upgrade', channel: 'production' }, deps);
    expect(installedVersion(app)).toBe('0.4.1');
    expect(quit).toHaveBeenCalledOnce();
    expect(fs.readdirSync(applications)).toEqual(['apack.app']);

    await manageInstalledApp({ action: 'uninstall', channel: 'production' }, deps);
    expect(fs.readdirSync(applications)).toEqual([]);
    expect(fs.readFileSync(data, 'utf8')).toBe('keep me');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
