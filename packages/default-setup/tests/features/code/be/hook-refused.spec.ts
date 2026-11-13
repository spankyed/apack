// A commit the repository's own hook refuses reaches the window as the hook's refusal: which hook, the code it
// exited with and what it printed, and nothing is committed. The repository and its hook are real ones, driven
// through the code system as a window drives it.
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

it('tells the window which hook refused a commit, its exit code and what it printed', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-hook-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  const hook = path.join(directory, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "lint: a.txt is not formatted" >&2\nexit 3\n');
  fs.chmodSync(hook, 0o755);
  fs.writeFileSync(path.join(directory, 'a.txt'), 'two\n');
  await git(directory, 'add', '.');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  // A hook is a program the repository has git run, so the window has trusted it, as it would be asked to
  const repository = path.join(directory, '.git');
  await app.nextEmit('code', 'commit.REPOSITORY_TRUSTED', { answering: await app.send('code', { type: 'commit.TRUST_REPOSITORY', repository }, asWindow) });

  const call = await app.send('code', { type: 'commit.COMMIT', message: 'second' }, asWindow);

  expect((await app.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: call })).data).toMatchObject({
    code: 'hook-refused',
    hook: { name: 'pre-commit', exitCode: 3, output: expect.stringContaining('lint: a.txt is not formatted') },
  });
  expect((await git(directory, 'rev-list', '--count', 'HEAD')).stdout.trim(), 'and nothing was committed').toBe('1');
});
