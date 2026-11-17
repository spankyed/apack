/**
 * Electron's own notices, which every packaged app has to carry: `LICENSE`, Electron's MIT license, and
 * `LICENSES.chromium.html`, the notices of Chromium, V8, Node and the libraries they build in. Electron's release
 * holds both, and its documentation asks an app built on it to ship them.
 *
 * **electron-builder ships them on Windows and Linux and deletes them on macOS.** On those two it leaves
 * `LICENSES.chromium.html` beside the executable and renames `LICENSE` to `LICENSE.electron.txt`
 * (app-builder-lib's `ElectronFramework.js`); on macOS it deletes both from beside the `.app` (`electronMac.js`)
 * and puts them nowhere. So on macOS `afterPack` copies them from the installed `electron` package into the
 * bundle's `Contents/Resources`, and on the others it checks they are there — the rename swallows its own
 * failure, and a missing source in `extraResources` is only logged, so neither would fail a build on its own.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** What Electron's release calls the two files, and what the packaged app calls them on every platform */
export const ELECTRON_NOTICES = [
  { from: 'LICENSE', to: 'LICENSE.electron.txt' },
  { from: 'LICENSES.chromium.html', to: 'LICENSES.chromium.html' },
] as const;
type Notice = (typeof ELECTRON_NOTICES)[number];

/**
 * The installed Electron's two files, refusing when they are missing or come from another Electron than the one
 * electron-builder packaged: electron-builder downloads its own copy of Electron for the version it reads, and the
 * notices must describe that one. `dist/version` is the installed package's own record of its version.
 */
export function electronNoticeSources(electronDist: string, packagedVersion: string): { from: string; to: Notice['to'] }[] {
  const versionFile = path.join(electronDist, 'version');
  if (!fs.existsSync(versionFile)) {
    throw new Error(`${electronDist} holds no installed Electron, so the app would ship without Electron's notices: reinstall electron without ELECTRON_SKIP_BINARY_DOWNLOAD`);
  }
  const recorded = fs.readFileSync(versionFile, 'utf8').trim();
  if (recorded !== packagedVersion) {
    throw new Error(`${electronDist} is Electron ${recorded}, and the app packages Electron ${packagedVersion}: its notices would describe another Electron`);
  }
  return ELECTRON_NOTICES.map(({ from, to }) => {
    const source = path.join(electronDist, from);
    if (!fs.existsSync(source)) {
      throw new Error(`${source} is missing, so the app would ship without Electron's notices: reinstall electron without ELECTRON_SKIP_BINARY_DOWNLOAD`);
    }
    return { from: source, to };
  });
}

/**
 * Puts Electron's notices where a packaged app carries them: copied into `resources` on macOS; checked beside the
 * executable, in `appOutDir`, on Windows and Linux, where electron-builder put them.
 */
export function shipElectronNotices(options: {
  platform: string;
  appOutDir: string;
  /** The macOS bundle's `Contents/Resources` */
  resources: string;
  electronDist: string;
  packagedVersion: string;
}): string[] {
  if (options.platform === 'darwin') {
    return electronNoticeSources(options.electronDist, options.packagedVersion).map(({ from, to }) => {
      const destination = path.join(options.resources, to);
      fs.copyFileSync(from, destination);
      return destination;
    });
  }
  return ELECTRON_NOTICES.map(({ to }) => {
    const shipped = path.join(options.appOutDir, to);
    if (!fs.existsSync(shipped)) {
      throw new Error(`${shipped} is missing: electron-builder did not leave Electron's notices beside the executable`);
    }
    return shipped;
  });
}
