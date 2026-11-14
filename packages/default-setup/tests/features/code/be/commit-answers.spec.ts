// What the commit panel's asks are answered with, driven through the code system as a window drives it, over real
// repositories and remotes on this machine:
//  - checking out moves to a branch there is and pulls only when asked to, and a name no branch has is answered with
//    the name, which the panel offers to make;
//  - a commit's failure carries what can be done about it;
//  - a stash applied or popped is answered as that, and one that conflicts as the conflict;
//  - unstaging a file renamed and edited since takes the rename out of what is staged whole;
//  - the repository picker answers with no folder open;
//  - the repository a new folder replaces is closed.
import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { AppGitRepository } from '#features/code/be/services/app-git-repository.ts';

const CODE = 'default-setup/code';
const asWindow = { sender: CODE, client: 'c-main' };
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout.trim();
const scratch = (prefix: string) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(directory);
  return directory;
};

/** A repository with one commit of `a.txt` */
async function repository(directory = scratch('code-commit-')) {
  fs.mkdirSync(directory, { recursive: true });
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  return directory;
}

/** The code system, over `directory` when one is named */
async function code(directory?: string) {
  app = await startApp({ systems: ['code'] });
  await app.connect();
  if (directory) {
    await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
    await app.settle();
  }
  return app;
}

/** A clone of a bare remote, which has since moved `main` on by one commit the clone has fetched and not merged */
async function cloneBehind() {
  const root = scratch('code-checkout-');
  const author = await repository(path.join(root, 'author'));
  const bare = path.join(root, 'remote.git');
  await execFileWhileWorking('git', ['clone', '--quiet', '--bare', author, bare]);
  const clone = path.join(root, 'clone');
  await execFileWhileWorking('git', ['clone', '--quiet', bare, clone]);
  await git(clone, 'checkout', '--quiet', '-b', 'side');
  fs.writeFileSync(path.join(author, 'b.txt'), 'two\n');
  await git(author, 'add', '.');
  await git(author, 'commit', '--quiet', '-m', 'second');
  await git(author, 'push', '--quiet', bare, 'main');
  await git(clone, 'fetch', '--quiet');
  return { clone, here: await git(clone, 'rev-parse', 'main'), theirs: await git(author, 'rev-parse', 'HEAD') };
}

it('checks out a branch and pulls it only when asked to', async () => {
  const { clone, here, theirs } = await cloneBehind();
  const app = await code(clone);

  const checkout = await app.send('code', { type: 'commit.CHECKOUT_BRANCH', branchName: 'main' }, asWindow);
  await app.nextEmit('code', 'commit.BRANCH_CHECKOUT_SUCCESS', { answering: checkout });
  expect(await git(clone, 'rev-parse', 'HEAD'), 'a checkout pulls nothing').toBe(here);

  await git(clone, 'checkout', '--quiet', 'side');
  const pulled = await app.send('code', { type: 'commit.CHECKOUT_BRANCH', branchName: 'main', pull: true }, asWindow);
  await app.nextEmit('code', 'commit.BRANCH_CHECKOUT_SUCCESS', { answering: pulled });
  expect(await git(clone, 'rev-parse', 'HEAD'), '"Checkout & Pull Base" pulls').toBe(theirs);
});

it('answers a branch no one has with its name, makes nothing, and makes it when asked', async () => {
  const directory = await repository();
  const app = await code(directory);

  const checkout = await app.send('code', { type: 'commit.CHECKOUT_BRANCH', branchName: 'topic' }, asWindow);
  expect((await app.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: checkout })).data).toMatchObject({ code: 'unknown-ref', missingBranch: 'topic' });
  expect(await git(directory, 'branch', '--list', 'topic')).toBe('');

  const created = await app.send('code', { type: 'commit.CREATE_BRANCH', branchName: 'topic' }, asWindow);
  expect((await app.nextEmit('code', 'commit.BRANCH_CHECKOUT_SUCCESS', { answering: created })).data).toEqual({ branchName: 'topic' });
  expect(await git(directory, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('topic');
});

it('answers a commit refused in an untrusted repository with what it would run, for the panel to offer trust', async () => {
  const directory = await repository();
  const program = path.join(scratch('code-commit-program-'), 'monitor.sh');
  fs.writeFileSync(program, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(program, 0o755);
  await git(directory, 'config', 'core.fsmonitor', program);
  const app = await code(directory);

  const committed = await app.send('code', { type: 'commit.COMMIT', message: 'second' }, asWindow);

  expect((await app.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: committed })).data).toMatchObject({
    code: 'untrusted', trust: { repository: path.join(directory, '.git') },
  });
});

it('answers a stash applied as that, keeping it, and one popped over a conflict as the conflict', async () => {
  const directory = await repository();
  fs.writeFileSync(path.join(directory, 'a.txt'), 'stashed\n');
  await git(directory, 'stash', 'push', '--quiet');
  const app = await code(directory);

  const applied = await app.send('code', { type: 'commit.STASH_APPLY', index: 0 }, asWindow);
  expect((await app.nextEmit('code', 'commit.STASH_APPLIED', { answering: applied })).data).toEqual({ index: 0, popped: false });
  expect(await git(directory, 'stash', 'list')).not.toBe('');

  await git(directory, 'commit', '--quiet', '-am', 'another change to the same line');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'conflicting\n');
  await git(directory, 'commit', '--quiet', '-am', 'conflicting');
  const popped = await app.send('code', { type: 'commit.STASH_POP', index: 0 }, asWindow);
  expect((await app.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: popped })).data).toMatchObject({ code: 'conflict' });
});

it('takes a file renamed in the index and edited since out of what is staged whole', async () => {
  const directory = await repository();
  await git(directory, 'mv', 'a.txt', 'b.txt');
  fs.writeFileSync(path.join(directory, 'b.txt'), 'one\nedited since\n');
  const app = await code(directory);

  // The status lists the staged row of the rename before the unstaged row of the edit; the lookup is for the staged
  // row whichever comes first, and this fails if it took the edit's row while the edit's row came first
  const unstaged = await app.send('code', { type: 'commit.UNSTAGE_FILES', paths: ['b.txt'] }, asWindow);
  await app.nextEmit('code', 'commit.FILES_UNSTAGED', { answering: unstaged });

  expect(await git(directory, 'diff', '--cached', '--name-status'), 'neither the new path nor the old one is staged').toBe('');
});

it('answers the repository picker with nothing when no folder is open', async () => {
  const app = await code();

  const listed = await app.send('code', { type: 'LIST_REPOSITORIES' }, asWindow);

  expect((await app.nextEmit('code', 'commit.REPOSITORIES_RECEIVED', { answering: listed })).data).toMatchObject({ repositories: [], truncated: false });
});

it('closes the repository a new folder replaces', async () => {
  const first = await repository();
  const second = await repository();
  const closed = vi.spyOn(AppGitRepository.prototype, 'close');
  const app = await code(first);

  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: second });
  await app.settle();

  expect(closed.mock.contexts.map(repository => (repository as AppGitRepository).getWorkingDir())).toEqual([first]);
});
