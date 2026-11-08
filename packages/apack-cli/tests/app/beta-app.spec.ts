import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureBetaApp, packagedExecutable, pickBetaRelease } from '../../src/app/beta-app';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const asset = (name: string) => ({ name, browser_download_url: `https://example.test/${encodeURIComponent(name)}` });
const zipName = (version: string) => `apack-Beta-${version}-mac-arm64.zip`;
const release = (version: string, { prerelease = true, checksum = true, fileVersion = version } = {}) => ({
  tag_name: `v${version}`,
  prerelease,
  assets: [asset(zipName(fileVersion)), ...(checksum ? [asset(`${zipName(fileVersion)}.sha256`)] : [])],
});

describe('pickBetaRelease', () => {
  it("checks hostVersion against the app version in a beta's zip name", () => {
    expect(pickBetaRelease([release('0.4.2-beta.3')], '>=0.4.2')).toBeNull();
  });

  it('picks the newest beta that satisfies hostVersion and ships a checksum', () => {
    const releases = [
      release('0.5.1-beta.1'), // too new for the range (0.5.0-beta.x still sorts below 0.5.0)
      release('0.4.1-beta.11', { checksum: false }), // newest in range, but unverifiable
      release('0.4.1'), // prerelease: true but not a beta version
      release('0.4.0', { prerelease: false }),
      release('0.4.1-beta.2'),
      release('0.4.1-beta.10'),
    ];
    expect(pickBetaRelease(releases, '>=0.4.0 <0.5.0')?.version).toBe('0.4.1-beta.10');
    expect(pickBetaRelease(releases, '>=0.6.0')).toBeNull();
  });

  it('accepts a beta promoted from a production build, named with the production version', () => {
    // The zip holds the 0.4.2 production app, which a pack requiring >=0.4.2 installs into
    const promoted = pickBetaRelease([release('0.4.2-beta.0', { fileVersion: '0.4.2' })], '>=0.4.2');
    expect(promoted?.version).toBe('0.4.2-beta.0');
    expect(promoted?.zip.name).toBe('apack-Beta-0.4.2-mac-arm64.zip');
    expect(promoted?.checksum.name).toBe('apack-Beta-0.4.2-mac-arm64.zip.sha256');
  });
});

describe.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('ensureBetaApp', () => {
  let tmp: string;
  let zip: Buffer;
  let files: Record<string, Buffer>;
  const download = vi.fn(async (url: string) => {
    const name = decodeURIComponent(url.split('/').pop()!);
    if (!files[name]) throw new Error(`404 ${name}`);
    return Readable.from([files[name]]);
  });

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-beta-app-'));
    // A minimal app bundle, zipped the way electron-builder's mac zip target does
    const bundle = path.join(tmp, 'bundle');
    const executable = packagedExecutable(bundle);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '#!/bin/sh\n');
    fs.chmodSync(executable, 0o755);
    const zipPath = path.join(tmp, 'app.zip');
    await execFileWhileWorking('ditto', ['-c', '-k', path.join(bundle, 'apack Beta.app'), '--keepParent', zipPath]);
    zip = fs.readFileSync(zipPath);
    const sha = createHash('sha256').update(zip).digest('hex');
    files = {
      [zipName('0.4.0-beta.1')]: zip,
      [`${zipName('0.4.0-beta.1')}.sha256`]: Buffer.from(`${sha}  ${zipName('0.4.0-beta.1')}\n`),
    };
    download.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const options = () => ({
    hostVersion: '>=0.3.0',
    cacheDir: path.join(tmp, 'cache'),
    listReleases: async () => [release('0.4.0-beta.1')],
    download,
    log: () => {},
  });

  it('downloads, verifies and extracts the app once per version', async () => {
    const app = await ensureBetaApp(options());
    expect(app.version).toBe('0.4.0-beta.1');
    expect(app.executable).toBe(packagedExecutable(path.join(tmp, 'cache', 'apps', 'beta', '0.4.0-beta.1')));
    expect(fs.statSync(app.executable).mode & 0o111).not.toBe(0);
    expect(download).toHaveBeenCalledTimes(2);

    download.mockClear();
    await expect(ensureBetaApp(options())).resolves.toEqual(app);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects a download whose checksum does not match and caches nothing', async () => {
    files[`${zipName('0.4.0-beta.1')}.sha256`] = Buffer.from(`${'0'.repeat(64)}  ${zipName('0.4.0-beta.1')}\n`);

    await expect(ensureBetaApp(options())).rejects.toThrow(/Checksum mismatch for apack-Beta-0\.4\.0-beta\.1-mac-arm64\.zip/);
    expect(fs.readdirSync(path.join(tmp, 'cache', 'apps', 'beta'))).toEqual([]);
  });

  it('says so when no beta satisfies the pack hostVersion', async () => {
    await expect(ensureBetaApp({ ...options(), hostVersion: '>=1.0.0' }))
      .rejects.toThrow(/No apack Beta release satisfies this pack's hostVersion \(>=1\.0\.0\)/);
  });
});
