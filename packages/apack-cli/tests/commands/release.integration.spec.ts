import { _declarationRevision } from '@apackdev/sdk/build';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRunner, nextReleaseVersion, preflight, publishRelease, releaseStateReport, runRelease, type Runner } from '../../src/commands/release';
import { readPackIntegrity, sealPackBuild } from '@apackdev/host/packs';
import { runPackBuild } from '../../src/build/build-process.ts';
import { createPackCompilerInputView } from '@apackdev/host/build/compiler-inputs';
import { readPackageInputs } from '@apackdev/host/build/package-inputs';
import { writePackBuildInputs } from '@apackdev/host/build/pack-build-inputs';

/**
 * runRelease verifies with a release build; these tests use prebuilt packs, so the build is a stand-in.
 *
 * **It still has to leave what the steps after it read.** `writeVersion` rewrites `apack.json` immediately
 * before `verify`, and `apack pack archive` refuses a build of different sources — a build it cannot
 * see having happened is exactly the stale build that check exists for. A stand-in returning nothing claimed
 * the build had run and left a tree it had not touched, which is the fidelity gap rather than the check being
 * wrong: a real `apack pack build` writes `dist` here.
 */
const builtAt = vi.hoisted(() => ({ root: undefined as string | undefined }));
vi.mock('../../src/build/build-process.ts', () => ({
  runPackBuild: vi.fn(async () => {
    if (!builtAt.root) return;
    const [{ readFileSync, writeFileSync }, { join }] = await Promise.all([import('node:fs'), import('node:path')]);
    const manifest = JSON.parse(readFileSync(join(builtAt.root, 'apack.json'), 'utf8'));
    const snapshotFile = join(builtAt.root, 'dist/types/snapshot.json');
    const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
    snapshot.manifest = manifest;
    snapshot.declarationRevision = _declarationRevision(manifest);
    writeFileSync(snapshotFile, JSON.stringify(snapshot));
    sealBuild(builtAt.root);
  }),
}));
import { buildPackArchive } from '../../src/commands/archive';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { execFileWhileWorking } from '@apackdev/host/build/process-progress';

let tmp: string;

/** The synthetic build still records the inputs and output its archive consumer requires. */
function sealBuild(root: string): void {
  const view = createPackCompilerInputView(root);
  const observations = view.observations().entries;
  view.dispose();
  writePackBuildInputs(path.join(root, 'dist'), {
    compiler: 'a'.repeat(64), execution: 'b'.repeat(64), options: ['--release'], observations,
    packages: { hash: readPackageInputs([{ id: 'pack', directory: root }], { dependencyContents: 'resolution' }).hash,
      owners: [{ id: 'pack', directory: '' }], discovered: [] },
  });
  sealPackBuild(path.join(root, 'dist'), JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf8')));
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-spec-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function builtPack(version = '1.2.3'): string {
  const root = path.join(tmp, 'pack');
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('apack.json', JSON.stringify({ id: 'demo-pack', name: 'Demo Pack', version, hostVersion: '>=0.3.0' }));
  write('.gitignore', '.apack/\ndist/\n');
  write('package.json', JSON.stringify({ name: 'demo-pack', version }));
  write('package-lock.json', JSON.stringify({ name: 'demo-pack', version, lockfileVersion: 3, packages: { '': { name: 'demo-pack', version } } }));
  write('dist/runtime/index.cjs', 'module.exports = { registration: { id: "demo-pack" } };');
  write('dist/types/snapshot.json', JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  sealBuild(root);
  // Which pack the stand-in build above refreshes
  builtAt.root = root;
  return root;
}

/** Fake git: answers from a table, records every call, never touches a repo. */
function fakeGit(answers: Record<string, string | Error>): Runner & { calls: string[] } {
  const calls: string[] = [];
  const run: Runner = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return answer ?? '';
  };
  return Object.assign(run, { calls });
}

it('archives repeatedly outside the source inventory and refuses same-mtime input changes', async () => {
  const root = builtPack();
  const original = await buildPackArchive(root);
  expect(path.dirname(original.file)).toBe(path.join(root, '.apack/archives'));
  const source = path.join(root, 'apack.json');
  const bytes = fs.readFileSync(source);
  const stat = fs.statSync(source);
  fs.utimesSync(source, new Date(), new Date());
  expect((await buildPackArchive(root)).sha256).toBe(original.sha256);
  const manifest = JSON.parse(bytes.toString());
  manifest.name = 'Changed';
  fs.writeFileSync(source, JSON.stringify(manifest));
  fs.utimesSync(source, stat.atime, stat.mtime);
  await expect(buildPackArchive(root)).rejects.toThrow(/input changed/);
  expect(fs.readFileSync(original.checksumFile, 'utf8')).toContain(original.sha256);
  fs.writeFileSync(source, bytes);
  expect((await buildPackArchive(root)).sha256).toBe(original.sha256);
});

describe('nextReleaseVersion', () => {
  it.each([
    ['1.2.3', 'patch', false, '1.2.4'],
    ['1.2.3', 'minor', false, '1.3.0'],
    ['1.2.3', 'major', false, '2.0.0'],
    ['1.2.3', 'patch', true, '1.2.4-beta.0'],
    ['1.2.3', 'minor', true, '1.3.0-beta.0'],
    ['1.2.4-beta.0', 'patch', true, '1.2.4-beta.1'],
    ['1.2.4-beta.1', 'patch', false, '1.2.4'],
  ] as const)('%s + %s (beta=%s) → %s', (current, bump, beta, expected) => {
    expect(nextReleaseVersion(current, bump, beta)).toBe(expected);
  });

  it('rejects a non-semver current version', () => {
    expect(() => nextReleaseVersion('one', 'patch', false)).toThrow(/not valid semver/);
  });
});

describe('preflight', () => {
  const cleanRepo = {
    'git rev-parse --is-inside-work-tree': 'true',
    'git status --porcelain': '',
    'git rev-parse --abbrev-ref HEAD': 'main',
    'git symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main',
    'git remote get-url origin': 'git@github.com:acme/demo-pack.git',
  };

  const withWorkflow = (root: string) => {
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'release.yml'), '');
    return root;
  };

  it('passes a clean default-branch repo with a token for --local', async () => {
    const result = await preflight(builtPack(), { local: true, run: fakeGit(cleanRepo), env: { GITHUB_TOKEN: 't' } });
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('passes a clean default-branch repo whose release workflow publishes the tag', async () => {
    const result = await preflight(withWorkflow(builtPack()), { local: false, run: fakeGit(cleanRepo), env: {} });
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('refuses --local when the release workflow would publish the pushed tag too', async () => {
    const { errors } = await preflight(withWorkflow(builtPack()), { local: true, run: fakeGit(cleanRepo), env: { GITHUB_TOKEN: 't' } });
    expect(errors).toEqual([expect.stringMatching(/release\.yml also publishes when the tag is pushed/)]);
  });

  it('reports every problem at once', async () => {
    const root = builtPack();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8'));
    delete manifest.hostVersion;
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(manifest));

    const run = fakeGit({
      ...cleanRepo,
      'git status --porcelain': ' M src/index.ts',
      'git rev-parse --abbrev-ref HEAD': 'feature/x',
      'git remote get-url origin': new Error('no remote'),
    });
    const { errors, warnings } = await preflight(root, { local: true, run, env: {} });
    expect(errors).toEqual([
      'apack.json: hostVersion is required for releases (e.g. ">=0.3.0")',
      'working tree has uncommitted changes',
      'on branch "feature/x"; releases are cut from "main"',
      'no "origin" remote to push the release tag to',
      '--local publishing needs GITHUB_TOKEN or GH_TOKEN',
    ]);
    expect(warnings).toEqual([]);
  });

  it('refuses a release the push would reject: branch behind origin, or the tag already on origin', async () => {
    const run = fakeGit({
      ...cleanRepo,
      'git rev-list --count HEAD..@{upstream}': '2',
      'git ls-remote --tags origin refs/tags/v1.0.1': 'abc123\trefs/tags/v1.0.1',
    });
    const { errors } = await preflight(withWorkflow(builtPack()), { local: false, run, env: {}, version: '1.0.1' });
    expect(errors).toEqual([
      'branch is 2 commit(s) behind origin; pull first',
      'tag v1.0.1 already exists on origin',
    ]);
  });

  it('warns when publishing relies on a release workflow that does not exist', async () => {
    const { warnings } = await preflight(builtPack(), { local: false, run: fakeGit(cleanRepo), env: {} });
    expect(warnings).toEqual([expect.stringMatching(/no \.github\/workflows\/release\.yml/)]);
  });
});

describe('publishRelease', () => {
  function mockOctokit() {
    const createRelease = vi.fn(async () => ({ data: { id: 42 } }));
    const uploadReleaseAsset = vi.fn(async () => ({ data: {} }));
    return { octokit: { rest: { repos: { createRelease, uploadReleaseAsset } } } as any, createRelease, uploadReleaseAsset };
  }

  it('creates a prerelease for beta versions and uploads the archive and checksum', async () => {
    const root = builtPack('1.3.0-beta.2');
    const releaseDir = path.join(tmp, 'release');
    await buildPackArchive(root, releaseDir);
    const { octokit, createRelease, uploadReleaseAsset } = mockOctokit();

    const result = await publishRelease(root, releaseDir, { octokit, env: { GITHUB_REPOSITORY: 'acme/demo-pack' }, run: fakeGit({}) });

    expect(result).toEqual({ tag: 'v1.3.0-beta.2', prerelease: true });
    expect(createRelease).toHaveBeenCalledWith(expect.objectContaining({ owner: 'acme', repo: 'demo-pack', tag_name: 'v1.3.0-beta.2', prerelease: true }));
    expect(uploadReleaseAsset.mock.calls.map(([arg]: any[]) => arg.name)).toEqual(['demo-pack-1.3.0-beta.2.tgz', 'demo-pack-1.3.0-beta.2.tgz.sha256', 'demo-pack-1.3.0-beta.2.tgz.integrity.json']);
    // The update check reads hostVersion from this asset
    const info = JSON.parse(String((uploadReleaseAsset.mock.calls[2] as any[])[0].data));
    expect(info).toMatchObject({ id: 'demo-pack', version: '1.3.0-beta.2', hostVersion: expect.any(String) });
  });

  it('refuses to publish an archive that fails verification', async () => {
    const root = builtPack('1.0.0');
    const releaseDir = path.join(tmp, 'release');
    await buildPackArchive(root, releaseDir);
    fs.writeFileSync(path.join(releaseDir, 'demo-pack-1.0.0.tgz.sha256'), `${'0'.repeat(64)}  demo-pack-1.0.0.tgz\n`);
    const { octokit, createRelease } = mockOctokit();

    await expect(publishRelease(root, releaseDir, { octokit, env: { GITHUB_REPOSITORY: 'acme/demo-pack' }, run: fakeGit({}) })).rejects.toThrow(/Checksum mismatch/);
    expect(createRelease).not.toHaveBeenCalled();
  });

  it('dry-run resolves the repository from origin and publishes nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = builtPack('2.0.0');
    const releaseDir = path.join(tmp, 'release');
    await buildPackArchive(root, releaseDir);
    const { octokit, createRelease } = mockOctokit();

    const result = await publishRelease(root, releaseDir, {
      dryRun: true,
      octokit,
      env: {},
      run: fakeGit({ 'git remote get-url origin': 'https://github.com/acme/demo-pack.git' }),
    });
    expect(result).toEqual({ tag: 'v2.0.0', prerelease: false });
    expect(createRelease).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toMatch(/with demo-pack-2\.0\.0\.tgz, demo-pack-2\.0\.0\.tgz\.sha256 and demo-pack-2\.0\.0\.tgz\.integrity\.json/);
  });
});

const execFileAsync = execFileWhileWorking;
const git = async (cwd: string, ...args: string[]) =>
  (await execFileAsync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 })).stdout.trim();

/** A committed pack repo pushed to a local bare origin, and the runner runRelease drives it with. */
async function packRepo(): Promise<{ root: string; origin: string; run: Runner }> {
  const origin = path.join(tmp, 'origin.git');
  fs.mkdirSync(origin);
  await git(origin, 'init', '--quiet', '--bare', '-b', 'main');
  const root = builtPack();
  await git(root, 'init', '--quiet', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, '-c', 'user.name=author', '-c', 'user.email=author@example.com', 'commit', '--quiet', '-m', 'initial pack');
  await git(root, 'remote', 'add', 'origin', origin);
  await git(root, 'push', '--quiet', '-u', 'origin', 'main');
  await git(root, 'remote', 'set-head', 'origin', 'main');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Real git (commit, tag, push to the local origin); verification commands do nothing
  const run: Runner = (cmd, args, cwd) =>
    cmd === 'git' ? defaultRunner(cmd, ['-c', 'user.name=author', '-c', 'user.email=author@example.com', ...args], cwd) : '';
  return { root, origin, run };
}

const releaseOptions = { bump: 'patch', beta: false, dryRun: false, local: false, skipTests: true, skipE2e: true } as const;

describe('defaultRunner', () => {
  // A release stops on the first failing check; without this its message was "Command failed" and the
  // author had to rerun tsc or the tests by hand to see what was wrong
  it("puts a failing command's own output in the error", () => {
    const script = 'console.log("a type error"); console.error("a failing test"); process.exit(1);';
    expect(() => defaultRunner(process.execPath, ['-e', script], tmp))
      .toThrow(/failed:[\s\S]*a type error[\s\S]*a failing test/);
  });

  // The release reruns and resumes on top of these, and a caller telling a failed check from a killed one
  // needs what execFileSync attached; only the message was ever missing
  it('rethrows the error the command failed with, status and all', () => {
    // With output, since that is the path that used to replace the error wholesale
    const script = 'console.log("a type error"); process.exit(3)';
    let thrown: unknown;
    try {
      defaultRunner(process.execPath, ['-e', script], tmp);
    } catch (err) {
      thrown = err;
    }

    expect((thrown as { status?: number }).status).toBe(3);
  });

  it('returns trimmed stdout when the command succeeds', () => {
    expect(defaultRunner(process.execPath, ['-e', 'console.log(" ok ")'], tmp)).toBe('ok');
  });
});

describe('releaseStateReport', () => {
  it('tells a part-way release to rerun, and a pushed one to publish', () => {
    expect(releaseStateReport('1.2.4', { committed: true, tagged: true, pushed: false }))
      .toMatch(/resumes this version/);
    // Past the push the release exists for everyone: a rerun cuts the next version, so say the other thing
    expect(releaseStateReport('1.2.4', { committed: true, tagged: true, pushed: true }))
      .toMatch(/apack pack release publish/);
  });
});

describe('runRelease', () => {
  it('releases build signal ownership before running synchronous verification checks', async () => {
    const root = builtPack();
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    const interrupt = process.listeners('SIGINT'), terminate = process.listeners('SIGTERM');
    const gitRun = fakeGit({ 'git rev-parse --abbrev-ref HEAD': 'main' });
    let checked = false;
    const run: Runner = (command, args, cwd) => {
      if (command !== 'npx') return gitRun(command, args, cwd);
      checked = true;
      expect(process.listeners('SIGINT')).toEqual(interrupt);
      expect(process.listeners('SIGTERM')).toEqual(terminate);
      return '';
    };
    await runRelease(root, { ...releaseOptions, dryRun: true, run, env: {} });
    expect(checked).toBe(true);
  });

  it.each([false, true])('reports aborted verification before signal exit and stops the release (resuming: %s)', async resuming => {
    const root = builtPack();
    const run = fakeGit({
      'git log -1 --format=%s': resuming ? 'release: v1.2.3' : '',
      'git rev-parse --abbrev-ref HEAD': 'main',
    });
    const errors: string[] = [];
    let reportedBeforeExit = '';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(message => { errors.push(String(message)); });
    let terminate!: () => void;
    const originalOn = process.on.bind(process);
    const on = vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'SIGTERM') { terminate = listener; return process; }
      if (event === 'SIGINT') return process;
      return originalOn(event, listener);
    });
    const signalExit = new Error('Simulated signal exit');
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      expect(pid).toBe(process.pid);
      expect(signal).toBe('SIGTERM');
      reportedBeforeExit = errors.join('\n');
      throw signalExit;
    });
    vi.mocked(runPackBuild).mockImplementationOnce(async (_root, options) => {
      if (!options?.signal) throw new Error('Build lifetime missing');
      terminate();
      options.signal.throwIfAborted();
    });
    try {
      await expect(runRelease(root, { ...releaseOptions, run, env: {} })).rejects.toBe(signalExit);
      expect(reportedBeforeExit).toContain(resuming ? 'Release v1.2.3 stopped part-way' : 'version files were bumped to 1.2.4');
      expect(JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf8')).version).toBe(resuming ? '1.2.3' : '1.2.4');
      expect(fs.existsSync(path.join(root, '.apack/release'))).toBe(false);
      expect(run.calls.filter(call => /^git (?:add |commit |tag -a|push(?: |$))/.test(call))).toEqual([]);
    } finally {
      on.mockRestore();
      kill.mockRestore();
      errorLog.mockRestore();
    }
  });

  it('packs after the version commit, so integrity.json records the tagged commit', async () => {
    const { root, origin, run } = await packRepo();
    const { version } = await runRelease(root, { ...releaseOptions, run, env: {} });

    expect(runPackBuild).toHaveBeenLastCalledWith(root, { args: ['--release'], signal: expect.any(AbortSignal) });
    expect(version).toBe('1.2.4');
    const tagged = await git(root, 'rev-parse', 'v1.2.4^{commit}');
    expect(await git(root, 'log', '-1', '--format=%s', tagged)).toBe('release: v1.2.4');
    expect(readPackIntegrity(path.join(root, '.apack', 'staged', 'demo-pack')).provenance?.commit).toBe(tagged);
    expect(await git(origin, 'rev-parse', 'v1.2.4^{commit}')).toBe(tagged);
  });

  // The dry run writes no version files, so a --version override on the staged pack would make its
  // apack.json disagree with the snapshot built beside it
  it('packs the version on disk on a dry run, not the one a real release would cut', async () => {
    const { root, run } = await packRepo();

    const { version, archive } = await runRelease(root, { ...releaseOptions, dryRun: true, run, env: {} });

    expect(version).toBe('1.2.4');
    expect(path.basename(archive)).toBe('demo-pack-1.2.3.tgz');
    expect(readPackIntegrity(path.join(root, '.apack', 'staged', 'demo-pack')).version).toBe('1.2.3');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8')).version).toBe('1.2.3');
    expect(await git(root, 'log', '-1', '--format=%s')).toBe('initial pack');
  });

  // A release that moved only the two manifests tagged a commit whose lockfile disagreed with it, and
  // the author's next `npm install` rewrote the lockfile and dirtied the tree
  it('bumps every version file, the lockfile included, and commits them together', async () => {
    const { root, run } = await packRepo();

    await runRelease(root, { ...releaseOptions, run, env: {} });

    const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf-8'));
    expect(read('apack.json').version).toBe('1.2.4');
    expect(read('package.json').version).toBe('1.2.4');
    expect(read('package-lock.json')).toMatchObject({ version: '1.2.4', packages: { '': { version: '1.2.4' } } });
    expect((await git(root, 'show', '--name-only', '--format=', 'HEAD')).split('\n').sort())
      .toEqual(['apack.json', 'package-lock.json', 'package.json']);
    // No tracked file left modified; .apack/ and dist/ build output are ignored in generated packs.
    expect(await git(root, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });

  // A finished release sits at HEAD with its own commit subject. Reading that as one to resume would
  // re-run it and never cut the next version — the beta cycle (-beta.0 → -beta.1) is exactly this shape.
  it('cuts the next version after a release that finished, with no commits in between', async () => {
    const { root, run } = await packRepo();

    expect((await runRelease(root, { ...releaseOptions, run, env: {} })).version).toBe('1.2.4');
    expect((await runRelease(root, { ...releaseOptions, run, env: {} })).version).toBe('1.2.5');
    expect((await git(root, 'tag', '--list')).split('\n').sort()).toEqual(['v1.2.4', 'v1.2.5']);
  });

  it('resumes the committed version instead of bumping past it', async () => {
    const { root, origin, run } = await packRepo();
    // The state a failed pack, tag or push leaves: the version is committed, nothing else happened
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8')), version: '1.2.4' }, null, 2) + '\n');
    await git(root, 'add', 'apack.json');
    await git(root, '-c', 'user.name=author', '-c', 'user.email=author@example.com', 'commit', '--quiet', '-m', 'release: v1.2.4');

    const { version } = await runRelease(root, { ...releaseOptions, run, env: {} });

    expect(version).toBe('1.2.4');
    expect(await git(root, 'rev-list', '--count', 'HEAD')).toBe('2');
    expect(await git(origin, 'rev-parse', 'v1.2.4^{commit}')).toBe(await git(root, 'rev-parse', 'HEAD'));
    expect(await git(root, 'tag', '--list')).toBe('v1.2.4');
  });

  it('reports what the release left behind when a step after the commit fails', async () => {
    const { root, run } = await packRepo();
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(msg => void errors.push(String(msg)));
    // No origin: preflight passes on the first pass through, the push at the end does not
    const failing: Runner = (cmd, args, cwd) => (cmd === 'git' && args[0] === 'push' ? (() => { throw new Error('push rejected'); })() : run(cmd, args, cwd));

    await expect(runRelease(root, { ...releaseOptions, run: failing, env: {} })).rejects.toThrow('push rejected');

    expect(errors.join('\n')).toMatch(/Release v1\.2\.4 stopped part-way[\s\S]*✓ version commit[\s\S]*✓ local tag v1\.2\.4[\s\S]*· tag v1\.2\.4 on origin[\s\S]*resumes this version/);
  });
});

