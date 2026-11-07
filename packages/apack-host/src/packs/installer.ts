import { assertPackSettings } from './settings-admission.ts';
import * as fs from 'fs';
import { INSTALL_RECORD_RECOVERY } from './staging.ts';
import { readAppPackSources, type AppPackSources } from './app-sources.ts';
import { readInstalledPacks, writeInstalledPacks, type PackRecord } from './installed.ts';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { isDeepStrictEqual } from 'node:util';
import { parse, satisfies } from 'semver';
import { replaceDir } from '../replace-dir.ts';
import { DOWNLOAD_TIMEOUT_MS, fetchReleaseAsset, githubFetch, type GitHubReleaseAsset } from './github.ts';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { parseManifest } from '@apackdev/sdk/build';
import { createLogger } from '@apackdev/sdk/logger';
import type { PackManifest } from '@apackdev/sdk/build';
import {
  PACK_LAYOUT,
  assertChecksum,
  extractPackArchive,
  hasBuiltPackSections,
  isPackLayout,
  stagePack,
  verifyPack,
  packBuildProblem,
  shippedPackRevision,
  type PackIntegrity,
} from './layout.ts';
import { errorMessage as reason } from '@apackdev/sdk/utils/pure';

// The CLI installs without an app bound: its entries go to the console then
const log = createLogger('pack-installer');

export interface InstallResult {
  id: string;
  name: string;
  version: string;
  dir: string;
  missingDependencies: string[];
  integrity: PackIntegrity;
}

export interface InstallOptions {
  /** Supplied by the profile owner; evaluated against the verified candidate before placement. */
  settingsOverrides?: () => unknown;
  /** When supplied, accept user ownership in this target profile before publishing the candidate. */
  installedPacksFile?: string;
  /**
   * Accept the verified candidate at its final path before retiring the previous directory.
   * Throw to restore the previous files. Keep initialization and other irreversible work outside
   * this synchronous decision; filesystem rollback cannot undo callback effects.
   */
  accept?: (candidate: Readonly<InstallResult>, previousDirectory?: string) => undefined;
  /** Refuse packs whose manifest hostVersion this host doesn't satisfy (the app passes its version). */
  hostVersion?: string;
  /** Expected sha256 of a downloaded archive. */
  sha256?: string;
  /**
   * Called after the private candidate copy, receipt, declarations and compatibility are verified,
   * with the manifest of that candidate, before the pack's directory is
   * touched. The last moment a caller can act on the copy that is still there: the running app tears an
   * installed pack down here, so it is never left running on files that have been replaced underneath it.
   * The pack's id isn't known before this — a GitHub slug or a URL doesn't carry one.
   */
  beforePlace?: (manifest: Readonly<PackManifest>) => void;
  /**
   * The pack snapshot format the app that will load the pack reads, so a build in any other is refused: the app
   * passes its own (`PACK_SNAPSHOT_FORMAT`), `apack pack install` and `apack pack dev` the one the app recorded in the data
   * dir (`readHostCompatibility`). Without it — no apack that records it has started with the data dir — a build this
   * process can't read is only warned about, and the app's loader decides at its next start.
   */
  packFormat?: number;
}

/** Reports a download's failure with its URL: a timeout, a refused connection, a body that stopped mid-way. */
function downloadFailed(url: string) {
  return (err: unknown): never => {
    throw new Error(`Downloading ${url} failed: ${err instanceof Error ? err.message : err}`);
  };
}

function ensurePacksDir(targetDir?: string): string {
  const dir = targetDir ?? resolveAppEnvironment().packsDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extractZip(zipPath: string, destDir: string): void {
  execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'pipe' });
}

function readValidManifest(dir: string): PackManifest {
  const manifestPath = path.join(dir, 'apack.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('No apack.json found in pack source');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    throw new Error('apack.json is not valid JSON');
  }

  const { diagnostics } = parseManifest(raw);
  if (diagnostics.length > 0) {
    throw new Error(`Invalid apack.json:\n${diagnostics.map(({ message }) => `  - ${message}`).join('\n')}`);
  }
  return raw as PackManifest;
}

/**
 * Whether an app at `appVersion` satisfies a pack's `hostVersion` range.
 *
 * A prerelease counts as its release, the same rule the migrations runner states: `0.4.0-beta.2` runs
 * the `0.4.0` migrations, and here it installs the packs that ask for `>=0.4.0`. Semver orders a
 * prerelease *before* its release, so without this a beta refuses every pack that requires the release
 * it is a beta of — which is the release those packs are being tested against. The trade is the same
 * one migrations already take: a pack asking for `>=0.4.0` installs on an early beta that may not have
 * everything it needs yet.
 */
export function isHostCompatible(hostRange: string | undefined, appVersion: string): boolean {
  if (!hostRange) return true;
  try {
    const parsed = parse(appVersion);
    const asRelease = parsed && parsed.prerelease.length > 0 ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : appVersion;
    return satisfies(asRelease, hostRange, { includePrerelease: true });
  } catch {
    return false;
  }
}

function assertHostCompatible(manifest: PackManifest, hostVersion?: string): void {
  if (!hostVersion || !manifest.hostVersion) return;
  if (!isHostCompatible(manifest.hostVersion, hostVersion)) {
    throw new Error(`Pack ${manifest.id}@${manifest.version} requires apack ${manifest.hostVersion}; this is ${hostVersion}`);
  }
}

function findPackRoot(dir: string): string {
  if (fs.existsSync(path.join(dir, 'apack.json'))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.isSymbolicLink());
  if (dirs.length === 1) {
    const child = path.join(dir, dirs[0].name);
    if (fs.existsSync(path.join(child, 'apack.json'))) return child;
  }
  return dir;
}

/** Dependencies not installed in `packsDir`. */
export function checkDependencies(
  manifest: { dependencies?: Record<string, string> },
  packsDir: string,
): string[] {
  const deps = manifest.dependencies ?? {};
  if (Object.keys(deps).length === 0) return [];
  // Every pack is installed, the ones the app ships included, so the packs directory is the whole answer:
  // one lookup, and a dependency is there or it is not
  return Object.keys(deps).filter((depId) => !fs.existsSync(path.join(packsDir, depId, PACK_LAYOUT.manifest)));
}

/** What installing the packs the app ships came to, per pack */
export interface ShippedPackInstall {
  id: string;
  /** Installation decisions; unchanged source identity does not certify the installed build's health. */
  outcome: 'installed' | 'updated' | 'unchanged' | 'preserved' | 'suppressed' | 'failed';
  /** Why, when it failed */
  error?: string;
}

/** Install missing shipped packs and refresh only explicitly app-managed installations. */
export interface ShippedInstallOptions extends InstallOptions {
  /** Installation decisions for the same target profile as packsDir. Always explicit. */
  installedPacksFile: string;
  /** Refresh only this declared pack id, using the same ownership decision as boot. */
  only?: string;
}

export async function installShippedPacks(shippedDir: string, packsDir: string, options: ShippedInstallOptions): Promise<ShippedPackInstall[]> {
  if (!fs.existsSync(shippedDir)) return [];
  return installCapturedShippedPacks(readAppPackSources(shippedDir), packsDir, options);
}

/** Install captured offers; staging still verifies copied bytes and their expected source revision. */
export async function installCapturedShippedPacks(catalog: AppPackSources, packsDir: string, options: ShippedInstallOptions): Promise<ShippedPackInstall[]> {
  const results: ShippedPackInstall[] = [];
  for (const problem of catalog.problems) {
    if (options.only === undefined || problem.id === options.only) results.push({ id: problem.id, outcome: 'failed', error: problem.message });
  }
  for (const source of catalog.sources) {
    const { id, sourceRevision: revision } = source;
    try {
      if (options.only !== undefined && id !== options.only) continue;
      const records = readInstalledPacks(options.installedPacksFile, { strict: true });
      const record = records.find(record => record.id === id);
      const installedDir = path.join(packsDir, id);
      const wasInstalled = fs.existsSync(installedDir);
      if (record?.suppressAppInstall) {
        results.push({ id, outcome: 'suppressed' });
        continue;
      }
      if (wasInstalled && !fs.statSync(installedDir).isDirectory()) {
        throw new Error(`Installed pack path is not a directory: ${installedDir}`);
      }
      if (wasInstalled && record?.updatesWith !== 'app') {
        results.push({ id, outcome: 'preserved' });
        continue;
      }
      if (wasInstalled && record?.shippedRevision === revision) {
        results.push({ id, outcome: 'unchanged' });
        continue;
      }
      await installPackFromLocal(source.dir, packsDir, {
        ...options,
        installedPacksFile: undefined,
        accept: (candidate, previousDirectory) => {
          if (candidate.id !== id || shippedPackRevision(candidate.integrity.files) !== revision) {
            throw new Error(`App source "${id}" changed before installation acceptance; retry the complete build`);
          }
          return withInstallationRecord(options.installedPacksFile, id,
            previous => appInstallationRecord(previous, candidate, false), () => options.accept?.(candidate, previousDirectory), previousDirectory);
        },
      });
      results.push({ id, outcome: wasInstalled ? 'updated' : 'installed' });
    } catch (err) {
      results.push({ id, outcome: 'failed', error: reason(err) });
    }
  }
  return results;
}

/** Deliberately restore the named shipped build, including a missing or user-owned installation. */
export function restoreShippedPack(
  id: string, source: string, packsDir: string,
  options: InstallOptions & { installedPacksFile: string; expectedSourceRevision?: string },
): Promise<InstallResult> {
  return installAppPackSource(id, source, packsDir, options, 'restore');
}

/** Update selected app-owned bytes without enabling a disabled pack or adopting a user fork. */
export async function updateShippedPack(
  id: string, source: string, packsDir: string,
  options: InstallOptions & { installedPacksFile: string; expectedSourceRevision: string },
): Promise<InstallResult> {
  const record = readInstalledPacks(options.installedPacksFile, { strict: true }).find(record => record.id === id);
  if (record?.updatesWith !== 'app') throw new Error(`Pack "${id}" is user-managed; use Restore to resume app updates`);
  if (!fs.existsSync(path.join(packsDir, id))) throw new Error(`Pack "${id}" is not installed; use Restore`);
  if (record.shippedRevision === options.expectedSourceRevision) throw new Error(`App source "${id}" is unchanged; use Restore to reinstall`);
  return installAppPackSource(id, source, packsDir, options, 'update');
}

function installAppPackSource(
  id: string, source: string, packsDir: string,
  options: InstallOptions & { installedPacksFile: string; expectedSourceRevision?: string }, operation: 'restore' | 'update',
): Promise<InstallResult> {
  return installPackFromLocal(source, packsDir, {
    ...options, installedPacksFile: undefined,
    beforePlace: manifest => {
      if (manifest.id !== id) throw new Error(`${operation === 'restore' ? 'Restore' : 'Update'} expected pack "${id}", received "${manifest.id}"`);
      options.beforePlace?.(manifest);
    },
    accept: (candidate, previousDirectory) => {
      if (options.expectedSourceRevision !== undefined
        && shippedPackRevision(candidate.integrity.files) !== options.expectedSourceRevision) {
        throw new Error(`App source "${id}" changed before ${operation === 'restore' ? 'restoration' : 'update'} acceptance; retry the complete build`);
      }
      return withInstallationRecord(options.installedPacksFile, id,
        previous => {
          if (operation === 'update' && previous.updatesWith !== 'app') throw new Error(`Pack "${id}" is no longer app-managed`);
          return appInstallationRecord(previous, candidate, operation === 'restore');
        }, () => options.accept?.(candidate, previousDirectory), previousDirectory);
    },
  });
}

function appInstallationRecord(previous: PackRecord, candidate: Readonly<InstallResult>, enable: boolean): PackRecord {
  const { installedFrom: _source, availableVersion: _version, availableTag: _tag,
    updateCheckError: _check, suppressAppInstall: _suppression, ...record } = previous;
  return { ...record, enabled: enable ? true : previous.enabled, updatesWith: 'app',
    shippedRevision: shippedPackRevision(candidate.integrity.files),
    installedAt: previous.installedAt ?? new Date().toISOString() };
}

/** Save installation intent before the synchronous filesystem/runtime decision, restoring it on refusal. */
function withInstallationRecord(
  file: string, id: string, update: (record: PackRecord) => PackRecord, accept: () => undefined, previousDirectory?: string,
): undefined {
  const existed = fs.existsSync(file);
  const previous = readInstalledPacks(file, { strict: true });
  const record = update(previous.find(record => record.id === id) ?? { id, enabled: true });
  const next = previous.some(record => record.id === id)
    ? previous.map(existing => existing.id === id ? record : existing) : [...previous, record];
  const recovery = previousDirectory && path.join(previousDirectory, INSTALL_RECORD_RECOVERY);
  if (recovery) fs.writeFileSync(recovery, JSON.stringify({ packs: previous.filter(record => record.id === id) }), { flag: 'wx' });
  if (!writeInstalledPacks(next, file)) {
    if (recovery) fs.rmSync(recovery);
    throw new Error(`Cannot save installation decisions: ${file}`);
  }
  try { return accept(); }
  catch (error) {
    const rollback: unknown[] = [];
    try {
      if (!existed) fs.rmSync(file, { force: true });
      else if (!writeInstalledPacks(previous, file)) throw new Error(`Cannot restore installation decisions: ${file}`);
    } catch (failure) { rollback.push(failure); }
    // Removed even when the record could not be restored: the previous build is about to be put back where the
    // pack runs from, and verification refuses a file its receipt doesn't list
    try { if (recovery) fs.rmSync(recovery, { force: true }); }
    catch (failure) { rollback.push(failure); }
    if (rollback.length) throw new AggregateError([error, ...rollback], 'Installation was refused and record rollback failed');
    throw error;
  }
}

/** Copy across filesystems into a private candidate, retaining the exact accepted receipt. */
function preparePack(sourceDir: string, packsDir: string, expected: PackIntegrity): string {
  const incoming = fs.mkdtempSync(path.join(packsDir, `.${expected.id}.installing-${process.pid}-`));
  try {
    fs.cpSync(fs.realpathSync(sourceDir), incoming, { recursive: true });
    if (!isDeepStrictEqual(verifyPack(incoming), expected)) {
      throw new Error('Pack changed while preparing installation; retry with the complete pack');
    }
    return incoming;
  } catch (err) {
    fs.rmSync(incoming, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Install from a directory that is one of:
 * - a pack layout (integrity.json): verified, then copied as-is
 * - a pack source built in that layout (dist/runtime, dist/types): staged first
 */
async function installFromDirectory(dir: string, packsDir: string, options: InstallOptions): Promise<InstallResult> {
  const manifestSource = readValidManifest(dir);
  assertHostCompatible(manifestSource, options.hostVersion);

  let layoutDir = dir;
  let stageRoot: string | undefined;
  let incoming: string | undefined;
  try {
    if (!isPackLayout(dir) && hasBuiltPackSections(dir)) {
      stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-stage-'));
      layoutDir = path.join(stageRoot, manifestSource.id);
      try { stagePack(dir, layoutDir, { packFormat: options.packFormat }); }
      catch (error) { throw new Error(`Pack "${manifestSource.id}" can't be installed: ${reason(error)}`); }
    }
    if (!isPackLayout(layoutDir)) {
      throw new Error(`Pack ${manifestSource.id} is not built: ${dir} has no ${PACK_LAYOUT.integrity} and no dist/${PACK_LAYOUT.runtimeEntry} with dist/${PACK_LAYOUT.snapshot}. Run "apack pack build" first.`);
    }
    const integrity = verifyPack(layoutDir);
    if (integrity.id !== manifestSource.id) throw new Error('Pack identity changed while preparing installation; retry with the complete pack');
    incoming = preparePack(layoutDir, packsDir, integrity);
    const manifest = readValidManifest(incoming);
    assertHostCompatible(manifest, options.hostVersion);
    // Refused here rather than at the app's next start, where the loader would skip it
    const buildProblem = packBuildProblem(incoming, options.packFormat);
    if (buildProblem) {
      if (options.packFormat !== undefined || buildProblem.kind !== 'format') throw new Error(`Pack "${integrity.id}" can't be installed: ${buildProblem.message}`);
      log.warn(`Pack "${integrity.id}" may not load: ${buildProblem.message}; which one apack reads isn't recorded in its data dir. The app checks the build before loading it and reports refusals in its Packs view`);
    }

    if (options.settingsOverrides) assertPackSettings(manifest, options.settingsOverrides());
    options.beforePlace?.(structuredClone(manifest));
    const destDir = path.join(packsDir, manifest.id);
    const result: InstallResult = {
      id: manifest.id, name: manifest.name, version: manifest.version, dir: destDir,
      missingDependencies: [], integrity,
    };
    replaceDir(incoming, destDir, previousDirectory => {
      result.missingDependencies = checkDependencies(manifest, packsDir);
      const accept = () => options.accept?.(structuredClone(result), previousDirectory);
      if (!options.installedPacksFile) return accept();
      return withInstallationRecord(options.installedPacksFile, manifest.id, previous => {
        const { shippedRevision: _revision, suppressAppInstall: _suppression, ...record } = previous;
        return { ...record, enabled: previous.suppressAppInstall ? true : previous.enabled, updatesWith: 'user' };
      }, accept, previousDirectory);
    });
    incoming = undefined;
    log.info(`Installed "${manifest.name}" v${manifest.version} to ${destDir}`);
    return result;
  } finally {
    if (incoming) fs.rmSync(incoming, { recursive: true, force: true });
    if (stageRoot) fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function validateExpectedChecksum(options: InstallOptions): void {
  if (options.sha256 !== undefined && !/^[a-f\d]{64}$/i.test(options.sha256)) {
    throw new Error('Expected archive checksum must be a 64-character SHA-256 hash');
  }
}

export async function installPackFromLocal(inputPath: string, targetPacksDir?: string, options: InstallOptions = {}): Promise<InstallResult> {
  validateExpectedChecksum(options);
  const expanded = inputPath.startsWith('~') ? inputPath.replace('~', os.homedir()) : inputPath;
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path not found: ${resolved}`);
  }

  const packsDir = ensurePacksDir(targetPacksDir);
  if (fs.statSync(resolved).isDirectory()) {
    return installFromDirectory(resolved, packsDir, options);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-install-'));
  try {
    // Every archive is checked before anything is unpacked, whatever its format
    if (options.sha256) assertChecksum(resolved, options.sha256);
    let root: string;
    if (resolved.endsWith('.tgz') || resolved.endsWith('.tar.gz')) {
      root = await extractPackArchive(resolved, tmpDir);
    } else if (resolved.endsWith('.zip')) {
      extractZip(resolved, tmpDir);
      root = findPackRoot(tmpDir);
    } else {
      throw new Error('Source must be a directory, .zip, or .tgz file');
    }
    return await installFromDirectory(root, packsDir, options);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function installPackFromUrl(url: string, targetPacksDir?: string, options: InstallOptions = {}): Promise<InstallResult> {
  validateExpectedChecksum(options);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-install-'));
  try {
    const filename = new URL(url).pathname.split('/').pop() || 'pack.tgz';
    if (!/\.(tgz|tar\.gz|zip)$/.test(filename)) {
      throw new Error('URL must point to a .tgz or .zip file');
    }
    const downloadPath = path.join(tmpDir, filename);
    if (!options.sha256) {
      log.warn(`Installing ${filename} from ${url} without a checksum: nothing verifies what was downloaded`);
    }

    // The signal bounds the body too, so a download that stalls fails instead of hanging the install
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const response = await fetch(url, { signal }).catch(downloadFailed(url));
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    fs.writeFileSync(downloadPath, Buffer.from(await response.arrayBuffer().catch(downloadFailed(url))));

    return await installPackFromLocal(downloadPath, targetPacksDir, options);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function installPackFromGitHub(slug: string, targetPacksDir?: string, options: InstallOptions = {}): Promise<InstallResult> {
  validateExpectedChecksum(options);
  const [ownerRepo, tag] = slug.split('@');
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) {
    throw new Error('GitHub slug must be in the format owner/repo or owner/repo@tag');
  }

  const apiUrl = tag
    ? `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  const release = await (await githubFetch(apiUrl)).json() as { assets: GitHubReleaseAsset[] };
  const tgzAsset = release.assets.find(a => a.name.endsWith('.tgz'));
  if (!tgzAsset) {
    throw new Error(`No .tgz asset found in release${tag ? ` ${tag}` : ' (latest)'}`);
  }

  // Releases published by `apack pack release` carry <archive>.sha256; without one, nothing says what was downloaded is the release
  let sha256 = options.sha256;
  if (!sha256) {
    const checksumAsset = release.assets.find(a => a.name === `${tgzAsset.name}.sha256`);
    if (!checksumAsset) {
      throw new Error(`Release${tag ? ` ${tag}` : ' (latest)'} of ${owner}/${repo} has no ${tgzAsset.name}.sha256; publish one with "apack pack release", or install with a checksum you know`);
    }
    sha256 = (await (await fetchReleaseAsset(checksumAsset)).text()).trim().split(/\s+/)[0];
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`${checksumAsset.name} in ${owner}/${repo} doesn't hold a sha256 checksum`);
    }
  }

  // Downloaded through GitHub's API when authenticated, so private repositories install too
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-install-'));
  try {
    const downloadPath = path.join(tmpDir, tgzAsset.name);
    fs.writeFileSync(downloadPath, Buffer.from(await (await fetchReleaseAsset(tgzAsset)).arrayBuffer()));
    return await installPackFromLocal(downloadPath, targetPacksDir, { ...options, sha256 });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** The route the installer will use, also needed when recording whether GitHub updates are available. */
export function resolveInstallSourceKind(input: string, sourceKind?: string): 'local' | 'url' | 'github' {
  if (sourceKind === 'local' || sourceKind === 'url') return sourceKind;
  return input.startsWith('http://') || input.startsWith('https://') ? 'url' : 'github';
}

export async function installPack(packSlug: string, sourceKind?: string, targetPacksDir?: string, options: InstallOptions = {}): Promise<InstallResult> {
  const route = resolveInstallSourceKind(packSlug, sourceKind);
  if (route === 'local') {
    return installPackFromLocal(packSlug, targetPacksDir, options);
  }
  if (route === 'url') {
    return installPackFromUrl(packSlug, targetPacksDir, options);
  }
  return installPackFromGitHub(packSlug, targetPacksDir, options);
}

export async function uninstallPack(packId: string, targetPacksDir: string | undefined, { installedPacksFile }: { installedPacksFile: string }): Promise<void> {
  // The id becomes a path that is deleted recursively: `..` would be the data dir, and `''` every pack
  if (!PACK_ID_PATTERN.test(packId)) throw new Error(`"${packId}" is not a pack id`);
  const packsDir = path.resolve(targetPacksDir ?? resolveAppEnvironment().packsDir);
  const packDir = path.resolve(packsDir, packId);
  if (path.dirname(packDir) !== packsDir) throw new Error(`"${packId}" is not a pack in ${packsDir}`);

  if (!fs.existsSync(packDir)) {
    throw new Error(`Pack "${packId}" is not installed`);
  }

  withInstallationRecord(installedPacksFile, packId, previous => ({
    id: packId, enabled: previous.enabled, suppressAppInstall: true,
  }), () => { fs.rmSync(packDir, { recursive: true, force: true }); });
  log.info(`Uninstalled pack "${packId}"`);
}


