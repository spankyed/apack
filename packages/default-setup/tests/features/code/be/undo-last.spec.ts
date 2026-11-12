// The last write the panel made can be taken back: a commit comes off its branch with what it held left staged, and
// one already pushed is taken back only once the window says so. Driven through the code system as a window drives
// it, over a real repository.
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
  String((await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout).trim();
const asWindow = { sender: CODE, client: 'c-main' };

/** The code system over a repository with one commit, an identity for the next, and `a.txt` edited and staged */
async function codeOverStaged() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-undo-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'two\n');
  await git(directory, 'add', '.');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return directory;
}

it('offers to take back a commit, and takes it back with what it held left staged', async () => {
  const directory = await codeOverStaged();
  const first = await git(directory, 'rev-parse', 'HEAD');

  const committed = await app!.send('code', { type: 'commit.COMMIT', message: 'second' }, asWindow);
  const { data: offered } = await app!.nextEmit('code', 'commit.UNDOABLE_RECEIVED', { answering: committed });
  expect(offered).toMatchObject({ summary: 'commit "second"' });

  const undone = await app!.send('code', { type: 'commit.UNDO_LAST' }, asWindow);
  expect((await app!.nextEmit('code', 'commit.UNDONE', { answering: undone })).data).toMatchObject({ summary: 'commit "second"' });
  expect((await app!.nextEmit('code', 'commit.UNDOABLE_RECEIVED', { answering: undone })).data, 'and there is nothing more to take back').toBeNull();
  expect(await git(directory, 'rev-parse', 'HEAD')).toBe(first);
  expect(await git(directory, 'diff', '--cached', '--name-only')).toBe('a.txt');
});

it('asks before taking back a commit already pushed, and takes it back once told to', async () => {
  const directory = await codeOverStaged();
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-undo-remote-')));
  dirs.push(remote);
  await git(remote, 'init', '--quiet', '--bare');
  await git(directory, 'remote', 'add', 'origin', remote);
  const committed = await app!.send('code', { type: 'commit.COMMIT', message: 'second' }, asWindow);
  await app!.nextEmit('code', 'commit.UNDOABLE_RECEIVED', { answering: committed });
  await git(directory, 'push', '--quiet', 'origin', 'main');

  const asked = await app!.send('code', { type: 'commit.UNDO_LAST' }, asWindow);
  const { data } = await app!.nextEmit('code', 'commit.UNDO_NEEDS_CONFIRMATION', { answering: asked });
  expect((data as { message: string }).message).toContain('origin/main');
  expect(await git(directory, 'log', '-1', '--format=%s'), 'nothing was undone yet').toBe('second');

  const undone = await app!.send('code', { type: 'commit.UNDO_LAST', evenIfPublished: true }, asWindow);
  await app!.nextEmit('code', 'commit.UNDONE', { answering: undone });
  expect(await git(directory, 'log', '-1', '--format=%s')).toBe('first');
});
