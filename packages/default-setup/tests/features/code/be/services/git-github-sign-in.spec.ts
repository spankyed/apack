// Git signs in to GitHub with the app's sign-in, given on the command and never written to a config: a push to a
// remote over smart HTTP that takes only a token succeeds with the app's and is refused without it, a user whose
// own git answers for that host keeps their sign-in, and no git config file changes. Each push runs with the
// environment the app hands git (`withGitHubSignIn`), over a home of its own, so nothing of this machine's git
// configuration — or its credential store — is asked or written.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { withGitHubSignIn } from '#features/code/be/services/app-git-repository.ts';
import { startSmartHttpRemote } from '../_support/smart-http-remote.ts';

const dirs: string[] = [];
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const APP_TOKEN = 'gho_app';
const USER_TOKEN = 'ghp_user';

/** A checkout with one commit, a home of its own and the remote as `origin`; the environment git runs with there */
async function checkoutPushingTo(url: string) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-sign-in-home-')));
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-sign-in-')));
  dirs.push(home, directory);
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    ...(process.platform === 'win32' && { SystemRoot: process.env.SystemRoot, USERPROFILE: home }),
  };
  const git = (env: NodeJS.ProcessEnv, ...args: string[]) =>
    execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: directory, env });
  await git(environment, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(environment, 'add', '.');
  await git(environment, 'commit', '--quiet', '-m', 'first');
  await git(environment, 'remote', 'add', 'origin', url);
  /** Every git config file there is, as it reads now */
  const configs = () => [path.join(directory, '.git', 'config'), path.join(home, '.gitconfig'), path.join(home, 'git', 'config')]
    .map(file => [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null]);
  return { directory, environment, git, configs };
}

it("pushes with the app's token, given on the command, and is refused without it", async () => {
  const remote = await startSmartHttpRemote({ tokens: [APP_TOKEN] });
  stops.push(remote.close);
  const { environment, git, configs } = await checkoutPushingTo(remote.url);
  const before = configs();

  const refused = await git(withGitHubSignIn(environment, undefined, remote.web), 'push', '--quiet', 'origin', 'main').then(() => 'pushed', () => 'refused');
  expect(refused, 'no sign-in, no push').toBe('refused');

  await git(withGitHubSignIn(environment, APP_TOKEN, remote.web), 'push', '--quiet', 'origin', 'main');
  // A push is two requests, the refs and then the pack, and each signs in
  expect(new Set(remote.signIns.map(signIn => JSON.stringify(signIn)))).toEqual(new Set([JSON.stringify({ username: 'x-access-token', password: APP_TOKEN })]));
  expect(configs(), 'no git config file changed').toEqual(before);
});

it("keeps the user's own sign-in where their git answers for the host, and what their environment already names", async () => {
  const remote = await startSmartHttpRemote({ tokens: [APP_TOKEN, USER_TOKEN] });
  stops.push(remote.close);
  const { environment, git } = await checkoutPushingTo(remote.url);
  // The user's own helper, in their repository's config as a credential helper would be
  await git(environment, 'config', 'credential.helper', `!f() { test "$1" = get && echo username=me && echo password=${USER_TOKEN}; }; f`);
  const theirs = { ...environment, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'push.default', GIT_CONFIG_VALUE_0: 'current' };

  const given = withGitHubSignIn(theirs, APP_TOKEN, remote.web);
  expect(given).toMatchObject({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'push.default', GIT_CONFIG_VALUE_0: 'current', GIT_CONFIG_KEY_1: `credential.${remote.web}.helper` });
  await git(given, 'push', '--quiet', 'origin', 'main');

  expect(new Set(remote.signIns.map(signIn => JSON.stringify(signIn))), "the user's helper is asked first, and answers").toEqual(new Set([JSON.stringify({ username: 'me', password: USER_TOKEN })]));
});
