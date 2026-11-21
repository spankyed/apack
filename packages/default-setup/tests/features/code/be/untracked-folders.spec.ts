// A window opens an untracked folder's row to see what is in it, and opens a file of it as a new file. The
// repository is a real one, driven through the code system as a window drives it.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { answered } from './_support/asks.ts';

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
const asWindow = { client: 'c-main' };

/** The code system over a repository with one tracked file and a folder of two files git tracks nothing in */
async function codeOverAnUntrackedFolder() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-folders-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'tracked\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.mkdirSync(path.join(directory, 'third-party/lib'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'third-party/lib/one.js'), 'one\n');
  fs.writeFileSync(path.join(directory, 'third-party/two.js'), 'two\n');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
}

it('tells the window the folder as one row, and what is in it when the row is opened', async () => {
  await codeOverAnUntrackedFolder();

  const asked = app!.ask('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  const status = (await answered(asked)) as { files: object[] };
  expect(status.files).toEqual([{ path: 'third-party/', status: 'untracked', staged: false, isDirectory: true }]);

  const opened = app!.ask('code', { type: 'commit.LIST_UNTRACKED', path: 'third-party/' }, asWindow);
  expect(await answered(opened)).toEqual({
    path: 'third-party/', files: ['third-party/lib/one.js', 'third-party/two.js'], truncated: false,
  });
});

// A file of the folder has no row of its own in the status, and is a new file all the same
it('shows a file of the folder as a new file: nothing on the left, the file on the right', async () => {
  await codeOverAnUntrackedFolder();

  const call = app!.ask('code', { type: 'commit.GET_GIT_DIFF', path: 'third-party/lib/one.js', staged: false }, asWindow);

  expect(await answered(call)).toMatchObject({
    path: 'third-party/lib/one.js', originalContent: '', modifiedContent: 'one\n',
  });
});
