// The branch picker's branches, each local one with how it stands against what it follows. Driven through the code
// system as a window drives it, over a real clone.
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

it('answers the branches with each local one\'s standing against what it follows', async () => {
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-standing-remote-')));
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-standing-')));
  dirs.push(remote, parent);
  const commit = async (cwd: string, message: string) => git(cwd, 'commit', '--quiet', '--allow-empty', '-m', message);
  await git(remote, 'init', '--quiet', '--initial-branch=main');
  await commit(remote, 'one');
  const directory = path.join(parent, 'clone');
  await git(parent, 'clone', '--quiet', remote, directory);
  await commit(directory, 'mine');
  await commit(remote, 'theirs');
  await git(directory, 'fetch', '--quiet');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const asked = await app.send('code', { type: 'commit.GET_ALL_BRANCHES' }, asWindow);
  const { data } = await app.nextEmit('code', 'commit.BRANCHES_RECEIVED', { answering: asked });

  expect((data as { standing: unknown }).standing).toEqual({ main: { upstream: 'origin/main', ahead: 1, behind: 1 } });
});
