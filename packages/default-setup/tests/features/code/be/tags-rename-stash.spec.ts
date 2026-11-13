// Tags made, listed, pushed and deleted, a branch renamed, and one file's changes stashed, asked for by the window
// and each held to what git reports afterwards. The repositories are real ones, a bare one standing for the
// remote, driven through the code system as a window drives it.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';

const CODE = 'default-setup/code';
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const asWindow = { sender: CODE, client: 'c-main' };
const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout.trim();

/** The code system over two commits on `main`, with a bare repository as its `origin` */
async function codeOverARepository() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-tags-')));
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-tags-remote-')));
  dirs.push(directory, remote);
  await git(remote, 'init', '--quiet', '--bare');
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  for (const name of ['a', 'b']) {
    fs.writeFileSync(path.join(directory, `${name}.txt`), `${name}\n`);
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--quiet', '-m', name);
  }
  await git(directory, 'remote', 'add', 'origin', remote);
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return { directory, remote };
}

async function ask<T>(event: Record<string, unknown> & { type: string }, answer: string): Promise<T> {
  const call = await app!.send('code', event as never, asWindow);
  return (await app!.nextEmit('code', answer, { answering: call })).data as T;
}

it('makes a tag at a commit, lists it, pushes it and deletes it here', async () => {
  const { directory, remote } = await codeOverARepository();
  const first = await git(directory, 'rev-parse', 'HEAD~1');

  expect(await ask({ type: 'commit.CREATE_TAG', name: 'v1', commit: first, message: 'The first' }, 'commit.TAG_CREATED')).toEqual({ name: 'v1' });
  expect(await git(directory, 'rev-parse', 'v1^{commit}')).toBe(first);
  expect(await git(directory, 'cat-file', '-t', 'v1'), 'annotated, having a message').toBe('tag');
  expect((await ask<{ tags?: { name: string; commit: string }[] }>({ type: 'commit.GET_ALL_BRANCHES' }, 'commit.BRANCHES_RECEIVED')).tags).toEqual([{ name: 'v1', commit: first }]);

  await ask({ type: 'commit.PUSH_TAG', name: 'v1' }, 'commit.TAG_PUSHED');
  expect(await git(remote, 'rev-parse', 'v1^{commit}')).toBe(first);

  await ask({ type: 'commit.DELETE_TAG', name: 'v1' }, 'commit.TAG_DELETED');
  expect(await git(directory, 'tag', '--list')).toBe('');
  expect(await git(remote, 'tag', '--list'), 'and the remote keeps what was pushed').toBe('v1');
});

it('renames the branch checked out, which stays checked out', async () => {
  const { directory } = await codeOverARepository();
  const head = await git(directory, 'rev-parse', 'HEAD');

  expect(await ask({ type: 'commit.RENAME_BRANCH', name: 'main', to: 'trunk' }, 'commit.BRANCH_RENAMED')).toEqual({ name: 'main', to: 'trunk' });

  expect(await git(directory, 'branch', '--show-current')).toBe('trunk');
  expect(await git(directory, 'rev-parse', 'trunk')).toBe(head);
  expect(await git(directory, 'branch', '--list', 'main')).toBe('');
});

it('stashes one file\'s changes and leaves the others as they are', async () => {
  const { directory } = await codeOverARepository();
  fs.writeFileSync(path.join(directory, 'a.txt'), 'a changed\n');
  fs.writeFileSync(path.join(directory, 'b.txt'), 'b changed\n');

  await ask({ type: 'commit.STASH_PUSH', message: 'a.txt', paths: ['a.txt'] }, 'commit.STASH_SUCCESS');

  expect(await git(directory, 'status', '--porcelain')).toBe('M b.txt');
  expect(await git(directory, 'stash', 'show', '--name-only', 'stash@{0}')).toBe('a.txt');
  expect(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8')).toBe('a\n');
});
