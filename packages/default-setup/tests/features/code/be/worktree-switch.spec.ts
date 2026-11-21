// Switching to one of the repository's worktrees moves the code surface there and answers the window that asked;
// a path the repository does not list as a worktree is refused, and the surface stays where it was. Driven through
// the code system as a window drives it, over a real repository and worktree.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { answered, refused } from './_support/asks.ts';

const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const asWindow = { client: 'c-main' };
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
  const listed = app.ask('code', { type: 'commit.LIST_REPOSITORIES' }, asWindow);
  return ((await answered(listed)) as { current: string }).current;
}

it('answers the window that asked once it has switched to the worktree', async () => {
  const { app, other } = await withWorktree();

  const call = app.ask('code', { type: 'commit.WORKTREE_SWITCH', path: other }, asWindow);

  expect(await answered(call)).toEqual({ path: other });
  await app.settle();
  expect(await current(app)).toBe(other);
});

it('refuses a path that is no worktree of the repository, and stays where it was', async () => {
  const { app, main } = await withWorktree();
  const elsewhere = path.join(path.dirname(main), 'elsewhere');
  fs.mkdirSync(elsewhere);

  const call = app.ask('code', { type: 'commit.WORKTREE_SWITCH', path: elsewhere }, asWindow);

  expect(await refused(call)).toMatchObject({ message: expect.stringContaining(elsewhere) });
  await app.settle();
  expect(await current(app)).toBe(main);
});

it('keeps the repository picker on the folder the user opened when it switches to a worktree', async () => {
  const { app, main, other } = await withWorktree();

  await answered(app.ask('code', { type: 'commit.WORKTREE_SWITCH', path: other }, asWindow));
  await app.settle();

  const listed = app.ask('code', { type: 'commit.LIST_REPOSITORIES' }, asWindow);
  const data = (await answered(listed)) as { repositories: { path: string }[]; current: string };
  expect(data.current).toBe(other);
  expect(data.repositories.map(repository => repository.path), 'what is listed is under the folder opened, not the worktree').toContain(main);
});
