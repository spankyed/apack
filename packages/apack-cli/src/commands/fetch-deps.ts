import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { satisfies, rcompare, clean } from 'semver';
import { parsePackDependency, CONTENT_INDEX_FILE, _cliFormatMismatchMessage, _snapshotFormatMismatch, type PackDependencySnapshot } from '@apackdev/pack-format';
import { findPackRoot, readManifest } from '../utils';
import { PACK_LAYOUT, extractPackArchive, verifyPack, readDependencyBuild, readCachedDependency, cacheDependency, type DependencyOrigin, type DependencyResolution, type CachedDependencyBuild } from '@apackdev/host/packs';
import { waitForPackBuild } from '../build/build-lock.ts';
import { APP_ENVS, resolveAppEnvironment, type AppEnv } from '@apackdev/sdk/env';
import { configuredHostPackagesDir } from '../app/pack-host';

// ── Files discovery ──

/** A dependency's files: its snapshot, plus build code and a backend runtime when it ships them. */
export interface DepFiles {
  snapshot: PackDependencySnapshot;
  directory: string;
  kind: DependencyResolution['kind'];
  revision: string;
  origin?: DependencyOrigin;
  resolution?: DependencyResolution;
  /** Type data can be inspectable while executable dependency files are unavailable. */
  executionProblem?: string;
  /** Directory with the dependency's build-time code (build/steps.build.mjs, build/content-compilers.mjs), if present. */
  buildDir?: string;
  /** The dependency's backend runtime (runtime/index.cjs), if present: what a dependent's tests load. */
  runtimeEntry?: string;
  /** The compiled content its runtime reads (runtime/content/, or a built-in pack's dist/), with the runtime */
  contentDir?: string;
}

/** Read an installed layout or a source pack's built layout without importing code. */
export function findDepFiles(dir: string): DepFiles | null {
  for (const directory of [dir, path.join(dir, 'dist')]) {
    if (fs.existsSync(path.join(directory, PACK_LAYOUT.snapshot))) {
      return withBuildAndRuntime(readDependencyBuild(directory));
    }
  }
  return null;
}

function withBuildAndRuntime(build: Omit<CachedDependencyBuild, 'resolution'> & {
  kind: DependencyResolution['kind']; revision: string;
}): DepFiles {
  const { snapshot, directory, kind } = build;
  const mismatch = _snapshotFormatMismatch(snapshot);
  if (mismatch) return { ...build, executionProblem: _cliFormatMismatchMessage(mismatch) };
  if (kind === 'type-data') return { ...build, executionProblem: 'Dependency has no verified executable build; rebuild the complete pack.' };
  const buildDir = path.join(directory, PACK_LAYOUT.buildDir);
  const runtimeEntry = path.join(directory, PACK_LAYOUT.runtimeEntry);
  const contentDir = path.join(directory, PACK_LAYOUT.contentDir);
  const hasRuntime = fs.existsSync(runtimeEntry);
  return { ...build,
    ...(fs.existsSync(buildDir) && { buildDir }),
    ...(hasRuntime && { runtimeEntry }),
    ...(hasRuntime && fs.existsSync(path.join(contentDir, CONTENT_INDEX_FILE)) && { contentDir }),
  };
}

function fromCache(cached: CachedDependencyBuild): ResolvedDepFiles {
  return { ...withBuildAndRuntime({ directory: cached.directory, snapshot: cached.snapshot,
    kind: cached.resolution.kind, revision: cached.resolution.revision }), resolution: cached.resolution,
    origin: cached.resolution.origin, resolvedFrom: originLabel(cached.resolution.origin) };
}

function resolveFromLocal(root: string, depId: string): ResolvedDepFiles | null {
  const cached = readCachedDependency(root, depId);
  return cached && fromCache(cached);
}

function originLabel(origin: DependencyOrigin): string {
  return origin.kind === 'github' ? `github:${origin.repository}@${tagToVersion(origin.tag) ?? origin.tag}` : origin.selection;
}

function cacheDep(root: string, depId: string, spec: string, files: DepFiles): ResolvedDepFiles {
  if (!files.origin) throw new Error(`Dependency "${depId}" has no resolution origin`);
  return fromCache(cacheDependency(root, depId, files.directory, spec, files.origin));
}

// ── Workspace resolution ──

/**
 * A dependency in a directory the pack sits under: a workspace package (`<ancestor>/packages/<depId>`)
 * or a sibling checkout (`<ancestor>/<depId>`). The nearest ancestor wins, so a pack at any depth
 * inside an apack checkout (a test fixture, say) builds against that checkout's packages rather
 * than an installed app's older copy.
 */
async function resolveFromWorkspace(root: string, depId: string): Promise<DepFiles | null> {
  for (let dir = path.dirname(path.resolve(root)); ; dir = path.dirname(dir)) {
    for (const candidate of [path.join(dir, 'packages', depId), path.join(dir, depId)]) {
      // **A build of the dependency renames its `dist`, so a read taken during that swap finds no build dir
      // and `withBuildAndRuntime` reports one that is simply absent** — which surfaces downstream as the
      // dependency's content compiler coming back unresolved, naming the wrong cause. Waiting costs an
      // `existsSync` per candidate when no build is running, which is every ordinary resolution.
      await waitForPackBuild(candidate, { onWait: (holder) => console.error(`Waiting for ${holder} to finish...`) });
      const found = findDepFiles(candidate);
      if (found) return { ...found, origin: { kind: 'workspace', directory: path.resolve(candidate), selection: 'workspace' } };
    }
    if (path.dirname(dir) === dir) return null;
  }
}

// ── Installed app resolution ──

/** Whether a resolved dependency's version satisfies the range apack.json declares. */
function inRange(files: DepFiles, range: string): boolean {
  if (!range || range === '*') return true;
  const version = clean(files.snapshot.manifest?.version ?? '');
  return version !== null && satisfies(version, range, { includePrerelease: true });
}

/** Whether a validated candidate satisfies the declared version range. */
function usable(found: DepFiles | null, range: string, depId: string): found is DepFiles {
  if (found && found.snapshot.manifest.id !== depId) {
    throw new Error(`Dependency "${depId}" resolved to pack "${found.snapshot.manifest.id}"; correct its declared source.`);
  }
  return found !== null && inRange(found, range);
}

/** A pack installed in an apack's data dir (any channel) — the ones it ships among them. */
function resolveFromInstalledApp(depId: string, range: string): (DepFiles & { env: AppEnv }) | null {
  for (const env of APP_ENVS) {
    const found = findDepFiles(path.join(resolveAppEnvironment({ env }).packsDir, depId));
    if (usable(found, range, depId)) return { ...found, env, origin: { kind: 'installed-app', directory: path.resolve(resolveAppEnvironment({ env }).packsDir, depId), selection: `installed app (${env})` } };
  }
  return null;
}

/** Built-in packs of the app this pack is built against: a named one, or the checkout behind it. */
async function resolveFromConfiguredHost(root: string, depId: string, pinned = false, options: DependencyResolutionOptions = {}): Promise<(DepFiles & { label: string }) | null> {
  let hostVersion: string | undefined;
  try { hostVersion = readManifest(root).hostVersion; } catch {}
  const app = await configuredHostPackagesDir({ hostVersion, from: root, readOnly: options.readOnly });
  if (!app) return null;
  const dir = path.join(app.dir, depId);
  const found = findDepFiles(dir);
  if (pinned && !found && fs.existsSync(path.join(dir, PACK_LAYOUT.manifest))) {
    throw new Error(`Selected host dependency "${depId}" has no built snapshot in ${dir}. Build that host's pack before using it.`);
  }
  return found && { ...found, label: app.label, origin: { kind: 'host', directory: path.resolve(dir), selection: app.label } };
}

// ── File path resolution ──

function resolveFromFile(root: string, filePath: string): DepFiles | null {
  return findDepFiles(path.resolve(root, filePath));
}

// ── GitHub release resolution ──

export interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; url: string }>;
}

/**
 * The releases whose tags satisfy `range`, newest first.
 *
 * `includePrerelease`, as the local resolution check does (`inRange`): a dependency range is on the pack,
 * not on a release channel, so `*` has to match a `v0.2.0-beta.0` an author published on purpose. Without
 * it, semver treats every prerelease as out of range and a pack whose only releases are betas resolves to
 * nothing.
 */
export function releasesInRange(releases: GitHubRelease[], range: string): Array<{ release: GitHubRelease; version: string }> {
  return releases
    .map(r => ({ release: r, version: tagToVersion(r.tag_name) }))
    .filter((r): r is { release: GitHubRelease; version: string } =>
      r.version !== null && satisfies(r.version, range, { includePrerelease: true }))
    .sort((a, b) => rcompare(a.version, b.version));
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'apack-cli',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function tagToVersion(tag: string): string | null {
  return clean(tag.replace(/^v/, ''));
}

async function resolveFromGitHub(root: string, depId: string, repo: string, range: string, spec: string): Promise<DepFiles | null> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;

  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    if (res.status === 404) console.warn(`  GitHub repo not found: ${repo}`);
    else console.warn(`  GitHub API error (${res.status}) for ${repo}`);
    return null;
  }

  const candidates = releasesInRange(await res.json() as GitHubRelease[], range);
  if (candidates.length === 0) {
    console.warn(`  No release matching "${range}" in ${repo}`);
    return null;
  }

  // Select the newest satisfying release. Invalid files fail instead of silently substituting a release.
  for (const { release, version } of candidates) {
    // apack pack names the archive <id>-<version>.tgz and publishes its .sha256 next to it
    const asset = release.assets.find(a => a.name === `${depId}-${version}.tgz`);
    if (!asset) {
      console.warn(`  Release ${release.tag_name} in ${repo} has no ${depId}-${version}.tgz asset`);
      return null;
    }
    const checksumAsset = release.assets.find(a => a.name === `${asset.name}.sha256`);
    if (!checksumAsset) {
      console.warn(`  Release ${release.tag_name} in ${repo} has no ${asset.name}.sha256; refusing an unverifiable download`);
      return null;
    }

    const found = await downloadAndExtract(root, asset, checksumAsset, depId, version, { kind: 'github', repository: repo, tag: release.tag_name, archive: asset.url, checksum: checksumAsset.url }, spec);
    return found;
  }
  return null;
}

async function downloadAsset(assetUrl: string, dest: string): Promise<boolean> {
  const headers = { ...githubHeaders(), 'Accept': 'application/octet-stream' };
  const res = await fetch(assetUrl, { headers });
  if (!res.ok || !res.body) {
    console.warn(`  Failed to download asset (${res.status})`);
    return false;
  }
  const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  await pipeline(nodeStream, fs.createWriteStream(dest));
  return true;
}

async function downloadAndExtract(
  root: string,
  asset: { name: string; url: string },
  checksumAsset: { name: string; url: string },
  depId: string,
  version: string,
  origin: DependencyOrigin,
  spec: string,
): Promise<DepFiles | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-fetch-'));
  try {
    const archive = path.join(tmpDir, asset.name);
    if (!await downloadAsset(asset.url, archive)) return null;

    const checksumFile = path.join(tmpDir, checksumAsset.name);
    if (!await downloadAsset(checksumAsset.url, checksumFile)) return null;
    const sha256 = fs.readFileSync(checksumFile, 'utf-8').trim().split(/\s+/)[0];

    const extracted = await extractPackArchive(archive, path.join(tmpDir, 'extracted'), sha256);
    const bundle = verifyPack(extracted);
    if (bundle.id !== depId) {
      console.warn(`  ${asset.name} contains pack "${bundle.id}", not ${depId}`);
      return null;
    }
    if (bundle.version !== version) throw new Error(`Release ${depId}@${version} contains pack version ${bundle.version}; correct the published build.`);
    const files = findDepFiles(extracted);
    if (!files) {
      console.warn(`  No snapshot found in ${asset.name} for ${depId}@${version}`);
      return null;
    }
    usable(files, '*', depId);
    if (files.snapshot.manifest.version !== version) throw new Error(`Release ${depId}@${version} contains snapshot version ${files.snapshot.manifest.version}; correct the published build.`);
    // The temp dir is removed below; persist into the cache first
    return cacheDep(root, depId, spec, { ...files, origin });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

// ── apack.dev registry (stub) ──

async function lookupRegistry(_depId: string): Promise<string | null> {
  // TODO: implement when api.apack.dev is live
  // const res = await fetch(`https://api.apack.dev/packs/${depId}`);
  // if (!res.ok) return null;
  // const data = await res.json() as { github?: string };
  // return data.github ?? null;
  return null;
}

// ── Resolution chain ──

/**
 * A selected host owns its dependency files: never substitute a workspace or another app.
 * Otherwise prefer the workspace, linked checkout, then installed apps. All must satisfy the range.
 */
async function resolveFromMachine(root: string, depId: string, range: string, options: DependencyResolutionOptions = {}): Promise<(DepFiles & { resolvedFrom: string }) | null> {
  const pinned = Boolean(process.env.APACK_HOST_ROOT || process.env.APACK_HOST_EXECUTABLE || process.env.APACK_HOST);
  if (pinned) {
    const configured = await resolveFromConfiguredHost(root, depId, true, options);
    if (configured) {
      const version = configured.snapshot.manifest.version;
      if (!usable(configured, range, depId)) {
        throw new Error(`Selected host dependency "${depId}" version ${version} does not satisfy ${range}.`);
      }
      const { label, ...files } = configured;
      return { ...files, resolvedFrom: label };
    }
  }
  const workspace = await resolveFromWorkspace(root, depId);
  if (usable(workspace, range, depId)) return { ...workspace, resolvedFrom: 'workspace' };

  const configured = pinned ? null : await resolveFromConfiguredHost(root, depId, false, options);
  if (configured && usable(configured, range, depId)) {
    const { label, ...files } = configured;
    return { ...files, resolvedFrom: label };
  }

  const installed = resolveFromInstalledApp(depId, range);
  if (installed) {
    const { env, ...files } = installed;
    return { ...files, resolvedFrom: `installed app (${env})` };
  }
  return null;
}

async function resolveFromNetwork(root: string, depId: string, github: string | null, range: string, spec: string): Promise<(DepFiles & { resolvedFrom: string }) | null> {
  if (github) {
    const found = await resolveFromGitHub(root, depId, github, range, spec);
    return found && { ...found, resolvedFrom: `github:${github}@${found.snapshot.manifest.version}` };
  }
  const registrySource = await lookupRegistry(depId);
  if (registrySource) {
    const found = await resolveFromGitHub(root, depId, registrySource, range, spec);
    if (found) return { ...found, resolvedFrom: `registry → github:${registrySource}@${found.snapshot.manifest.version}` };
  }
  return null;
}

/**
 * A resolved dependency, with where it came from when that is known.
 *
 * The label is the one `apack pack fetch-deps` prints (`workspace`, `file:<path>`, `installed app (env)`,
 * `github:<owner>/<repo>@<version>`). It is per-resolution, not a property of the build — the same
 * bundle is a workspace sibling to its author and a GitHub release to everyone else — so it is not
 * recorded in the snapshot, which ships inside the pack.
 */
export type ResolvedDepFiles = DepFiles & { resolvedFrom?: string };

export interface DependencyResolutionOptions {
  /** Inspect existing local files only: never download or refresh caches. */
  readOnly?: boolean;
  /** Explicit fetching refreshes remote resolutions; ordinary builds may reuse the cache. */
  refresh?: boolean;
}

/**
 * Resolve a dependency's files (snapshot, plus build code and backend runtime when it ships them). Sources on this machine
 * win and refresh the .apack/deps cache; the cache only stands in for a network source, and
 * only while it satisfies the declared range. Malformed current-data declarations fail before caching. Recorded format stamps describe
 * executable compatibility; type imports are checked against the actual facade capabilities.
 */
export async function resolveDepFiles(root: string, depId: string, depValue: string, options: DependencyResolutionOptions = {}): Promise<ResolvedDepFiles | null> {
  const { github, filePath, range } = parsePackDependency(depValue);
  if (filePath) {
    const found = resolveFromFile(root, filePath);
    if (!usable(found, range, depId)) return null;
    const source: ResolvedDepFiles = { ...found, resolvedFrom: `file:${path.resolve(root, filePath)}`,
      origin: { kind: 'file', directory: path.resolve(root, filePath), selection: `file:${path.resolve(root, filePath)}` } };
    return options.readOnly ? source : cacheDep(root, depId, depValue, source);
  }

  const local = await resolveFromMachine(root, depId, range, options);
  if (local) {
    if (options.readOnly) return local;
    return cacheDep(root, depId, depValue, local);
  }

  const cached = resolveFromLocal(root, depId);
  if (!options.refresh && usable(cached, range, depId) && (!github || cached.origin?.kind === 'github' && cached.origin.repository === github)) return cached;

  if (options.readOnly) {
    return null;
  }

  return resolveFromNetwork(root, depId, github, range, depValue);
}

// ── Command ──

export async function fetchDeps(_args: string[]) {
  const root = findPackRoot(process.cwd());
  const manifest = readManifest(root);

  const deps = manifest.dependencies ?? {};
  const depIds = Object.keys(deps);

  if (depIds.length === 0) {
    console.log('No dependencies declared.');
    return;
  }

  console.log(`Fetching ${depIds.length} dependency snapshot(s)...`);

  let resolved = 0;
  const failed: string[] = [];

  for (const depId of depIds) {
    const depValue = deps[depId];
    const result = await resolveDepFiles(root, depId, depValue, { refresh: true });
    if (result) {
      const entityCount = Object.keys(result.snapshot.types.entities).length;
      const relCount = Object.keys(result.snapshot.types.relKinds).length;
      const roleCount = Object.keys(result.snapshot.types.roles).length;
      const facadeCount = Object.keys(result.snapshot.facades).length;
      console.log(`  ${depId}: ${entityCount} entities, ${relCount} relKinds, ${roleCount} roles, ${facadeCount} facade(s) (${result.resolvedFrom}; format ${result.snapshot.format ?? 'unstamped'}${result.snapshot.sdkVersion ? `, SDK ${result.snapshot.sdkVersion}` : ''})`);
      resolved++;
    } else {
      failed.push(depId);
    }
  }

  if (failed.length > 0) {
    console.warn(`\nFailed to resolve: ${failed.join(', ')}`);
    console.warn('Check the dependency value in apack.json (e.g. "github:owner/repo >=0.1.0").');
  }

  console.log(`\nResolved ${resolved}/${depIds.length} dependencies`);
}
