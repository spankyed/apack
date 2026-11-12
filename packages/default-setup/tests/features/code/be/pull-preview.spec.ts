// What a pull would do, before the click: the status of a branch behind its upstream says it, here the files a merge
// would stop on. Driven through the code system as a window drives it, over a real clone.
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
const gitVersion = async () => (/(\d+)\.(\d+)/.exec(await git(os.tmpdir(), '--version')) ?? []).slice(1).map(Number);

it('says before a pull that it would conflict, naming the files', async () => {
  const [major = 0, minor = 0] = await gitVersion();
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-preview-remote-')));
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-preview-')));
  dirs.push(remote, parent);
  const commit = async (cwd: string, content: string) => {
    fs.writeFileSync(path.join(cwd, 'a.txt'), content);
    await git(cwd, 'add', '.');
    await git(cwd, 'commit', '--quiet', '-m', content.trim());
  };
  await git(remote, 'init', '--quiet', '--initial-branch=main');
  await commit(remote, 'one\n');
  const directory = path.join(parent, 'clone');
  await git(parent, 'clone', '--quiet', remote, directory);
  await commit(directory, 'mine\n');
  await commit(remote, 'theirs\n');
  await git(directory, 'fetch', '--quiet');
  const head = await git(directory, 'rev-parse', 'HEAD');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const asked = await app.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  const { data } = await app.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: asked });

  // A git without merge-tree --write-tree (before 2.38) cannot say
  expect((data as { pullPreview: unknown }).pullPreview).toEqual(major > 2 || (major === 2 && minor >= 38) ? { kind: 'conflicts', files: ['a.txt'] } : { kind: 'unknown' });
  expect(await git(directory, 'rev-parse', 'HEAD'), 'and nothing moved').toBe(head);
});
