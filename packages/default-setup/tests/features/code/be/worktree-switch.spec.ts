// Switching to one of the repository's worktrees moves the code surface there and answers the window that asked;
// a path the repository does not list as a worktree is refused, and the surface stays where it was. Driven through
// the code system as a window drives it, over a real repository and worktree.
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
const git = (cwd: string, ...args: string[]) => execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });

/** A repository with a second worktree beside it, and the code system over the repository */
async function withWorktree() {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-worktree-')));
  dirs.push(folder);
  const main = path.join(folder, 'main');
  const other = path.join(folder, 'other');
  fs.mkdirSync(main);
  await git(main, 'init', '--quiet', '--initial-branch=main');
  await git(main, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  await git(main, 'worktree', 'add', '--quiet', '-b', 'other', other);
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: main });
  await app.settle();
  return { app, main, other };
}

/** The folder the code system is over, as the repository picker says it */
async function current(app: Awaited<ReturnType<typeof startApp>>) {
  const listed = await app.send('code', { type: 'LIST_REPOSITORIES' }, asWindow);
  return ((await app.nextEmit('code', 'commit.REPOSITORIES_RECEIVED', { answering: listed })).data as { current: string }).current;
}

it('answers the window that asked once it has switched to the worktree', async () => {
  const { app, other } = await withWorktree();

  const call = await app.send('code', { type: 'commit.WORKTREE_SWITCH', path: other }, asWindow);

  expect((await app.nextEmit('code', 'commit.WORKTREE_SWITCHED', { answering: call })).data).toEqual({ path: other });
  await app.settle();
  expect(await current(app)).toBe(other);
});

it('refuses a path that is no worktree of the repository, and stays where it was', async () => {
  const { app, main } = await withWorktree();
  const elsewhere = path.join(path.dirname(main), 'elsewhere');
  fs.mkdirSync(elsewhere);

  const call = await app.send('code', { type: 'commit.WORKTREE_SWITCH', path: elsewhere }, asWindow);

  expect((await app.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call })).data).toMatchObject({ message: expect.stringContaining(elsewhere) });
  await app.settle();
  expect(await current(app)).toBe(main);
});
