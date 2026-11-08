import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { replaceDir, stagingDirName } from '@apackdev/host/replace-dir';
import { execFileSync } from 'node:child_process';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import semver from 'semver';
import { PRODUCT_NAMES, type PublishedAppChannel } from './channels';
import type { AppChannel } from '@apackdev/sdk/env';
import { downloadVerified, listAppReleases, type Download, type Release } from './app-releases.ts';
import { holdExclusiveLock } from '@apackdev/host/exclusive-lock';

// `timeout` is CPU: the app quitting on a busy machine is slow, not stuck
const execFileAsync = execFileWhileWorking;

/** The release this channel wants, and the two assets it needs, or why there is none */
export interface AppRelease {
  version: string;
  zip: Release['assets'][number];
  checksum: Release['assets'][number];
}

/** Select the requested tag or newest channel release. Its ZIP and checksum must both be present. */
export function pickAppRelease(releases: Release[], channel: PublishedAppChannel, version?: string): AppRelease | null {
  const prefix = PRODUCT_NAMES[channel].replace(/ /g, '-');
  const zipPattern = new RegExp(`^${prefix}-(.+)-mac-arm64\\.zip$`);

  const candidates = releases
    .filter(r => (!version || r.tag_name.replace(/^v/, '') === version) && !r.draft && Boolean(r.prerelease) === (channel === 'beta'))
    .map(r => ({ release: r, version: semver.valid(r.tag_name.replace(/^v/, '')) }))
    .filter((c): c is { release: Release; version: string } => c.version !== null)
    .filter(c => channel === 'beta' || semver.prerelease(c.version) === null)
    .sort((a, b) => semver.rcompare(a.version, b.version));

  const release = candidates[0]?.release;
  if (!release) return null;
  // Parsing the captured version keeps production's prefix from matching the Beta product name.
  const zip = release.assets.find(asset => {
    const assetVersion = semver.valid(asset.name.match(zipPattern)?.[1] ?? '');
    return assetVersion !== null && (channel === 'beta' || assetVersion === release.tag_name.replace(/^v/, ''));
  });
  const checksum = zip && release.assets.find(asset => asset.name === `${zip.name}.sha256`);
  if (!zip || !checksum) return null;
  // A beta promoted from a production build carries that build's version, rather than its beta tag.
  return { version: semver.valid(zip.name.match(zipPattern)![1])!, zip, checksum };
}

/** What is installed at `appPath` now, or nothing when it is not there or says no version */
export function installedVersion(appPath: string): string | null {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(plist)) return null;
  try {
    const raw = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return semver.valid(raw.trim());
  } catch {
    return null;
  }
}

/** Quit this bundle gracefully, including instances using nondefault profiles. Never kill it. */
export async function quitApp(product: string, log: (message: string) => void,
  appPath = path.join('/Applications', `${product}.app`)): Promise<void> {
  const running = async () => {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], { timeout: 5_000 });
    return stdout.split('\n').some(line => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match && Number(match[1]) !== process.pid && match[2]!.startsWith(`${appPath}/Contents/`);
    });
  };
  if (!await running()) return;
  log(`Quitting ${product}...`);
  try {
    await execFileAsync('osascript', ['-e', `tell application ${JSON.stringify(appPath)} to quit`], { timeout: 10_000 });
  } catch {
    // An app may already be quitting; the process check below decides whether replacement can proceed.
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!await running()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${product} is still running. Quit it and run this again; its bundle was not changed.`);
}

export interface AppCommandOptions {
  action: 'install' | 'upgrade' | 'uninstall';
  channel: PublishedAppChannel;
  version?: string;
  replace?: boolean;
  force?: boolean;
  relaunch?: boolean;
}

/** System boundaries injected by fixture tests; never exposed as CLI destination overrides. */
export interface AppCommandDependencies {
  applicationsDir?: string;
  listReleases?: () => Promise<Release[]>;
  download?: Download;
  run?: (command: string, args: string[]) => Promise<void>;
  quit?: typeof quitApp;
  log?: (message: string) => void;
}

function bundleExists(appPath: string): boolean {
  try {
    const stat = fs.lstatSync(appPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${appPath} is not an app directory. Move it aside before continuing.`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function validateAppBundle(incoming: string, channel: AppChannel, expectedVersion?: string): string {
  if (!bundleExists(incoming)) throw new Error(`Download does not contain ${PRODUCT_NAMES[channel]}.app.`);
  const plist = path.join(incoming, 'Contents', 'Info.plist');
  const id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist], { encoding: 'utf8' }).trim();
  const expectedId = channel === 'production' ? 'dev.apack.app' : `dev.apack.${channel}`;
  const version = installedVersion(incoming);
  if (id !== expectedId || !version || (expectedVersion !== undefined && version !== expectedVersion)) {
    throw new Error(`App identity or version does not match ${PRODUCT_NAMES[channel]}${expectedVersion ? ` ${expectedVersion}` : ''}.`);
  }
  const executable = path.join(incoming, 'Contents', 'MacOS', PRODUCT_NAMES[channel]);
  if (!fs.lstatSync(executable).isFile()) throw new Error('Downloaded app has no regular executable.');
  fs.accessSync(executable, fs.constants.X_OK);
  return version;
}

/** Download and validate first; preserve the existing bundle until a staged replacement is ready. */
export async function manageInstalledApp(options: AppCommandOptions, deps: AppCommandDependencies = {}): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`apack is published for macOS on Apple Silicon only (current platform: ${process.platform}/${process.arch}).`);
  }
  const { action, channel } = options;
  const product = PRODUCT_NAMES[channel];
  const applications = deps.applicationsDir ?? '/Applications';
  const appPath = path.join(applications, `${product}.app`);
  const log = deps.log ?? console.log;
  const run = deps.run ?? (async (command, args) => { await execFileAsync(command, args); });
  const quit = deps.quit ?? quitApp;
  const lock = holdExclusiveLock({
    file: path.join(applications, `.${product}.manage.lock`),
    what: `apack ${action}`,
    refuse: holder => new Error(`Another app operation is running: ${holder}. Try again once it finishes.`),
  });
  let staging: string | undefined;
  let staged: string | undefined;
  try {
    const exists = bundleExists(appPath);
    if (action === 'install' && exists && !options.replace) {
      throw new Error(`${appPath} is already installed. Use --replace to replace it, or apack upgrade to update it.`);
    }
    if (action === 'upgrade' && !exists) throw new Error(`${product} is not installed. Run apack install first.`);
    if (action === 'uninstall') {
      if (!exists) { log(`${product} is not installed.`); return; }
      await quit(product, log, appPath);
      fs.rmSync(appPath, { recursive: true });
      log(`Uninstalled ${product}. Your data and settings were kept.`);
      return;
    }

    const have = exists ? installedVersion(appPath) : null;
    if (action === 'upgrade' && !have) throw new Error(`Cannot read the installed app's version. Use apack install --replace to repair it.`);
    log(`Looking for ${options.version ?? 'the latest'} ${product} release...`);
    const release = pickAppRelease(await (deps.listReleases ?? listAppReleases)(), channel, options.version);
    if (!release) throw new Error(`Could not find a complete ${product} ${options.version ?? 'latest'} release with its mac-arm64 zip and sha256.`);
    if (action === 'upgrade' && have && !options.force && semver.gte(have, release.version)) {
      log(`${product} ${have} is already installed; selected release is ${release.version}. Use --force to reinstall or downgrade.`);
      return;
    }
    staging = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-install-'));
    const zipPath = path.join(staging, release.zip.name);
    log(`Downloading ${release.zip.name}...`);
    await downloadVerified({ asset: release.zip, checksum: release.checksum, to: zipPath, download: deps.download });
    const expanded = path.join(staging, 'app');
    await run('ditto', ['-x', '-k', zipPath, expanded]);
    const incoming = path.join(expanded, `${product}.app`);
    validateAppBundle(incoming, channel, release.version);

    staged = path.join(applications, stagingDirName(`${product}.app`, 'installing'));
    await run('ditto', [incoming, staged]);
    validateAppBundle(staged, channel, release.version);
    if (exists) await quit(product, log, appPath);
    // Recheck at the last moment: an app installed outside this CLI also needs explicit replacement.
    if (action === 'install' && !options.replace && bundleExists(appPath)) {
      throw new Error(`${appPath} appeared during installation. Run again with --replace.`);
    }
    replaceDir(staged, appPath);
    log(`${product} ${release.version} installed at ${appPath}.`);
    if (options.relaunch) await run('open', [appPath]);
  } finally {
    try {
      if (staged) fs.rmSync(staged, { recursive: true, force: true });
      if (staging) fs.rmSync(staging, { recursive: true, force: true });
    } finally {
      lock.release();
    }
  }
}

