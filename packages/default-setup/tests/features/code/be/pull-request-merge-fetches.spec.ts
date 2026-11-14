// A pull request merged from the panel moves the base on GitHub, which is brought here: the checkout fetches and
// every window is told the repository changed. The remote is a real one over smart HTTP, taking the app's sign-in,
// and GitHub's API a stand-in whose merge moves that remote's base as GitHub's does; the app is pointed at both as
// it is at github.com. Git runs with a home of its own and no system configuration, so no credential store of this
// machine's is asked or written.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness';
import { services } from '#generated/services.ts';
import { createGitHubSignIn } from '#features/code/be/services/github.ts';
import { startGitHubApiStandIn } from './_support/github-api-stand-in.ts';
import { startSmartHttpRemote } from './_support/smart-http-remote.ts';

const CODE = 'default-setup/code';
const asWindow = { sender: CODE, client: 'c-main' };
const TOKEN = 'gho_token';
const dirs: string[] = [];
const stops: Array<() => Promise<void>> = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
beforeEach(() => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-merge-home-')));
  dirs.push(home);
  for (const [name, value] of Object.entries({ HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' })) vi.stubEnv(name, value);
});
afterEach(async () => {
  await app?.stop();
  app = undefined;
  for (const stop of stops.splice(0)) await stop();
  resetTestData();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout.trim();

it('fetches the base a merge moved, and tells every window the repository changed', async () => {
  const remote = await startSmartHttpRemote({ tokens: [TOKEN], repository: 'octo/repo' });
  stops.push(remote.close);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-merge-')));
  dirs.push(root);
  const author = path.join(root, 'author');
  const checkout = path.join(root, 'checkout');
  await execFileWhileWorking('git', ['init', '--quiet', '--initial-branch=main', author]);
  fs.writeFileSync(path.join(author, 'a.txt'), 'one\n');
  await git(author, 'add', '.');
  await git(author, 'commit', '--quiet', '-m', 'first');
  await git(author, 'push', '--quiet', remote.directory, 'main');
  await execFileWhileWorking('git', ['clone', '--quiet', remote.directory, checkout]);
  await git(checkout, 'remote', 'set-url', 'origin', remote.url);

  // GitHub's merge: the pull request's commit lands on main
  let merged = '';
  const api = await startGitHubApiStandIn({ rest: { 'PUT /repos/octo/repo/pulls/7/merge': async () => {
    fs.writeFileSync(path.join(author, 'b.txt'), 'two\n');
    await git(author, 'add', '.');
    await git(author, 'commit', '--quiet', '-m', 'Merge pull request #7');
    await git(author, 'push', '--quiet', remote.directory, 'main');
    merged = await git(author, 'rev-parse', 'HEAD');
    return { body: { merged: true } };
  } } });
  stops.push(api.close);
  mockService('github', createGitHubSignIn({ endpoints: { web: remote.web, api: api.endpoints.api }, clientId: 'client-1' }));
  services.secrets.own.set('github', JSON.stringify({ token: TOKEN, scopes: ['repo'], account: { login: 'octocat' } }));
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: checkout });
  await app.settle();

  await app.nextEmit('code', 'pr.PR_MERGED', { answering: await app.send('code', { type: 'pr.MERGE_PR', number: 7 }, asWindow) });

  // Each announcement is a change the windows are told of; the one that matters is the fetch's
  do await app.nextEmit('code', 'pr.GIT_STATUS_REFRESHED');
  while (await git(checkout, 'rev-parse', 'origin/main') !== merged);
  expect(remote.signIns.length, "fetched with the app's sign-in").toBeGreaterThan(0);
});
