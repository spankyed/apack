// What git is in the middle of reaches the window in the status it asks for, with how each file is in conflict,
// and the window has it given up or carried on with.
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

/** The code system over a repository stopped in a merge of `side` into `main`, both of which changed `m.txt` */
async function codeOverAStoppedMerge() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-operation-')));
  dirs.push(directory);
  const write = (content: string) => fs.writeFileSync(path.join(directory, 'm.txt'), content);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  write('base\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'base');
  await git(directory, 'checkout', '--quiet', '-b', 'side');
  write('side\n');
  await git(directory, 'commit', '--quiet', '-am', 'side');
  await git(directory, 'checkout', '--quiet', 'main');
  write('main\n');
  await git(directory, 'commit', '--quiet', '-am', 'main');
  await git(directory, 'merge', '--quiet', 'side').catch(() => undefined);
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return directory;
}
type Status = { files: Array<{ path: string; status: string; conflict?: string }>; branch: string; operation?: object };
async function status(): Promise<Status> {
  const call = await app!.send('code', { type: 'commit.GET_GIT_STATUS' }, { sender: CODE, client: 'c-main' });
  return (await app!.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: call })).data as Status;
}

it('tells the window what git is in the middle of and how each file is in conflict', async () => {
  await codeOverAStoppedMerge();

  expect(await status()).toMatchObject({
    operation: { kind: 'merge', subject: 'side' },
    files: [{ path: 'm.txt', status: 'unmerged', conflict: 'both-modified' }],
  });
});

it('gives it up when the window asks, answers the window, and has nothing in progress after', async () => {
  const directory = await codeOverAStoppedMerge();

  const call = await app!.send('code', { type: 'commit.MOVE_OPERATION', move: 'abort' }, { sender: CODE, client: 'c-main' });
  expect(await app!.nextEmit('code', 'commit.OPERATION_MOVED', { answering: call })).toMatchObject({ data: { move: 'abort' } });

  const after = await status();
  expect(after.operation).toBeUndefined();
  expect(after.files).toEqual([]);
  expect(fs.readFileSync(path.join(directory, 'm.txt'), 'utf8')).toBe('main\n');
});

it('says why when it cannot be carried on with, and leaves it in progress', async () => {
  await codeOverAStoppedMerge();

  const call = await app!.send('code', { type: 'commit.MOVE_OPERATION', move: 'continue' }, { sender: CODE, client: 'c-main' });
  const refused = await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call });

  expect((refused.data as { message: string }).message).toMatch(/unmerged|conflict/i);
  expect((await status()).operation).toMatchObject({ kind: 'merge' });
});
