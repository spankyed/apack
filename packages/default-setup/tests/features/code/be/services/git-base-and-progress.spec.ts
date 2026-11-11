// Three things the git layer says of what it runs: which branch a branch was made from, how far along a push or
// a pull is, and, when asked to, each command with how long it took. Every case runs a real git.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { onLog, setDebugEnabled } from '@apackdev/sdk/logger';
import { GIT_COMMAND_LOG, GitRepository } from '../../../../../src/features/code/be/services/git.ts';
import { progressReader, withoutProgress } from '../../../../../src/features/code/be/services/git-progress.ts';

const directories: string[] = [];
afterEach(() => {
  setDebugEnabled(GIT_COMMAND_LOG, false);
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-C', cwd, '-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args])).stdout.trim();
function scratch(prefix: string): string {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  directories.push(directory);
  return directory;
}
const commit = async (root: string, file: string, message: string) => {
  fs.writeFileSync(path.join(root, file), `${message}\n`);
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', message);
};

/** A repository with `main`, and `develop` one commit ahead of it and checked out */
async function repositoryOnDevelop() {
  const root = scratch('apack-base-');
  await git(root, 'init', '--quiet', '--initial-branch=main');
  await commit(root, 'a.txt', 'first');
  await git(root, 'checkout', '--quiet', '-b', 'develop');
  await commit(root, 'b.txt', 'on develop');
  return root;
}

// The commits alone cannot tell these apart: a branch made from `develop` and one made from `main` and merged up
// to `develop` hold the same history
it('knows the branch a branch was made from when it made the branch itself', async () => {
  const root = await repositoryOnDevelop();
  const repo = new GitRepository(root);

  await repo.checkoutBranch('topic');

  expect((await repo.readSnapshot()).branch).toBe('topic');
  expect(await repo.getPRBaseBranch()).toBe('develop');
});

it('knows it from git\'s own record when the branch was made in a terminal with a name to start from', async () => {
  const root = await repositoryOnDevelop();
  await git(root, 'checkout', '--quiet', '-b', 'topic', 'main');
  await commit(root, 'c.txt', 'on topic');

  expect(await new GitRepository(root).getPRBaseBranch()).toBe('main');
});

it('knows it from what VS Code wrote down when it made the branch', async () => {
  const root = await repositoryOnDevelop();
  await git(root, 'checkout', '--quiet', '-b', 'topic');
  await git(root, 'config', 'branch.topic.vscode-merge-base', 'origin/main');

  expect(await new GitRepository(root).getPRBaseBranch()).toBe('main');
});

it('goes by the commits when the branch that was written down is gone', async () => {
  const root = await repositoryOnDevelop();
  await git(root, 'checkout', '--quiet', '-b', 'topic');
  await git(root, 'config', 'branch.topic.apack-base', 'deleted-since');
  await commit(root, 'c.txt', 'on topic');

  expect(await new GitRepository(root).getPRBaseBranch()).toBe('develop');
});

/** A repository with one commit and a bare remote it has not pushed to */
async function repositoryWithRemote() {
  const root = scratch('apack-progress-');
  await git(root, 'init', '--quiet', '--initial-branch=main');
  await commit(root, 'a.txt', 'first');
  const remote = scratch('apack-progress-remote-');
  await git(remote, 'init', '--quiet', '--bare', '--initial-branch=main');
  await git(root, 'remote', 'add', 'origin', remote);
  return { root, remote };
}

it('says how far along a push is, stage by stage, up to all of it', async () => {
  const { root } = await repositoryWithRemote();
  const said: { stage: string; percent: number }[] = [];

  await new GitRepository(root).pushBranch(progress => said.push(progress));

  expect(said.at(-1)).toEqual({ stage: 'Writing objects', percent: 100 });
  expect(new Set(said.map(progress => progress.stage))).toContain('Counting objects');
  expect(said.every(progress => progress.percent >= 0 && progress.percent <= 100)).toBe(true);
});

it('says how far along a pull is', async () => {
  const { root, remote } = await repositoryWithRemote();
  await git(root, 'push', '--quiet', '-u', 'origin', 'main');
  const other = `${remote}-clone`;
  directories.push(other);
  await execFileWhileWorking('git', ['clone', '--quiet', remote, other]);
  await commit(other, 'b.txt', 'theirs');
  await git(other, 'push', '--quiet');
  const said: { stage: string; percent: number }[] = [];

  await new GitRepository(root).pullBranch(progress => said.push(progress));

  expect(said.length).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(root, 'b.txt')), 'and the pull was made').toBe(true);
});

// Asked for progress, git writes it to the stream it says why it failed on
it('says why a push failed without the progress git printed before it', async () => {
  const { root, remote } = await repositoryWithRemote();
  fs.rmSync(remote, { recursive: true, force: true });

  const failure = await new GitRepository(root).pushBranch(() => {}).then(() => undefined, (error: Error) => error.message);

  expect(failure).toContain('Cannot connect to remote repository');
});

// What git prints for a checkout of many files, which a spec's few files are too quick to bring about
it('reads progress git writes over itself, a line cut in two included, and reports each step once', () => {
  const said: string[] = [];
  const read = progressReader(progress => said.push(`${progress.stage} ${progress.percent}`));

  read('Updating files:  33% (1/3)\rUpdating fil');
  read('es:  66% (2/3)\rUpdating files: 100% (3/3)\rUpdating files: 100% (3/3), done.\n');
  read('remote: Counting objects:  50% (1/2)        \r');

  expect(said).toEqual(['Updating files 33', 'Updating files 66', 'Updating files 100', 'Counting objects 50']);
});

it('keeps what git said of a failure and drops the progress around it', () => {
  expect(withoutProgress('Enumerating objects: 3, done.\nCounting objects:  50% (1/2)\rCounting objects: 100% (2/2), done.\nfatal: unable to access the remote\n'))
    .toBe('fatal: unable to access the remote');
});

it('logs each command with how long it took and why it failed when asked to, and nothing when not', async () => {
  const { root, remote } = await repositoryWithRemote();
  const repo = new GitRepository(root);
  const logged: string[] = [];
  const stop = onLog((event) => { if (event.source === GIT_COMMAND_LOG) logged.push(event.message); });
  try {
    await repo.getCurrentBranch();
    expect(logged, 'not asked to').toEqual([]);

    setDebugEnabled(GIT_COMMAND_LOG, true);
    await repo.getCurrentBranch();
    fs.rmSync(remote, { recursive: true, force: true });
    await repo.pushBranch().catch(() => {});

    expect(logged[0]).toMatch(/^git rev-parse --abbrev-ref HEAD: ok in \d+ ms$/);
    expect(logged.at(-1)).toMatch(/^git push --progress -u origin HEAD: failed \(remote-unreachable\) in \d+ ms$/);
  } finally {
    stop();
  }
});
