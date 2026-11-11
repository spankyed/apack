// One piece of a file's change is staged, or taken back out of what is staged, by itself. Every case runs a real
// git: the pieces are the ones git cut, and what is staged afterwards is read from git.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { GitRepository } from '../../../../../src/features/code/be/services/git.ts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-C', cwd, '-c', 'user.name=spec', '-c', 'user.email=spec@example.com', ...args])).stdout;
const lines = (count: number, changed: Record<number, string> = {}) =>
  Array.from({ length: count }, (_, index) => changed[index + 1] ?? `line ${index + 1}`).join('\n') + '\n';

/** A repository with a forty-line file committed, and two edits far apart in it that are not staged */
async function repositoryWithTwoEdits(file = 'a.txt') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-hunks-')));
  directories.push(root);
  await git(root, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(root, file), lines(40));
  await git(root, 'add', '.');
  await git(root, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(root, file), lines(40, { 3: 'the top edit', 35: 'the bottom edit' }));
  return { root, repo: new GitRepository(root) };
}
const staged = (root: string, file = 'a.txt') => git(root, 'show', `:${file}`);

it('cuts a file\'s change into its pieces, each where it is on both sides', async () => {
  const { repo } = await repositoryWithTwoEdits();

  expect((await repo.getHunks('a.txt', false)).map(({ patch: _patch, ...where }) => where)).toEqual([
    { oldStart: 1, oldLines: 6, newStart: 1, newLines: 6 },
    { oldStart: 32, oldLines: 7, newStart: 32, newLines: 7 },
  ]);
  expect(await repo.getHunks('a.txt', true), 'nothing is staged').toEqual([]);
});

it('stages one piece and leaves the other in the working tree', async () => {
  const { root, repo } = await repositoryWithTwoEdits();
  const [, bottom] = await repo.getHunks('a.txt', false);

  await repo.applyHunk('a.txt', false, bottom!.patch);

  expect(await staged(root)).toBe(lines(40, { 35: 'the bottom edit' }));
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'the file itself is untouched').toBe(lines(40, { 3: 'the top edit', 35: 'the bottom edit' }));
  expect((await repo.getHunks('a.txt', false)).map(hunk => hunk.newStart), 'one piece is left to stage').toEqual([1]);
  expect((await repo.getHunks('a.txt', true)).map(hunk => hunk.newStart), 'and one to unstage').toEqual([32]);
});

it('takes one piece back out of what is staged', async () => {
  const { root, repo } = await repositoryWithTwoEdits();
  await git(root, 'add', 'a.txt');
  const [top] = await repo.getHunks('a.txt', true);

  await repo.applyHunk('a.txt', true, top!.patch);

  expect(await staged(root)).toBe(lines(40, { 35: 'the bottom edit' }));
});

// A piece read before the file changed again was cut from lines that are no longer there
it('refuses a piece read before the file changed, and stages nothing', async () => {
  const { root, repo } = await repositoryWithTwoEdits();
  const [top] = await repo.getHunks('a.txt', false);
  fs.writeFileSync(path.join(root, 'a.txt'), lines(40, { 3: 'edited again', 35: 'the bottom edit' }));

  await expect(repo.applyHunk('a.txt', false, top!.patch)).rejects.toThrow('has changed since this change was read');

  expect(await staged(root)).toBe(lines(40));
});

it('stages a piece of a file whose name git has to quote', async () => {
  const { root, repo } = await repositoryWithTwoEdits('nämé with space.txt');
  const [top] = await repo.getHunks('nämé with space.txt', false);

  await repo.applyHunk('nämé with space.txt', false, top!.patch);

  expect(await staged(root, 'nämé with space.txt')).toBe(lines(40, { 3: 'the top edit' }));
});

it('keeps the last line as it is when it has no line break', async () => {
  const { root, repo } = await repositoryWithTwoEdits();
  fs.writeFileSync(path.join(root, 'a.txt'), `${lines(40, { 3: 'the top edit' })}added with no break`);
  const [, last] = await repo.getHunks('a.txt', false);

  await repo.applyHunk('a.txt', false, last!.patch);

  expect(await staged(root)).toBe(`${lines(40)}added with no break`);
});

// Only the whole of such a file is staged: a piece of a file that is new, gone, renamed or binary is not a piece
it('offers no pieces of a file that is new, deleted, renamed or binary', async () => {
  const { root, repo } = await repositoryWithTwoEdits();
  fs.writeFileSync(path.join(root, 'new.txt'), 'new\n');
  fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 1, 2, 0, 255]));
  await git(root, 'add', 'new.txt', 'image.bin');
  await git(root, 'commit', '--quiet', '-m', 'more');
  fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 9, 9, 0, 255]));
  fs.writeFileSync(path.join(root, 'added.txt'), 'added\n');
  await git(root, 'rm', '--quiet', 'new.txt');
  await git(root, 'add', 'added.txt');
  await git(root, 'mv', 'a.txt', 'moved.txt');

  expect(await repo.getHunks('image.bin', false)).toEqual([]);
  expect(await repo.getHunks('added.txt', true)).toEqual([]);
  expect(await repo.getHunks('new.txt', true)).toEqual([]);
  expect(await repo.getHunks('moved.txt', true)).toEqual([]);
});
