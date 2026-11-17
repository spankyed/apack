import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ELECTRON_NOTICES, shipElectronNotices } from '../../../scripts/lib/electron-notices.ts';

/**
 * Electron's notices in the packaged app: copied into the bundle on macOS, where electron-builder deletes them,
 * and checked beside the executable elsewhere, where it leaves them. Driven over directories made here, since
 * the subject runs inside electron-builder's `afterPack` and nothing else packages the app.
 */
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-notices-'));
  made.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

/** An installed `electron/dist`: its version record and both notices */
const electronDist = (version = '44.9.3', omit?: string) => tree(Object.fromEntries([
  ['version', `${version}\n`],
  ...ELECTRON_NOTICES.filter(({ from }) => from !== omit).map(({ from }) => [from, `${from} text`]),
]));

describe("Electron's notices in the packaged app", () => {
  it('copies both into the bundle on macOS, under the names the other platforms use', () => {
    const resources = tree({});
    const shipped = shipElectronNotices({
      platform: 'darwin', appOutDir: tree({}), resources, electronDist: electronDist(), packagedVersion: '44.9.3',
    });
    expect(shipped.map((file) => path.relative(resources, file))).toEqual(['LICENSE.electron.txt', 'LICENSES.chromium.html']);
    expect(fs.readFileSync(path.join(resources, 'LICENSE.electron.txt'), 'utf8')).toBe('LICENSE text');
  });

  it('refuses the notices of another Electron than the one packaged', () => {
    expect(() => shipElectronNotices({
      platform: 'darwin', appOutDir: tree({}), resources: tree({}), electronDist: electronDist('44.9.2'), packagedVersion: '44.9.3',
    })).toThrow(/is Electron 44\.9\.2, and the app packages Electron 44\.9\.3/);
  });

  it('refuses an installed Electron without them, rather than shipping none', () => {
    expect(() => shipElectronNotices({
      platform: 'darwin', appOutDir: tree({}), resources: tree({}),
      electronDist: electronDist('44.9.3', 'LICENSES.chromium.html'), packagedVersion: '44.9.3',
    })).toThrow(/LICENSES\.chromium\.html is missing/);
  });

  it('refuses an install without Electron at all, naming the remedy', () => {
    expect(() => shipElectronNotices({
      platform: 'darwin', appOutDir: tree({}), resources: tree({}), electronDist: tree({}), packagedVersion: '44.9.3',
    })).toThrow(/holds no installed Electron.*ELECTRON_SKIP_BINARY_DOWNLOAD/);
  });

  it('finds them beside the executable on Windows and Linux', () => {
    const appOutDir = tree({ 'LICENSE.electron.txt': 'x', 'LICENSES.chromium.html': 'x' });
    for (const platform of ['win32', 'linux']) {
      expect(shipElectronNotices({ platform, appOutDir, resources: '', electronDist: '', packagedVersion: '44.9.3' })).toHaveLength(2);
    }
  });

  it('fails a Windows or Linux build that lost one', () => {
    const appOutDir = tree({ 'LICENSES.chromium.html': 'x' });
    expect(() => shipElectronNotices({ platform: 'win32', appOutDir, resources: '', electronDist: '', packagedVersion: '44.9.3' }))
      .toThrow(/LICENSE\.electron\.txt is missing/);
  });
});
