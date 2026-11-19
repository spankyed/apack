import * as fs from 'node:fs';
import * as path from 'node:path';
import { replaceDir } from '@apackdev/host/replace-dir';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import semver from 'semver';
import { downloadVerified, listAppReleases, type Download, type Release, type ReleaseAsset } from './app-releases.ts';

const PRODUCT_NAME = 'apack Beta';
/** Release file names use the product name without spaces (electron-builder.mjs artifactName). */
const BETA_RELEASE_PREFIX = 'apack-Beta';

export interface BetaRelease {
  version: string;
  zip: ReleaseAsset;
  checksum: ReleaseAsset;
}

export interface BetaAppOptions {
  /** semver range the app version must satisfy (the pack's hostVersion) */
  hostVersion: string;
  cacheDir: string;
  /** Injected for tests; defaults to Octokit (authenticated when GITHUB_TOKEN/GH_TOKEN is set). */
  listReleases?: () => Promise<Release[]>;
  download?: Download;
  log?: (message: string) => void;
}

export interface PackagedApp {
  version: string;
  executable: string;
}

/**
 * Newest beta release whose app satisfies hostVersion and that ships a zip with its checksum.
 * The app version comes from the zip name: a beta promoted from a production release
 * (v<version>-beta.0, see build/release/beta-tag.sh) contains the production app, and the
 * app's installer checks hostVersion against that version, not the tag's.
 */
export function pickBetaRelease(releases: Release[], hostVersion: string): BetaRelease | null {
  const zipPattern = new RegExp(`^${BETA_RELEASE_PREFIX}-(.+)-mac-arm64\\.zip$`);
  const candidates = releases
    .filter(r => !r.draft && r.prerelease)
    .map(r => ({ release: r, version: semver.valid(r.tag_name.replace(/^v/, '')) }))
    .filter((c): c is { release: Release; version: string } => c.version !== null && semver.prerelease(c.version)?.[0] === 'beta')
    .sort((a, b) => semver.rcompare(a.version, b.version));

  for (const { release, version } of candidates) {
    const zip = release.assets.find(a => zipPattern.test(a.name));
    const checksum = zip && release.assets.find(a => a.name === `${zip.name}.sha256`);
    if (!zip || !checksum) continue;
    const appVersion = semver.valid(zip.name.match(zipPattern)![1]) ?? version;
    if (semver.satisfies(appVersion, hostVersion, { includePrerelease: true })) return { version, zip, checksum };
  }
  return null;
}

export function packagedExecutable(appDir: string): string {
  return path.join(appDir, `${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME);
}

/** Where downloaded builds live, one directory per release tag. The one place this path is spelled. */
export const betaCacheDir = (cacheDir: string): string => path.join(cacheDir, 'apps', 'beta');

/** A downloaded build: the tag its directory carries, and the app inside it */
export interface CachedBeta {
  tag: string;
  dir: string;
  executable: string;
}

/**
 * Every downloaded build, newest tag first — what resolution chooses from and what `apack cache clean`
 * reclaims. Enumerating is this module's business because it owns the layout; *which* build a pack's range
 * accepts is `cachedBetaApp`'s (`pack-host.ts`), which reads each app's own version to answer it.
 *
 * A version appears here only once fully extracted: `ensureBetaApp` stages under a dot-prefixed name and
 * renames it into place, and `semver.valid` rejects the staging name. `betaDownloadLeftovers` is the other
 * half of that — the staging dirs a killed run left, which nothing else would ever look at again.
 */
export function cachedBetaBuilds(cacheDir: string): CachedBeta[] {
  const root = betaCacheDir(cacheDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(tag => semver.valid(tag))
    .sort(semver.rcompare)
    .map(tag => ({ tag, dir: path.join(root, tag), executable: packagedExecutable(path.join(root, tag)) }));
}

/** Staging directories a download that was killed left behind: never read again, so only ever litter */
export function betaDownloadLeftovers(cacheDir: string): string[] {
  const root = betaCacheDir(cacheDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(name => name.startsWith('.') && name.includes('.download-'))
    .map(name => path.join(root, name));
}

/**
 * The newest apack Beta build that satisfies the pack's hostVersion, downloaded once per
 * version into the cache and verified against its published sha256.
 *
 * **The downloader, not the cache policy.** Resolution asks `cachedBetaApp` (`pack-host.ts`) first and
 * reaches this only when no downloaded build satisfies the range, so listing releases here is the answer to
 * "which build do I fetch". The `existsSync` below is narrower than it looks: it keeps two runs racing one
 * version from downloading it twice.
 */
export async function ensureBetaApp(options: BetaAppOptions): Promise<PackagedApp> {
  const { hostVersion, cacheDir, log = console.log } = options;
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('apack pack test downloads apack Beta for macOS on Apple Silicon only. Point `apack pack test` at a local apack checkout with --host <path>.');
  }

  const releases = await (options.listReleases ?? listAppReleases)();
  const release = pickBetaRelease(releases, hostVersion);
  if (!release) {
    throw new Error(`No apack Beta release satisfies this pack's hostVersion (${hostVersion}). Use --host <path> to test against a local checkout.`);
  }

  const appDir = path.join(betaCacheDir(cacheDir), release.version);
  const executable = packagedExecutable(appDir);
  if (fs.existsSync(executable)) return { version: release.version, executable };

  fs.mkdirSync(path.dirname(appDir), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(appDir), `.${release.version}.download-`));
  try {
    log(`Downloading apack Beta ${release.version}...`);
    const zipPath = path.join(staging, release.zip.name);
    await downloadVerified({ asset: release.zip, checksum: release.checksum, to: zipPath, download: options.download });

    // ditto keeps the app bundle's symlinks, permissions and signature intact
    const extracted = path.join(staging, 'app');
    await promisify(execFile)('ditto', ['-x', '-k', zipPath, extracted]);
    if (!fs.existsSync(packagedExecutable(extracted))) {
      throw new Error(`${release.zip.name} does not contain ${PRODUCT_NAME}.app`);
    }
    // Another run may have finished the same download meanwhile; keep the app it may be using.
    //
    // `replaceDir` rather than a remove and a rename: removing first leaves the cached app absent, and a run
    // that has already checked `executable` can be launching it. It also makes the check above advisory
    // rather than load-bearing — two runs that both find it missing would otherwise rename onto each other's
    // directory, which is not a portable operation. The copy it moves aside lands in `staging`, so the
    // `finally` below removes it.
    if (!fs.existsSync(executable)) replaceDir(extracted, appDir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 5 });
  }

  return { version: release.version, executable };
}
