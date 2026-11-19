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
 *
 * **On macOS Electron carries two frameworks those notices don't name** (`MAC_FRAMEWORKS`): Mantle and ReactiveObjC,
 * which its updater, Squirrel.Mac, is built with. Their licenses, committed under `build/licenses/` from the commits
 * Electron's DEPS pins, are copied beside Electron's, and a framework the app carries that nothing credits fails the
 * build.
 *
 * **FFmpeg, which Electron builds in on every platform, is under LGPL-2.1-or-later**, which asks a binary's recipient
 * to be told where its source is: `ffmpegSource` is that pointer, for the notices' header, read for one Electron
 * (`READ_FOR_ELECTRON`), and a problem for any other.
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
 * Every framework Electron's macOS app carries, and the license each adds to Electron's notices, from
 * `build/licenses/`, for one `LICENSES.chromium.html` does not name: it names Electron Framework's libraries and
 * Squirrel, and not the two Squirrel is built with
 */
export const MAC_FRAMEWORKS: readonly { framework: string; license?: { from: string; to: string } }[] = [
  { framework: 'Electron Framework.framework' },
  { framework: 'Squirrel.framework' },
  { framework: 'Mantle.framework', license: { from: 'Mantle-LICENSE.md', to: 'LICENSE.Mantle.md' } },
  { framework: 'ReactiveObjC.framework', license: { from: 'ReactiveObjC-LICENSE.md', to: 'LICENSE.ReactiveObjC.md' } },
];

/**
 * The Electron `ffmpegSource` and `MAC_FRAMEWORKS`' licenses were read for: its DEPS at that tag pins `chromium`, whose
 * DEPS pins `third_party/ffmpeg` at `ffmpeg`, which Electron patches (`patches/ffmpeg` at its tag), and pins the Mantle
 * and ReactiveObjC commits whose licenses are committed
 */
export const READ_FOR_ELECTRON = { electron: '44.9.3', chromium: '152.0.7977.167', ffmpeg: '2b68d2babae73714846961fb0ee47e3b3d2e39a9' } as const;

/**
 * Where the source of the FFmpeg Electron builds in is, as a pointer for the notices' header, and a problem when the
 * app packages another Electron than the one it was read for
 */
export function ffmpegSource(packagedVersion: string): { pointer: string; problem?: string } {
  const { electron, chromium, ffmpeg } = READ_FOR_ELECTRON;
  const pointer = "FFmpeg's, the media library Electron builds in (libffmpeg.dylib, ffmpeg.dll or libffmpeg.so), under "
    + `LGPL-2.1-or-later: its notice is in LICENSES.chromium.html, and its source is https://chromium.googlesource.com/chromium/third_party/ffmpeg at ${ffmpeg}, `
    + `the revision Chromium ${chromium} pins, with Electron's patches in https://github.com/electron/electron/tree/v${electron}/patches/ffmpeg`;
  if (packagedVersion === electron) return { pointer };
  return {
    pointer,
    problem: `The app packages Electron ${packagedVersion}, and FFmpeg's source and the macOS frameworks' licenses were read for Electron ${electron}: `
      + `read Electron's DEPS at v${packagedVersion} for its chromium_version, mantle_version and reactiveobjc_version, that Chromium's DEPS for its ffmpeg_revision, `
      + 'and the LICENSE.md of Mantle and ReactiveObjC at those commits, then update READ_FOR_ELECTRON and the texts',
  };
}

/** Where the app's notices say Electron's are, on the platform it is built for */
export function electronNoticesPointer(platform: string): string {
  if (platform !== 'darwin') return "Electron's and Chromium's: LICENSE.electron.txt and LICENSES.chromium.html, beside the app's executable";
  const frameworks = MAC_FRAMEWORKS.flatMap(({ license }) => (license ? [license.to] : []));
  return `Electron's and Chromium's: LICENSE.electron.txt and LICENSES.chromium.html in the app's Resources folder, with ${frameworks.join(' and ')} there for the frameworks Electron's updater is built with`;
}

/**
 * The licenses of the frameworks the packaged macOS app carries, refusing a framework `MAC_FRAMEWORKS` does not name,
 * whose license nothing would carry, and one it names that the app no longer carries, whose text is stale
 */
function macFrameworkLicenses(frameworksDir: string, licensesDir: string): { from: string; to: string }[] {
  const carried = fs.existsSync(frameworksDir) ? fs.readdirSync(frameworksDir).filter((name) => name.endsWith('.framework')) : [];
  const unnamed = carried.filter((name) => !MAC_FRAMEWORKS.some(({ framework }) => framework === name));
  if (unnamed.length) {
    throw new Error(`${frameworksDir} holds ${unnamed.join(', ')}, which nothing credits: find each one's license, and add it to MAC_FRAMEWORKS`);
  }
  const gone = MAC_FRAMEWORKS.filter(({ framework }) => !carried.includes(framework)).map(({ framework }) => framework);
  if (gone.length) {
    throw new Error(`MAC_FRAMEWORKS names ${gone.join(', ')}, which ${frameworksDir} does not hold: remove each one, and its license`);
  }
  return MAC_FRAMEWORKS.flatMap(({ license }) => (license ? [{ from: path.join(licensesDir, license.from), to: license.to }] : []));
}

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
 * Puts Electron's notices where a packaged app carries them: copied into `resources` on macOS, with the licenses of the
 * frameworks they don't name; checked beside the executable, in `appOutDir`, on Windows and Linux, where
 * electron-builder put them.
 */
export function shipElectronNotices(options: {
  platform: string;
  appOutDir: string;
  /** The macOS bundle's `Contents/Resources`, beside the `Contents/Frameworks` it reads */
  resources: string;
  electronDist: string;
  packagedVersion: string;
  /** `build/licenses/`, holding `MAC_FRAMEWORKS`' texts */
  licensesDir: string;
}): string[] {
  if (options.platform === 'darwin') {
    const frameworks = macFrameworkLicenses(path.join(options.resources, '..', 'Frameworks'), options.licensesDir);
    return [...electronNoticeSources(options.electronDist, options.packagedVersion), ...frameworks].map(({ from, to }) => {
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
