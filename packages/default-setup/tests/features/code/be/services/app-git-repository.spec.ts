// What the app adds over the git engine: the words a failed push or pull is said in, what can be done about a
// sign-in, which branch a pull request is based on, an image as a data URL, and the switch on the command log.
// Every case runs a real git.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { onLog, setDebugEnabled } from '@apackdev/sdk/logger';
import { AppGitRepository, GIT_COMMAND_LOG } from '../../../../../src/features/code/be/services/app-git-repository.ts';

const directories: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  setDebugEnabled(GIT_COMMAND_LOG, false);
  for (const server of servers.splice(0)) await new Promise((closed) => { server.close(closed); server.closeAllConnections(); });
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-C', cwd, '-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args])).stdout.trim();
function scratch(prefix: string): string {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  directories.push(directory);
  return directory;
}
const write = (root: string, file: string, content: string) => fs.writeFileSync(path.join(root, file), content);
const commit = async (root: string, file: string, message: string) => {
  write(root, file, `${message}\n`);
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', message);
};

/** A repository with one commit on `main`, and no credential helper of the machine's to ask */
async function repository() {
  const root = scratch('apack-app-git-');
  await git(root, 'init', '--quiet', '--initial-branch=main');
  await git(root, 'config', 'credential.helper', '');
  await commit(root, 'a.txt', 'first');
  return root;
}

/** The repository pushed to a bare remote, and a second clone of that remote */
async function sharedWithAnotherClone() {
  const root = await repository();
  const remote = scratch('apack-app-git-remote-');
  await git(remote, 'init', '--quiet', '--bare', '--initial-branch=main');
  await git(root, 'remote', 'add', 'origin', remote);
  await git(root, 'push', '--quiet', '-u', 'origin', 'main');
  const other = `${remote}-clone`;
  directories.push(other);
  await execFileWhileWorking('git', ['clone', '--quiet', remote, other]);
  return { root, remote, other };
}

/** A remote over HTTP that answers every request as one wanting a sign-in */
async function remoteWantingASignIn(): Promise<string> {
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="spec"' }).end();
  });
  servers.push(server);
  await new Promise<void>((listening) => { server.listen(0, '127.0.0.1', listening); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/repo.git`;
}

const refusal = (attempt: Promise<unknown>) => attempt.then(() => { throw new Error('it did not fail'); }, (error: Error & { code?: string }) => ({ code: error.code, message: error.message }));

it('says a push was refused because the remote branch has moved on, in the panel\'s words', async () => {
  const { root, other } = await sharedWithAnotherClone();
  await commit(other, 'b.txt', 'theirs');
  await git(other, 'push', '--quiet');
  await commit(root, 'c.txt', 'ours');

  expect(await refusal(new AppGitRepository(root).pushBranch())).toEqual({
    code: 'non-fast-forward', message: 'Failed to push: Remote branch has diverged. Pull changes first.',
  });
});

it('says a pull stopped on a conflict, and one git may only fast-forward was refused', async () => {
  const { root, other } = await sharedWithAnotherClone();
  write(other, 'a.txt', 'theirs\n');
  await git(other, 'commit', '--quiet', '-am', 'theirs');
  await git(other, 'push', '--quiet');
  write(root, 'a.txt', 'ours\n');
  await git(root, 'commit', '--quiet', '-am', 'ours');

  await git(root, 'config', 'pull.ff', 'only');
  expect(await refusal(new AppGitRepository(root).pullBranch())).toMatchObject({
    code: 'diverged', message: expect.stringContaining('have both moved on'),
  });

  await git(root, 'config', 'pull.rebase', 'false');
  await git(root, 'config', 'pull.ff', 'true');
  expect(await refusal(new AppGitRepository(root).pullBranch())).toEqual({
    code: 'conflict', message: 'Failed to pull: Merge conflicts detected. Resolve conflicts and commit.',
  });
});

it('says why a push failed in its own words, without the progress git printed before it', async () => {
  const { root, remote } = await sharedWithAnotherClone();
  await commit(root, 'b.txt', 'second');
  fs.rmSync(remote, { recursive: true, force: true });

  expect(await refusal(new AppGitRepository(root).pushBranch(() => {}))).toMatchObject({
    code: 'remote-unreachable', message: expect.stringContaining('Failed to push: Cannot connect to remote repository'),
  });
});

it('says the remote asked for a sign-in git does not have, and what kind of sign-in that is', async () => {
  const root = await repository();
  await git(root, 'remote', 'add', 'origin', await remoteWantingASignIn());
  const repo = new AppGitRepository(root);

  expect(await refusal(repo.pushBranch())).toEqual({
    code: 'authentication', message: 'Failed to push: The remote asked for a sign-in that git does not have.',
  });
  expect(await repo.signInHelp()).toEqual({ host: '127.0.0.1', kind: 'https' });
});

it('keeps what can be done about the sign-in with the fetching it stopped', async () => {
  const root = await repository();
  await git(root, 'remote', 'add', 'origin', await remoteWantingASignIn());
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git(root, 'branch', '--quiet', '--set-upstream-to=origin/main');
  const repo = new AppGitRepository(root);
  repo.setFetchConfig(true, 0);
  expect(repo.autoFetchSignIn, 'nothing to do while it is fetching').toBeUndefined();

  await repo.fetchIfDue();

  expect(repo.isAutoFetchSuspended).toBe(true);
  expect(repo.autoFetchSignIn).toEqual({ host: '127.0.0.1', kind: 'https' });

  repo.resumeAutoFetch();
  expect(repo.autoFetchSignIn, 'and nothing once it is fetching again').toBeUndefined();
});

// A window shows that fetching has stopped beside the status, so the engine's check has to read it as a change
it('has a check read fetching stopping, and starting again, as a change to the status', async () => {
  const root = await repository();
  await git(root, 'remote', 'add', 'origin', await remoteWantingASignIn());
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await git(root, 'branch', '--quiet', '--set-upstream-to=origin/main');
  const repo = new AppGitRepository(root);
  repo.setFetchConfig(true, 0);
  await repo.refreshSnapshot();

  await repo.fetchIfDue();
  expect(await repo.refreshSnapshot()).toMatchObject({ status: true, diffs: false });
  expect(await repo.refreshSnapshot(), 'and only once').toMatchObject({ status: false });

  repo.resumeAutoFetch();
  expect(await repo.refreshSnapshot()).toMatchObject({ status: true });
});

it('hands a window an image from a commit as a data URL with every byte as it was committed', async () => {
  const root = await repository();
  const bytes = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256));
  fs.writeFileSync(path.join(root, 'pixel.png'), bytes);
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', 'image');
  fs.rmSync(path.join(root, 'pixel.png'));
  const repo = new AppGitRepository(root);

  expect(repo.isImageFile('pixel.png')).toBe(true);
  expect(await repo.getFileContentAsDataUrl('pixel.png', 'HEAD')).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  expect(await repo.getFileContentFromBranchAsDataUrl('pixel.png', 'main')).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  expect(await repo.getFileContentAsDataUrl('a.txt', 'HEAD'), 'and what is no image as text').toBe('first\n');
});

/** A repository with `main`, and `develop` one commit ahead of it and checked out */
async function repositoryOnDevelop() {
  const root = await repository();
  await git(root, 'checkout', '--quiet', '-b', 'develop');
  await commit(root, 'b.txt', 'on develop');
  return root;
}

// The commits alone cannot tell these apart: a branch made from `develop` and one made from `main` and merged up
// to `develop` hold the same history
it('bases a pull request on the branch a branch was made from, where that was written down', async () => {
  const root = await repositoryOnDevelop();
  const repo = new AppGitRepository(root);
  await repo.checkoutBranch('topic');
  expect(await repo.getPRBaseBranch(), 'written down by this app when it made the branch').toBe('develop');

  await git(root, 'checkout', '--quiet', '-b', 'from-main', 'main');
  await commit(root, 'c.txt', 'on from-main');
  expect(await new AppGitRepository(root).getPRBaseBranch(), 'by git, when it was made with a name to start from').toBe('main');
});

it('goes by the commits when the branch that was written down is gone', async () => {
  const root = await repositoryOnDevelop();
  await git(root, 'checkout', '--quiet', '-b', 'topic');
  await git(root, 'config', 'branch.topic.apack-base', 'deleted-since');
  await commit(root, 'c.txt', 'on topic');

  expect(await new AppGitRepository(root).getPRBaseBranch()).toBe('develop');
});

// A base is given to git as the name of a branch here, so it has to be one
it('does not answer a branch only the remote has, nor a commit reached from a branch', async () => {
  const root = await repositoryOnDevelop();
  const remote = scratch('apack-app-git-base-remote-');
  await git(remote, 'init', '--quiet', '--bare', '--initial-branch=main');
  await git(root, 'remote', 'add', 'origin', remote);
  await git(root, 'push', '--quiet', 'origin', 'main', 'develop');
  await git(root, 'fetch', '--quiet', 'origin');
  await git(root, 'checkout', '--quiet', '-b', 'from-remote', 'origin/develop');
  await git(root, 'branch', '--quiet', '-D', 'develop');
  await commit(root, 'c.txt', 'on from-remote');

  const base = await new AppGitRepository(root).getPRBaseBranch();
  expect(base, 'the remote\'s develop is not a branch here').toBe('main');
  await git(root, 'diff', '--name-status', `${base}...HEAD`);

  await git(root, 'checkout', '--quiet', '-b', 'from-a-commit', 'main~0');
  await commit(root, 'd.txt', 'on from-a-commit');
  expect(await new AppGitRepository(root).getPRBaseBranch()).not.toContain('~');
});

it('keeps the base it worked out until the repository is said to have changed', async () => {
  const root = await repositoryOnDevelop();
  const repo = new AppGitRepository(root);
  await repo.checkoutBranch('topic');
  expect(await repo.getPRBaseBranch()).toBe('develop');

  // Made in a terminal, which a watcher reports as a change under `.git`
  await git(root, 'checkout', '--quiet', '-b', 'from-main', 'main');
  repo.invalidateCache(['.git/HEAD']);

  expect(await repo.getPRBaseBranch()).toBe('main');
});

it('logs each command with how long it took and why it failed when asked to, and nothing when not', async () => {
  const { root, remote } = await sharedWithAnotherClone();
  await commit(root, 'b.txt', 'second');
  const repo = new AppGitRepository(root);
  const logged: string[] = [];
  const stop = onLog((event) => { if (event.source === GIT_COMMAND_LOG) logged.push(event.message); });
  try {
    await repo.readCurrentBranch();
    expect(logged, 'not asked to').toEqual([]);

    setDebugEnabled(GIT_COMMAND_LOG, true);
    await repo.readCurrentBranch();
    fs.rmSync(remote, { recursive: true, force: true });
    await repo.pushBranch().catch(() => {});

    expect(logged[0]).toMatch(/^git rev-parse --abbrev-ref HEAD: ok in \d+ ms$/);
    expect(logged.at(-1)).toMatch(/^git push --progress: failed \(remote-unreachable\) in \d+ ms$/);
  } finally {
    stop();
  }
});
