// A window opens an untracked folder's row to see what is in it, and opens a file of it as a new file. The
// repository is a real one, driven through the code system as a window drives it.
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
const asWindow = { sender: CODE, client: 'c-main' };

/** The code system over a repository with one tracked file and a folder of two files git tracks nothing in */
async function codeOverAnUntrackedFolder() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-folders-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'tracked\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.mkdirSync(path.join(directory, 'vendor/lib'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'vendor/lib/one.js'), 'one\n');
  fs.writeFileSync(path.join(directory, 'vendor/two.js'), 'two\n');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
}

it('tells the window the folder as one row, and what is in it when the row is opened', async () => {
  await codeOverAnUntrackedFolder();

  const asked = await app!.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  const status = (await app!.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: asked })).data as { files: object[] };
  expect(status.files).toEqual([{ path: 'vendor/', status: 'untracked', staged: false, isDirectory: true }]);

  const opened = await app!.send('code', { type: 'commit.LIST_UNTRACKED', path: 'vendor/' }, asWindow);
  expect((await app!.nextEmit('code', 'commit.UNTRACKED_LISTED', { answering: opened })).data).toEqual({
    path: 'vendor/', files: ['vendor/lib/one.js', 'vendor/two.js'], truncated: false,
  });
});

// A file of the folder has no row of its own in the status, and is a new file all the same
it('shows a file of the folder as a new file: nothing on the left, the file on the right', async () => {
  await codeOverAnUntrackedFolder();

  const call = await app!.send('code', { type: 'commit.GET_GIT_DIFF', path: 'vendor/lib/one.js', staged: false }, asWindow);

  expect((await app!.nextEmit('code', 'commit.DIFF_RECEIVED', { answering: call })).data).toMatchObject({
    path: 'vendor/lib/one.js', originalContent: '', modifiedContent: 'one\n',
  });
});
