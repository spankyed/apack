// The pull request panel's asks, driven through the code system as a window drives them, over a real checkout whose
// remote is on github.com and a stand-in for GitHub's API on this machine: whether the app's sign-in can work with
// the repository, and a pull request read and opened with it.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness';
import { services } from '#generated/services.ts';
import { createGitHubSignIn } from '#features/code/be/services/github.ts';
import { pullRequestNode, startGitHubApiStandIn, type StandInRoutes } from './_support/github-api-stand-in.ts';

const CODE = 'default-setup/code';
const asWindow = { sender: CODE, client: 'c-main' };
const dirs: string[] = [];
const stops: Array<() => Promise<void>> = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  for (const stop of stops.splice(0)) await stop();
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });

/** A checkout on `feature/thing` whose remote is `remote`, the code system over it, and GitHub's API answering `routes` */
async function codeOver(remote: string, routes: StandInRoutes, { signedIn = true } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-github-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  await git(directory, 'checkout', '--quiet', '-b', 'feature/thing');
  await git(directory, 'remote', 'add', 'origin', remote);
  const standIn = await startGitHubApiStandIn(routes);
  stops.push(standIn.close);
  mockService('github', createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1' }));
  if (signedIn) services.secrets.own.set('github', JSON.stringify({ token: 'gho_token', scopes: ['repo', 'workflow'], account: { login: 'octocat' } }));
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return { app, requests: standIn.requests };
}

const access = async (running: NonNullable<typeof app>) =>
  (await running.nextEmit('code', 'pr.GITHUB_ACCESS_CHECKED', { answering: await running.send('code', { type: 'pr.CHECK_GITHUB_ACCESS' }, asWindow) })).data;

const repositoryAnswer = { body: { data: { repository: { pullRequests: { totalCount: 1 } } } } };

it('says whether the sign-in can work with the repository: signed out, a remote elsewhere, or yes', async () => {
  const signedOut = await codeOver('https://github.com/octo/repo.git', { graphql: [['pullRequests(first: 0)', repositoryAnswer]] }, { signedIn: false });
  expect(await access(signedOut.app)).toMatchObject({ access: 'signed-out' });
  expect(signedOut.requests, 'GitHub is not asked without a sign-in').toEqual([]);
  await signedOut.app.stop();
  app = undefined;

  const elsewhere = await codeOver('https://gitlab.com/octo/repo.git', {});
  expect(await access(elsewhere.app)).toMatchObject({ access: 'not-github' });
  await elsewhere.app.stop();
  app = undefined;

  const ready = await codeOver('git@github.com:octo/repo.git', { graphql: [['pullRequests(first: 0)', repositoryAnswer]] });
  expect(await access(ready.app)).toEqual({ access: 'ok' });
  expect(ready.requests[0]).toMatchObject({ authorization: 'Bearer gho_token', body: { variables: { owner: 'octo', name: 'repo' } } });
});

it("opens a pull request from the checkout's branch, and reads one's details with its comments", async () => {
  const { app: running, requests } = await codeOver('https://github.com/octo/repo.git', {
    rest: { 'POST /repos/octo/repo/pulls': { status: 201, body: { number: 7 } } },
    graphql: [
      ['defaultBranchRef', { body: { data: { repository: { defaultBranchRef: { name: 'main' } } } } }],
      ['pullRequest(', { body: { data: { repository: { pullRequest: pullRequestNode() } } } }],
    ],
  });

  const created = await running.nextEmit('code', 'pr.PR_CREATED', { answering: await running.send('code', { type: 'pr.CREATE_PR', title: 'Add the thing', body: 'It adds the thing.' }, asWindow) });
  expect(created.data).toMatchObject({ pr: { number: 7, headRefName: 'feature/thing' } });
  expect(requests.find(request => request.path === '/repos/octo/repo/pulls')?.body).toMatchObject({ head: 'feature/thing', base: 'main' });

  const details = await running.nextEmit('code', 'pr.PR_DETAILS_RECEIVED', { answering: await running.send('code', { type: 'pr.SELECT_PR', number: 7 }, asWindow) });
  expect(details.data).toMatchObject({ pr: { number: 7, mergeable: 'MERGEABLE' }, comments: [{ body: 'Looks good', author: { login: 'hubot' } }] });
});
