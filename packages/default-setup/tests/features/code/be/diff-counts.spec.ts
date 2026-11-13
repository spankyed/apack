// What each changed file adds and removes, beside it in the panel, and a stash's files read before it is applied.
// Driven through the code system as a window drives it, over a real repository.
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
  String((await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout).trim();

it('answers the status with each file\'s count, and a stash\'s files without applying it', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-counts-')));
  dirs.push(directory);
  const write = (file: string, content: string) => fs.writeFileSync(path.join(directory, file), content);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  write('a.txt', 'one\ntwo\nthree\n');
  write('b.txt', 'b\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  write('b.txt', 'b, stashed\n');
  await git(directory, 'stash', 'push', '--quiet');
  write('a.txt', 'one\nTWO\nthree\nfour\n');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const asked = await app.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  const { data } = await app.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: asked });
  expect((data as { counts: unknown }).counts).toEqual([{ path: 'a.txt', staged: false, added: 2, removed: 1, binary: false }]);

  const peeked = await app.send('code', { type: 'commit.GET_STASH_CHANGES', index: 0 }, asWindow);
  const { data: stash } = await app.nextEmit('code', 'commit.STASH_CHANGES_RECEIVED', { answering: peeked });
  expect(stash).toEqual({ index: 0, files: [{ path: 'b.txt', status: 'modified', added: 1, removed: 1, binary: false }] });
  expect(fs.readFileSync(path.join(directory, 'b.txt'), 'utf8'), 'and the stash was not applied').toBe('b\n');
});
