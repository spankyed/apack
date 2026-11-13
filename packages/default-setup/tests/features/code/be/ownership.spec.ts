// Git will not read a repository another user owns. The window is told that is why, with the path git named, and
// trusting it adds the path to the user's safe.directory, after which the repository reads as any other. Git's own
// switch for its tests stands in for another owner; the repository and git are real, driven as a window drives them.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';

const CODE = 'default-setup/code';
const dirs: string[] = [];
const before = { owner: process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER, global: process.env.GIT_CONFIG_GLOBAL };
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const [name, value] of [['GIT_TEST_ASSUME_DIFFERENT_OWNER', before.owner], ['GIT_CONFIG_GLOBAL', before.global]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });
const asWindow = { sender: CODE, client: 'c-main' };

/** The code system over a repository git takes to be another user's, with a global configuration of its own */
async function codeOverARepositoryAnotherUserOwns() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-ownership-')));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-ownership-home-')));
  dirs.push(directory, home);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'two\n');
  const global = path.join(home, '.gitconfig');
  fs.writeFileSync(global, '');
  Object.assign(process.env, { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_GLOBAL: global });
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return { directory, global };
}
const askForStatus = () => app!.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);

it('tells the window git will not read the repository for who owns it, naming it as git does', async () => {
  const { directory } = await codeOverARepositoryAnotherUserOwns();

  const asked = await askForStatus();

  const { data } = await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: asked });
  expect(data).toMatchObject({ code: 'unsafe-ownership' });
  expect(path.resolve((data as { ownership: { directory: string } }).ownership.directory)).toBe(directory);
});

it('reads the repository once the window trusts it, having written only the user\'s safe.directory', async () => {
  const { directory, global } = await codeOverARepositoryAnotherUserOwns();
  await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: await askForStatus() });

  const trusted = await app!.send('code', { type: 'commit.TRUST_OWNERSHIP' }, asWindow);
  await app!.nextEmit('code', 'commit.OWNERSHIP_TRUSTED', { answering: trusted });

  const status = (await app!.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: await askForStatus() })).data as { files: { path: string }[] };
  expect(status.files.map(file => file.path)).toEqual(['a.txt']);
  expect(fs.readFileSync(global, 'utf8')).toContain('[safe]');
  expect(fs.readFileSync(path.join(directory, '.git', 'config'), 'utf8')).not.toContain('safe');
});

it('writes nothing for a repository git already reads', async () => {
  const { global } = await codeOverARepositoryAnotherUserOwns();
  delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;

  const trusted = await app!.send('code', { type: 'commit.TRUST_OWNERSHIP' }, asWindow);

  expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: trusted })).data).toMatchObject({ message: 'Git already reads this repository' });
  expect(fs.readFileSync(global, 'utf8')).toBe('');
});
