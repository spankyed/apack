import { writeManifest } from '../manifest-writer.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as semver from 'semver';
import { Octokit } from '@octokit/rest';
import { findPackRoot, readManifest } from '../utils';
import { parseManifest } from '@apackdev/sdk/build';
import { resolveDeps } from './generate';
import { runPackBuild } from '../build/build-process.ts';
import { withBuildSignals } from '../build/build-signals.ts';
import { buildPackArchive } from './archive';
import { packArchiveName, readPackIntegrity, verifyPack, extractPackArchive } from '@apackdev/host/packs';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const HELP = `
Usage:
  apack pack release [patch|minor|major] [--beta] [--dry-run] [--local] [--skip-tests] [--skip-e2e]
  apack pack release publish [--dir <dir>] [--dry-run]

release   Preflight, bump the version (beta cycle: 1.2.3 → 1.2.4-beta.0 → -beta.1 → 1.2.4),
          build --release, typecheck, unit tests, E2E, pack, then commit, tag v<version>
          and push. The pack's .github/workflows/release.yml publishes the GitHub release
          from the tag. With --local, publishes from this machine instead.
          --dry-run changes nothing: no file edits, git operations or publishing; it
          builds, packs and verifies the pack under .apack/release/, at the version
          on disk, since nothing was bumped.

publish   Upload <id>-<version>.tgz, .sha256 and .integrity.json from <dir> (default .apack/release)
          to a draft. Publish after verification. Rerun with the same files to resume an upload.
          Needs GITHUB_TOKEN (or GH_TOKEN) and GITHUB_REPOSITORY or an origin remote.
`.trim();

export type BumpType = 'patch' | 'minor' | 'major';

/** Same version cycle as the apack app release (build/release/release.sh). */
export function nextReleaseVersion(current: string, bump: BumpType, beta: boolean): string {
  const valid = semver.valid(current);
  if (!valid) throw new Error(`Current version "${current}" is not valid semver`);
  const isPrerelease = semver.prerelease(valid) !== null;
  const next = beta
    ? (isPrerelease ? semver.inc(valid, 'prerelease', 'beta') : semver.inc(valid, `pre${bump}`, 'beta'))
    : semver.inc(valid, bump);
  if (!next) throw new Error(`Could not bump ${current}`);
  return next;
}

export type Runner = (cmd: string, args: string[], cwd: string) => string;

/** How far a previous run got with this pack's current version. */
export function releaseInProgress(root: string, version: string, run: Runner): ReleaseState {
  const quiet = (...args: string[]) => { try { return run('git', args, root); } catch { return ''; } };
  return {
    committed: quiet('log', '-1', '--format=%s') === `release: v${version}`,
    tagged: quiet('tag', '--list', `v${version}`) !== '',
    pushed: quiet('ls-remote', '--tags', 'origin', `refs/tags/v${version}`) !== '',
  };
}

export interface ReleaseState {
  committed: boolean;
  tagged: boolean;
  pushed: boolean;
}

/** Nothing of a version exists yet: the state a release being cut fresh starts from. */
const NOTHING_RELEASED: ReleaseState = { committed: false, tagged: false, pushed: false };

/**
 * Whether a run should continue `state`'s release rather than cut the next version.
 *
 * Pack, tag, push and publish all follow the version commit, and any of them can fail. Without this a
 * rerun reads the bumped version as the current one and bumps again, so a failed 1.2.4 becomes 1.2.5
 * with 1.2.4 committed behind it. A release is resumed, not restarted: `git reset --hard` on a commit
 * that may not be the only thing in the tree is not a recovery.
 *
 * The tag reaching origin ends it. Past that the release exists for everyone and a rerun is asking for
 * the next version — the beta cycle is two releases in a row with nothing committed between them, and
 * reading the finished one as resumable would mean -beta.1 could never be cut. A `--local` publish
 * that failed after the push is `apack pack release publish`, which exists for exactly that.
 */
export function isResumable(state: ReleaseState): boolean {
  return state.committed && !(state.tagged && state.pushed);
}

/**
 * What a release left behind when a step after the version commit failed, and how to continue.
 *
 * Printed where the failure is, because the instinct at that point is `git reset --hard`, which takes
 * whatever else is in the tree with it and loses a commit the rerun is going to look for.
 */
export function releaseStateReport(version: string, state: ReleaseState): string {
  const mark = (done: boolean) => (done ? '✓' : '·');
  const next = isResumable(state)
    ? ['Rerun the same `apack pack release` command to continue: it resumes this version instead of bumping again.',
       'Nothing needs reverting first.']
    : ['The tag is on origin, so the release itself is done and a rerun would cut the next version.',
       'To finish publishing it, run `apack pack release publish`.'];
  return [
    `Release v${version} stopped part-way. What exists now:`,
    `  ${mark(state.committed)} version commit "release: v${version}"`,
    `  ${mark(state.tagged)} local tag v${version}`,
    `  ${mark(state.pushed)} tag v${version} on origin`,
    '',
    ...next,
  ].join('\n');
}

/**
 * Runs a command, capturing its output — git's, which callers read, and the checks' in `verify`.
 *
 * A failure is rethrown with that output in its message. execFileSync's own message is
 * `Command failed: …` and nothing else, so a release that stopped on a type error or a failing test said
 * only that a command had failed, and the author had to rerun the check by hand to find out which.
 *
 * The error itself is the one execFileSync threw, with its message rewritten: it carries the exit status,
 * the signal and the captured streams, and a caller that wants to tell a failed command from a killed one
 * still can.
 */
export const defaultRunner: Runner = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (err) {
    const { stdout, stderr } = err as { stdout?: Buffer; stderr?: Buffer };
    const output = [stdout?.toString(), stderr?.toString()].filter(Boolean).join('\n').trim();
    if (output && err instanceof Error) err.message = `${[cmd, ...args].join(' ')} failed:\n${output}`;
    throw err;
  }
};

export interface PreflightResult {
  errors: string[];
  warnings: string[];
}

export async function preflight(root: string, options: { local: boolean; run: Runner; env?: NodeJS.ProcessEnv; version?: string }): Promise<PreflightResult> {
  const env = options.env ?? process.env;
  const errors: string[] = [];
  const warnings: string[] = [];
  const git = (...args: string[]) => options.run('git', args, root);

  const raw = readManifest(root);
  const { diagnostics: manifestErrors } = parseManifest(raw);
  errors.push(...manifestErrors.map(({ message }) => `apack.json: ${message}`));
  if (!raw.hostVersion) errors.push('apack.json: hostVersion is required for releases (e.g. ">=0.3.0")');

  try {
    await resolveDeps(root, raw.dependencies);
  } catch (err) {
    errors.push(`dependencies: ${errorMessage(err)}`);
  }

  let inRepo = true;
  try { git('rev-parse', '--is-inside-work-tree'); } catch { inRepo = false; }
  if (!inRepo) {
    errors.push('not a git repository');
  } else {
    if (git('status', '--porcelain')) errors.push('working tree has uncommitted changes');
    let branch = '';
    try { branch = git('rev-parse', '--abbrev-ref', 'HEAD'); } catch {}
    let defaultBranch = '';
    try { defaultBranch = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, ''); } catch {}
    if (defaultBranch && branch !== defaultBranch) {
      errors.push(`on branch "${branch}"; releases are cut from "${defaultBranch}"`);
    } else if (!defaultBranch && !['main', 'master'].includes(branch)) {
      errors.push(`on branch "${branch}"; releases are cut from the default branch`);
    }
    let hasOrigin = true;
    try { git('remote', 'get-url', 'origin'); } catch { hasOrigin = false; errors.push('no "origin" remote to push the release tag to'); }
    if (hasOrigin) {
      // A rejected push would leave a local version commit and tag behind
      try {
        git('fetch', '--quiet', 'origin');
        const behind = Number(git('rev-list', '--count', 'HEAD..@{upstream}') || '0');
        if (behind > 0) errors.push(`branch is ${behind} commit(s) behind origin; pull first`);
      } catch {}
      if (options.version) {
        let remoteTag = '';
        try { remoteTag = git('ls-remote', '--tags', 'origin', `refs/tags/v${options.version}`); } catch {}
        if (remoteTag) errors.push(`tag v${options.version} already exists on origin`);
      }
    }
  }

  const hasWorkflow = fs.existsSync(path.join(root, '.github', 'workflows', 'release.yml'));
  if (options.local && !(env.GITHUB_TOKEN || env.GH_TOKEN)) {
    errors.push('--local publishing needs GITHUB_TOKEN or GH_TOKEN');
  }
  if (options.local && hasWorkflow) {
    // The pushed tag triggers the workflow, so publishing locally too would create the release twice
    errors.push('--local publishes from this machine, but .github/workflows/release.yml also publishes when the tag is pushed; release without --local, or remove the workflow');
  }
  if (!options.local && !hasWorkflow) {
    warnings.push('no .github/workflows/release.yml — pushing the tag will not publish anything (use --local, or run "apack pack init" to scaffold the workflow)');
  }
  return { errors, warnings };
}

/** The version files this pack has, written to `version`. Returns them for the release commit. */
function writeVersion(root: string, version: string): string[] {
  const changed: string[] = [];
  for (const file of ['apack.json', 'package.json']) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
    json.version = version;
    if (file === 'apack.json') writeManifest(root, json);
    else fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
    changed.push(file);
  }
  // The lockfile records the root package's version twice, so leaving it behind tags a commit that
  // disagrees with itself — and the next `npm install` rewrites it, which dirties the author's tree
  // straight after a release and then fails the next release's preflight as uncommitted changes.
  // `npm ci` is not the reason: it validates dependencies and passes a root version mismatch (npm 10).
  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    changed.push('package-lock.json');
  }
  return changed;
}

function hasScript(root: string, name: string): boolean {
  try {
    return Boolean(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).scripts?.[name]);
  } catch {
    return false;
  }
}

async function verify(root: string, options: { skipTests: boolean; skipE2e: boolean; run: Runner; onInterrupted: () => void }): Promise<void> {
  console.log('\nBuilding (release)...');
  await withBuildSignals(signal => runPackBuild(root, { args: ['--release'], signal }), options.onInterrupted);

  if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
    console.log('Typechecking...');
    options.run('npx', ['--no-install', 'tsc', '--noEmit'], root);
  }
  if (!options.skipTests && hasScript(root, 'test')) {
    console.log('Running unit tests...');
    options.run('npm', ['test', '--silent'], root);
  }
  if (!options.skipE2e && fs.existsSync(path.join(root, 'playwright.config.ts'))) {
    console.log('Running E2E tests...');
    const { test } = await import('./test');
    await test(['--release']);
  }
}

export function resolveRepository(root: string, env: NodeJS.ProcessEnv, run: Runner): { owner: string; repo: string } {
  const slug = env.GITHUB_REPOSITORY ?? (() => {
    const url = run('git', ['remote', 'get-url', 'origin'], root);
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
    if (!m) throw new Error(`origin remote is not a GitHub repository: ${url}`);
    return `${m[1]}/${m[2]}`;
  })();
  const [owner, repo] = slug.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository "${slug}"`);
  return { owner, repo };
}

export interface PublishOptions {
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  run?: Runner;
  /** Injected for tests; defaults to an authenticated Octokit. */
  octokit?: Pick<Octokit, 'rest' | 'paginate'>;
}

/** Resolve an existing release tag to its commit, including annotated tags. */
async function verifyReleaseTag(octokit: Pick<Octokit, 'rest'>, repository: { owner: string; repo: string },
  tag: string, commit: string,
): Promise<void> {
  const { data } = await octokit.rest.git.getRef({ ...repository, ref: `tags/${tag}` });
  let object = data.object;
  const seen = new Set<string>();
  while (object.type === 'tag') {
    if (seen.has(object.sha)) throw new Error(`Release tag ${tag} has a circular tag reference`);
    seen.add(object.sha);
    const { data: annotated } = await octokit.rest.git.getTag({ ...repository, tag_sha: object.sha });
    object = annotated.object;
  }
  if (object.type !== 'commit' || object.sha !== commit) {
    throw new Error(`Release tag ${tag} points to ${object.sha}; the archive records ${commit}`);
  }
}

/** Upload the verified pack to a draft before exposing it to consumers. */
export async function publishRelease(root: string, releaseDir: string, options: PublishOptions = {}): Promise<{ tag: string; prerelease: boolean }> {
  const env = options.env ?? process.env;
  const run = options.run ?? defaultRunner;
  const manifest = readManifest(root);
  const version = manifest.version;
  const archive = path.join(releaseDir, packArchiveName(manifest.id, version));
  const checksumFile = `${archive}.sha256`;
  if (!fs.existsSync(archive) || !fs.existsSync(checksumFile)) {
    throw new Error(`No ${path.basename(archive)} (+ .sha256) in ${releaseDir}. Run "apack pack archive --out ${releaseDir}" first.`);
  }

  // Refuse to publish anything that doesn't verify
  const checksum = fs.readFileSync(checksumFile);
  const sha256 = checksum.toString('utf-8').trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error(`Invalid SHA-256 in ${checksumFile}`);
  const archiveBytes = fs.readFileSync(archive);
  const scratch = fs.mkdtempSync(path.join(releaseDir, '.verify-'));
  // The pack's integrity.json (id, version, hostVersion) as its own asset: the app's update check
  // reads a release's hostVersion from it without downloading the archive
  const infoFile = `${archive}.integrity.json`;
  let infoBytes: Buffer;
  let sourceCommit: string | undefined;
  try {
    const verifiedArchive = path.join(scratch, path.basename(archive));
    fs.writeFileSync(verifiedArchive, archiveBytes);
    const extracted = await extractPackArchive(verifiedArchive, path.join(scratch, 'extracted'), sha256);
    const info = verifyPack(extracted);
    if (info.version !== version) throw new Error(`Pack version ${info.version} does not match apack.json ${version}`);
    if (info.id !== manifest.id) throw new Error(`Pack ID ${info.id} does not match apack.json ${manifest.id}`);
    sourceCommit = info.provenance?.commit;
    infoBytes = Buffer.from(JSON.stringify(info, null, 2) + '\n');
    fs.writeFileSync(infoFile, infoBytes);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }

  const tag = `v${version}`;
  const prerelease = semver.prerelease(version) !== null;
  const { owner, repo } = resolveRepository(root, env, run);

  if (options.dryRun) {
    console.log(`[dry-run] Would create GitHub release ${owner}/${repo}@${tag}${prerelease ? ' (prerelease)' : ''} with ${path.basename(archive)}, ${path.basename(checksumFile)} and ${path.basename(infoFile)}`);
    return { tag, prerelease };
  }

  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (!token && !options.octokit) throw new Error('GITHUB_TOKEN (or GH_TOKEN) is required to publish');
  const octokit = options.octokit ?? new Octokit({ auth: token, userAgent: 'apack-cli' });

  const repos = octokit.rest.repos;
  const repository = { owner, repo };
  if (!sourceCommit) throw new Error('A published pack archive must record its source commit');
  await verifyReleaseTag(octokit, repository, tag, sourceCommit);
  // The authenticated list includes drafts. Match an exact tag, including any older interrupted draft.
  const matches = (await octokit.paginate(repos.listReleases, { ...repository, per_page: 100 }))
    .filter(release => release.tag_name === tag);
  if (matches.length > 1) throw new Error(`Multiple releases for ${owner}/${repo}@${tag}`);
  const release = matches[0] ?? (await repos.createRelease({
    ...repository,
    tag_name: tag,
    name: `${manifest.name} ${tag}`,
    draft: true,
    prerelease,
    generate_release_notes: true,
  })).data;
  if (release.prerelease !== prerelease) throw new Error(`Existing release ${tag} has a different prerelease setting`);

  const releaseRef = { ...repository, release_id: release.id };
  const assets = await octokit.paginate(repos.listReleaseAssets, { ...releaseRef, per_page: 100 });
  const digest = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const files = [
    { name: path.basename(archive), bytes: archiveBytes, contentType: 'application/gzip' },
    { name: path.basename(checksumFile), bytes: checksum, contentType: 'text/plain' },
    { name: path.basename(infoFile), bytes: infoBytes, contentType: 'application/json' },
  ].map(file => ({ ...file, digest: digest(file.bytes) }));
  const verified = async (asset: { id: number; name: string; state: string; size: number; digest?: unknown },
    file: (typeof files)[number]): Promise<boolean> => {
    if (asset.name !== file.name || asset.state !== 'uploaded' || asset.size !== file.bytes.length) return false;
    if (typeof asset.digest === 'string') return asset.digest === file.digest;
    // GitHub can omit the digest. Fetch the raw bytes so even JSON and text are hashed as uploaded.
    const { data } = await repos.getReleaseAsset({
      ...repository,
      asset_id: asset.id,
      headers: { accept: 'application/octet-stream' },
      request: { parseSuccessResponseBody: false },
    });
    return digest(Buffer.from(await new Response(data as unknown as ReadableStream).arrayBuffer())) === file.digest;
  };
  const pending = [];
  for (const file of files) {
    const asset = assets.find(entry => entry.name === file.name);
    if (asset && await verified(asset, file)) continue;
    // Older Octokit types omit 'starter', which GitHub uses for incomplete uploads.
    const state: string | undefined = asset?.state;
    if (!release.draft || (asset && (state !== 'starter' || asset.size !== 0))) {
      throw new Error(`Release ${tag}: cannot verify asset ${file.name} against the local file`);
    }
    pending.push({ file, placeholder: asset });
  }
  if (!release.draft) {
    console.log(`Already published ${owner}/${repo}@${tag}`);
    return { tag, prerelease };
  }

  for (const { file, placeholder } of pending) {
    // A failed GitHub upload can leave an empty starter entry. Only that entry may be removed.
    if (placeholder) await repos.deleteReleaseAsset({ ...repository, asset_id: placeholder.id });
    const { data: uploaded } = await repos.uploadReleaseAsset({
      ...releaseRef,
      name: file.name,
      data: file.bytes as unknown as string,
      headers: { 'content-type': file.contentType },
    });
    if (!await verified(uploaded, file)) throw new Error(`Release ${tag}: GitHub did not verify the upload of ${file.name}`);
  }
  await verifyReleaseTag(octokit, repository, tag, sourceCommit);
  await repos.updateRelease({ ...releaseRef, draft: false });
  console.log(`Published ${owner}/${repo}@${tag}${prerelease ? ' (prerelease)' : ''}`);
  return { tag, prerelease };
}

export interface ReleaseOptions {
  bump: BumpType;
  beta: boolean;
  dryRun: boolean;
  local: boolean;
  skipTests: boolean;
  skipE2e: boolean;
  run?: Runner;
  env?: NodeJS.ProcessEnv;
}

export async function runRelease(root: string, options: ReleaseOptions): Promise<{ version: string; archive: string }> {
  const run = options.run ?? defaultRunner;
  const env = options.env ?? process.env;
  const manifest = readManifest(root);
  const prior = options.dryRun ? NOTHING_RELEASED : releaseInProgress(root, manifest.version, run);
  const resuming = isResumable(prior);
  const version = resuming ? manifest.version : nextReleaseVersion(manifest.version, options.bump, options.beta);
  // What exists for the version this run is releasing. `prior` is about the version on disk, which is a
  // different version unless this is a resume — so a fresh release starts from nothing, whatever tags
  // the last one left behind.
  const existing = resuming ? prior : NOTHING_RELEASED;
  if (resuming) {
    console.log(`Resuming the release of ${manifest.id} v${version}: it is already committed${existing.tagged ? ' and tagged' : ''}.`);
  } else {
    console.log(`Releasing ${manifest.id}: ${manifest.version} → ${version}${options.dryRun ? ' (dry run)' : ''}`);
  }

  const { errors, warnings } = await preflight(root, { local: options.local, run, env, version });
  for (const w of warnings) console.warn(`  ! ${w}`);
  if (errors.length > 0) {
    const report = errors.map(e => `  - ${e}`).join('\n');
    if (!options.dryRun) throw new Error(`Release preflight failed:\n${report}`);
    console.warn(`Preflight problems (a real release would stop here):\n${report}`);
  }

  const versionFiles = !options.dryRun && !existing.committed ? writeVersion(root, version) : [];
  const reportVerificationFailure = () => {
    if (options.dryRun) return;
    if (existing.committed) console.error(releaseStateReport(version, existing));
    else console.error(`Verification failed; version files were bumped to ${version} — revert them before retrying.`);
  };
  try {
    await verify(root, { skipTests: options.skipTests, skipE2e: options.skipE2e, run, onInterrupted: reportVerificationFailure });
  } catch (err) {
    reportVerificationFailure();
    throw err;
  }

  const releaseDir = path.join(root, '.apack', 'release');
  const packRelease = async () => {
    fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 5 });
    const packed = await buildPackArchive(root, releaseDir);
    console.log(`\nPack: ${packed.file}\n  sha256: ${packed.sha256}\n  files: ${Object.keys(readPackIntegrity(path.join(root, '.apack', 'staged', manifest.id)).files).length}`);
    return packed;
  };

  if (options.dryRun) {
    // A dry run writes no version files, so this packs the version on disk. What it checks is that the
    // pack builds, stages and verifies.
    const packed = await packRelease();
    console.log(`\n[dry-run] Packed v${manifest.version}, the version on disk; a real release bumps to ${version} first.`);
    console.log(`[dry-run] Would commit version files, tag v${version} and push${options.local ? ', then publish the GitHub release locally' : ' (the release workflow publishes from the tag)'}.`);
    return { version, archive: packed.file };
  }

  const git = (...args: string[]) => run('git', args, root);
  if (!existing.committed) {
    git('add', ...versionFiles);
    git('commit', '-m', `release: v${version}`);
  }
  try {
    // After the commit, so integrity.json's provenance.commit is the tagged commit. Which is also why the
    // commit can't be moved later to close the window this resume path exists for.
    const packed = await packRelease();
    if (!existing.tagged) git('tag', '-a', `v${version}`, '-m', `v${version}`);
    git('push', '--follow-tags', 'origin', 'HEAD');

    if (options.local) {
      await publishRelease(root, releaseDir, { env, run });
    } else {
      console.log(`\nPushed v${version}. The release workflow will build and publish it.`);
    }
    return { version, archive: packed.file };
  } catch (err) {
    console.error(`\n${releaseStateReport(version, releaseInProgress(root, version, run))}`);
    throw err;
  }
}

export async function release(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  const root = findPackRoot(process.cwd());

  if (args[0] === 'publish') {
    const dirIdx = args.indexOf('--dir');
    const dir = dirIdx >= 0 && args[dirIdx + 1] ? path.resolve(args[dirIdx + 1]) : path.join(root, '.apack', 'release');
    await publishRelease(root, dir, { dryRun: args.includes('--dry-run') });
    return;
  }

  const bump = (['patch', 'minor', 'major'] as const).find(b => args.includes(b)) ?? 'patch';
  await runRelease(root, {
    bump,
    beta: args.includes('--beta'),
    dryRun: args.includes('--dry-run'),
    local: args.includes('--local'),
    skipTests: args.includes('--skip-tests'),
    skipE2e: args.includes('--skip-e2e'),
  });
}
