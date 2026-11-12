// A diff is drawn from a file's two sides, which are read when it is asked for. The file goes on changing under
// a diff left open, so the news of a change names the files whose diff is no longer what was read, and a diff
// asked for again says what the file holds now, whether or not it still has a change.
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

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });

/** The code system over a repository holding one committed file, `a.txt` */
async function codeOverRepository() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-diff-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'committed\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  // The first check has nothing to compare with and says everything changed: what follows is compared with it
  await announcedSince(0, { status: true, history: true });
  return directory;
}

/** What each announcement so far said changed */
const announced = () => app!.emitted('code').filter(event => event.type === 'commit.REPOSITORY_CHANGED').map(event => event.changed as object);
/** A check as a window that gained focus asks for one: no window here asks for the status each announcement names */
async function checked() {
  await app!.send('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES', by: 'window' });
  await app!.settle();
}
/**
 * Waits for the announcement of a change made after `mark`. Whichever check sees the change first announces it,
 * the watcher's or the one asked for here, so it is looked for among everything announced since.
 */
function announcedSince(mark: number, change: object) {
  return expect.poll(async () => {
    await checked();
    return announced().slice(mark);
  }).toContainEqual(expect.objectContaining(change));
}
/** Makes a change and waits for its announcement */
async function changed(change: object, make: () => unknown) {
  const mark = announced().length;
  await make();
  await announcedSince(mark, change);
}
async function diffOf(file: string, staged: boolean) {
  const call = await app!.send('code', { type: 'commit.GET_GIT_DIFF', path: file, staged }, { sender: CODE, client: 'c-main' });
  const answer = await app!.nextEmit('code', 'commit.DIFF_RECEIVED', { answering: call });
  const { originalContent, modifiedContent } = answer.data as { originalContent?: string; modifiedContent?: string };
  return { originalContent, modifiedContent };
}

it('names the file whose diff changed when a file already changed is edited again', async () => {
  const directory = await codeOverRepository();
  await changed({ status: true, diffs: true, files: ['a.txt'] }, () => fs.writeFileSync(path.join(directory, 'a.txt'), 'edited\n'));

  // The list of changed files is what it was, so only the diff is news
  await changed({ status: false, diffs: true, files: ['a.txt'] }, () => fs.writeFileSync(path.join(directory, 'a.txt'), 'edited a second time\n'));
  expect(await diffOf('a.txt', false)).toEqual({ originalContent: 'committed\n', modifiedContent: 'edited a second time\n' });
});

it('answers a file that has no change left on a side with what it holds now on both', async () => {
  const directory = await codeOverRepository();
  await changed({ status: true, diffs: true, files: ['a.txt'] }, () => fs.writeFileSync(path.join(directory, 'a.txt'), 'edited\n'));
  expect(await diffOf('a.txt', false)).toEqual({ originalContent: 'committed\n', modifiedContent: 'edited\n' });

  await changed({ status: true, diffs: true, files: ['a.txt'] }, () => git(directory, 'add', 'a.txt'));

  expect(await diffOf('a.txt', false), 'nothing is unstaged any more').toEqual({ originalContent: 'edited\n', modifiedContent: 'edited\n' });
  expect(await diffOf('a.txt', true)).toEqual({ originalContent: 'committed\n', modifiedContent: 'edited\n' });
});
