// A window showing a file's diff is told the pieces of the change, and has one staged by itself. The repository
// is a real one, driven through the code system as a window drives it.
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

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout;
const lines = (changed: Record<number, string> = {}) =>
  Array.from({ length: 40 }, (_, index) => changed[index + 1] ?? `line ${index + 1}`).join('\n') + '\n';

/** The code system over a repository whose one file has two edits far apart, neither staged */
async function codeOverTwoEdits() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-hunks-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), lines());
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(directory, 'a.txt'), lines({ 3: 'the top edit', 35: 'the bottom edit' }));
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return directory;
}
type Hunk = { newStart: number; patch: string };
const asWindow = { sender: CODE, client: 'c-main' };
async function diffOf(staged: boolean) {
  const call = await app!.send('code', { type: 'commit.GET_GIT_DIFF', path: 'a.txt', staged }, asWindow);
  return (await app!.nextEmit('code', 'commit.DIFF_RECEIVED', { answering: call })).data as { hunks: Hunk[] };
}

it('tells the window the pieces of a file\'s change with its diff', async () => {
  await codeOverTwoEdits();

  expect((await diffOf(false)).hunks.map(hunk => hunk.newStart)).toEqual([1, 32]);
  expect((await diffOf(true)).hunks).toEqual([]);
});

it('stages the one piece the window asks for, answers it, and has the piece on the staged side after', async () => {
  const directory = await codeOverTwoEdits();
  const [top] = (await diffOf(false)).hunks;

  const call = await app!.send('code', { type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, patch: top!.patch }, asWindow);

  expect((await app!.nextEmit('code', 'commit.HUNK_APPLIED', { answering: call })).data).toEqual({ path: 'a.txt', staged: false });
  expect(await git(directory, 'show', ':a.txt')).toBe(lines({ 3: 'the top edit' }));
  expect((await diffOf(false)).hunks.map(hunk => hunk.newStart), 'what is left to stage').toEqual([32]);
  expect((await diffOf(true)).hunks.map(hunk => hunk.newStart), 'and what can be taken back').toEqual([1]);
});

it('tells the window a piece is out of date when the file changed since it was read, and stages nothing', async () => {
  const directory = await codeOverTwoEdits();
  const [top] = (await diffOf(false)).hunks;
  fs.writeFileSync(path.join(directory, 'a.txt'), lines({ 3: 'edited again', 35: 'the bottom edit' }));

  const call = await app!.send('code', { type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, patch: top!.patch }, asWindow);

  expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call })).data).toMatchObject({
    message: expect.stringContaining('has changed since this change was read'),
  });
  expect(await git(directory, 'show', ':a.txt')).toBe(lines());
});
