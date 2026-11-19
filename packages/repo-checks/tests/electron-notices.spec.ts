import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { ELECTRON_NOTICES, MAC_FRAMEWORKS, electronNoticesPointer, shipElectronNotices } from '../../../scripts/lib/electron-notices.ts';

/**
 * Electron's notices in the packaged app: copied into the bundle on macOS, where electron-builder deletes them,
 * with the licenses of the frameworks they don't name, and checked beside the executable elsewhere, where it leaves
 * them. Driven over directories made here, since the subject runs inside electron-builder's `afterPack` and nothing
 * else packages the app.
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

/** A macOS bundle's `Contents/Resources`, beside a `Contents/Frameworks` holding the frameworks given */
function macBundle(frameworks = MAC_FRAMEWORKS.map(({ framework }) => framework)): string {
  const bundle = tree(Object.fromEntries(frameworks.map((framework) => [`Contents/Frameworks/${framework}/Resources/Info.plist`, ''])));
  fs.mkdirSync(path.join(bundle, 'Contents', 'Resources'), { recursive: true });
  return path.join(bundle, 'Contents', 'Resources');
}

/** `build/licenses/` holding each framework license `MAC_FRAMEWORKS` names */
const licensesDir = () => tree(Object.fromEntries(MAC_FRAMEWORKS.flatMap(({ license }) => (license ? [[license.from, `${license.from} text`]] : []))));

const onMac = (resources: string, extra: Partial<Parameters<typeof shipElectronNotices>[0]> = {}) => shipElectronNotices({
  platform: 'darwin', appOutDir: tree({}), resources, electronDist: electronDist(), packagedVersion: '44.9.3', licensesDir: licensesDir(), ...extra,
});

describe("Electron's notices in the packaged app", () => {
  it('copies both into the bundle on macOS, under the names the other platforms use', () => {
    const resources = macBundle();
    const shipped = onMac(resources);
    expect(shipped.map((file) => path.relative(resources, file)).slice(0, 2)).toEqual(['LICENSE.electron.txt', 'LICENSES.chromium.html']);
    expect(fs.readFileSync(path.join(resources, 'LICENSE.electron.txt'), 'utf8')).toBe('LICENSE text');
  });

  it("adds on macOS the licenses of Mantle and ReactiveObjC, the frameworks Electron's notices don't name", () => {
    const resources = macBundle();
    const shipped = onMac(resources).map((file) => path.relative(resources, file));
    expect(shipped).toEqual(['LICENSE.electron.txt', 'LICENSES.chromium.html', 'LICENSE.Mantle.md', 'LICENSE.ReactiveObjC.md']);
    expect(fs.readFileSync(path.join(resources, 'LICENSE.Mantle.md'), 'utf8')).toBe('Mantle-LICENSE.md text');
    expect(electronNoticesPointer('darwin')).toContain('LICENSE.Mantle.md and LICENSE.ReactiveObjC.md');
    expect(electronNoticesPointer('linux')).not.toContain('Mantle');
  });

  it('refuses a framework nothing credits, and one named that the app no longer carries', () => {
    const named = MAC_FRAMEWORKS.map(({ framework }) => framework);
    expect(() => onMac(macBundle([...named, 'Sparkle.framework'])))
      .toThrow(/holds Sparkle\.framework, which nothing credits: find each one's license, and add it to MAC_FRAMEWORKS/);
    expect(() => onMac(macBundle(named.filter((framework) => framework !== 'Mantle.framework'))))
      .toThrow(/MAC_FRAMEWORKS names Mantle\.framework, which .* does not hold: remove each one, and its license/);
  });

  // The installed Electron is this platform's, and only macOS's has frameworks
  it.skipIf(process.platform !== 'darwin')('names every framework the installed Electron carries, with each license committed', () => {
    const frameworks = path.join(REPO_ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Frameworks');
    const carried = fs.readdirSync(frameworks).filter((name) => name.endsWith('.framework')).sort();
    expect(carried).toEqual(MAC_FRAMEWORKS.map(({ framework }) => framework).sort());
    for (const { license } of MAC_FRAMEWORKS) {
      if (license) expect(fs.existsSync(path.join(REPO_ROOT, 'build', 'licenses', license.from)), license.from).toBe(true);
    }
  });

  it('refuses the notices of another Electron than the one packaged', () => {
    expect(() => onMac(macBundle(), { electronDist: electronDist('44.9.2') })).toThrow(/is Electron 44\.9\.2, and the app packages Electron 44\.9\.3/);
  });

  it('refuses an installed Electron without them, rather than shipping none', () => {
    expect(() => onMac(macBundle(), { electronDist: electronDist('44.9.3', 'LICENSES.chromium.html') })).toThrow(/LICENSES\.chromium\.html is missing/);
  });

  it('refuses an install without Electron at all, naming the remedy', () => {
    expect(() => onMac(macBundle(), { electronDist: tree({}) })).toThrow(/holds no installed Electron.*ELECTRON_SKIP_BINARY_DOWNLOAD/);
  });

  it('finds them beside the executable on Windows and Linux', () => {
    const appOutDir = tree({ 'LICENSE.electron.txt': 'x', 'LICENSES.chromium.html': 'x' });
    for (const platform of ['win32', 'linux']) {
      expect(shipElectronNotices({ platform, appOutDir, resources: '', electronDist: '', packagedVersion: '44.9.3', licensesDir: '' })).toHaveLength(2);
    }
  });

  it('fails a Windows or Linux build that lost one', () => {
    const appOutDir = tree({ 'LICENSES.chromium.html': 'x' });
    expect(() => shipElectronNotices({ platform: 'win32', appOutDir, resources: '', electronDist: '', packagedVersion: '44.9.3', licensesDir: '' }))
      .toThrow(/LICENSE\.electron\.txt is missing/);
  });
});
