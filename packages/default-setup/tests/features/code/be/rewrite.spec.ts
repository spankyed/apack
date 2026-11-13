// Amending the last commit and rewording, folding or dropping one in the history, asked for by the window: each
// leaves the tree's content as it was (a drop aside, which takes out what its commit brought) and can be undone,
// and one a remote branch already holds is done only once the window says to go on. The repositories are real
// ones, driven through the code system as a window drives it.
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

/** The code system over four commits, each adding a file named for it, the third with a body to its message */
async function codeOverFourCommits() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-rewrite-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  for (const name of ['one', 'two', 'three', 'four']) {
    fs.writeFileSync(path.join(directory, `${name}.txt`), `${name}\n`);
    await git(directory, 'add', '.');
    await git(directory, 'commit', '--quiet', '-m', name, ...(name === 'three' ? ['-m', 'Why three.'] : []));
  }
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return {
    directory,
    head: () => git(directory, 'rev-parse', 'HEAD'),
    commit: (subject: string) => git(directory, 'log', '--format=%H', `--grep=^${subject}$`, 'HEAD'),
    subjects: async () => (await git(directory, 'log', '--format=%s')).split('\n'),
    files: async () => (await git(directory, 'ls-tree', '--name-only', 'HEAD')).split('\n'),
  };
}

async function undo() {
  const call = await app!.send('code', { type: 'commit.UNDO_LAST' }, asWindow);
  await app!.nextEmit('code', 'commit.UNDONE', { answering: call });
}

it('amends the last commit with what is staged and a new message, and undoing it puts it back', async () => {
  const { directory, head, subjects, files } = await codeOverFourCommits();
  const before = await head();
  fs.writeFileSync(path.join(directory, 'late.txt'), 'late\n');
  await git(directory, 'add', 'late.txt');

  const call = await app!.send('code', { type: 'commit.AMEND', message: 'four, amended' }, asWindow);
  await app!.nextEmit('code', 'commit.AMENDED', { answering: call });

  expect((await subjects())[0]).toBe('four, amended');
  expect(await files()).toContain('late.txt');
  await undo();
  expect(await head()).toBe(before);
});

it('rewords a commit with its whole message, keeping those after it and the tree as it was', async () => {
  const { head, commit, subjects } = await codeOverFourCommits();
  const before = await head();
  const tree = await git(dirs[0]!, 'rev-parse', 'HEAD^{tree}');
  const three = await commit('three');

  const read = await app!.send('code', { type: 'commit.GET_COMMIT_MESSAGE', hash: three }, asWindow);
  const { message } = (await app!.nextEmit('code', 'commit.COMMIT_MESSAGE_RECEIVED', { answering: read })).data as { message: string };
  expect(message).toBe('three\n\nWhy three.');

  const call = await app!.send('code', { type: 'commit.REWRITE_COMMIT', hash: three, action: 'reword', message: message.replace('three', 'three, reworded') }, asWindow);
  expect((await app!.nextEmit('code', 'commit.COMMIT_REWRITTEN', { answering: call })).data).toEqual({ hash: three, action: 'reword' });

  expect(await subjects()).toEqual(['four', 'three, reworded', 'two', 'one']);
  expect(await git(dirs[0]!, 'log', '-1', '--format=%b', 'HEAD~1'), 'and its body is kept').toBe('Why three.');
  expect(await git(dirs[0]!, 'rev-parse', 'HEAD^{tree}')).toBe(tree);
  await undo();
  expect(await head()).toBe(before);
});

it('folds a commit into the one before it, keeping that one\'s message and the tree', async () => {
  const { head, commit, subjects } = await codeOverFourCommits();
  const before = await head();
  const tree = await git(dirs[0]!, 'rev-parse', 'HEAD^{tree}');

  const call = await app!.send('code', { type: 'commit.REWRITE_COMMIT', hash: await commit('three'), action: 'squash' }, asWindow);
  await app!.nextEmit('code', 'commit.COMMIT_REWRITTEN', { answering: call });

  expect(await subjects()).toEqual(['four', 'two', 'one']);
  expect(await git(dirs[0]!, 'rev-parse', 'HEAD^{tree}')).toBe(tree);
  await undo();
  expect(await head()).toBe(before);
});

it('drops a commit, taking out only what it brought', async () => {
  const { head, commit, subjects, files } = await codeOverFourCommits();
  const before = await head();

  const call = await app!.send('code', { type: 'commit.REWRITE_COMMIT', hash: await commit('two'), action: 'drop' }, asWindow);
  await app!.nextEmit('code', 'commit.COMMIT_REWRITTEN', { answering: call });

  expect(await subjects()).toEqual(['four', 'three', 'one']);
  expect(await files()).toEqual(['four.txt', 'one.txt', 'three.txt']);
  await undo();
  expect(await head()).toBe(before);
});

it('asks before rewriting a commit a remote branch holds, and rewrites it once the window says to', async () => {
  const { directory, commit, subjects } = await codeOverFourCommits();
  await git(directory, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const three = await commit('three');

  const refused = await app!.send('code', { type: 'commit.REWRITE_COMMIT', hash: three, action: 'drop' }, asWindow);
  expect(((await app!.nextEmit('code', 'commit.REWRITE_NEEDS_CONFIRMATION', { answering: refused })).data as { message: string }).message).toMatch(/already on a remote branch/);
  expect(await subjects(), 'and nothing was rewritten').toEqual(['four', 'three', 'two', 'one']);

  const call = await app!.send('code', { type: 'commit.REWRITE_COMMIT', hash: three, action: 'drop', evenIfPublished: true }, asWindow);
  await app!.nextEmit('code', 'commit.COMMIT_REWRITTEN', { answering: call });
  expect(await subjects()).toEqual(['four', 'two', 'one']);
});

it('refuses a fold of the first commit, and a commit across a merge', async () => {
  const { directory, commit } = await codeOverFourCommits();

  const first = await app!.send('code', { type: 'commit.REWRITE_COMMIT', hash: await commit('one'), action: 'squash' }, asWindow);
  expect(((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: first })).data as { message: string }).message).toMatch(/nothing before it/);

  await git(directory, 'checkout', '--quiet', '-b', 'side', 'HEAD~1');
  fs.writeFileSync(path.join(directory, 'side.txt'), 'side\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'side');
  await git(directory, 'checkout', '--quiet', 'main');
  await git(directory, 'merge', '--quiet', '--no-ff', '-m', 'merged', 'side');
  const acrossMerge = await app!.send('code', { type: 'commit.REWRITE_COMMIT', hash: await commit('two'), action: 'drop' }, asWindow);
  expect(((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: acrossMerge })).data as { message: string }).message).toMatch(/merge is among/);
});
