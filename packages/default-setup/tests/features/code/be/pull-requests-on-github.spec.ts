// The pull request panel's asks, driven through the code system as a window drives them, over a real checkout whose
// remote is on GitHub and a stand-in for GitHub on this machine, which the app is pointed at as it is at github.com:
// whether the app's sign-in can work with the repository, a pull request read and opened with it, its branch
// deleted, and what is said when GitHub refuses.
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

/** The stand-in's address for `owner/name`, as a remote names a repository on github.com */
const onStandIn = (path = 'octo/repo.git') => (web: string) => `${web}/${path}`;

/**
 * A checkout on `feature/thing` whose remote is `remote` (given GitHub's address), the code system over it, and
 * GitHub's API answering `routes`; `prepare` shapes the checkout before the system opens it
 */
async function codeOver(remote: (web: string) => string, routes: StandInRoutes, { signedIn = true, prepare }: { signedIn?: boolean; prepare?: (directory: string) => Promise<unknown> } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-github-')));
  dirs.push(directory);
  const standIn = await startGitHubApiStandIn(routes);
  stops.push(standIn.close);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  await git(directory, 'checkout', '--quiet', '-b', 'feature/thing');
  await git(directory, 'remote', 'add', 'origin', remote(standIn.endpoints.web));
  await prepare?.(directory);
  mockService('github', createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1' }));
  if (signedIn) services.secrets.own.set('github', JSON.stringify({ token: 'gho_token', scopes: ['repo', 'workflow'], account: { login: 'octocat' } }));
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return { app, requests: standIn.requests, web: standIn.endpoints.web, directory };
}

/** The answer to one ask of a window's, of the type it is answered with */
const ask = async (running: NonNullable<typeof app>, event: { type: string; [key: string]: unknown }, answeredWith: string): Promise<Record<string, any>> =>
  running.nextEmit('code', answeredWith, { answering: await running.send('code', event, asWindow) });

const access = async (running: NonNullable<typeof app>) =>
  (await running.nextEmit('code', 'pr.GITHUB_ACCESS_CHECKED', { answering: await running.send('code', { type: 'pr.CHECK_GITHUB_ACCESS' }, asWindow) })).data;

const repositoryAnswer = { body: { data: { repository: { pullRequests: { totalCount: 1 } } } } };

it('says whether the sign-in can work with the repository: signed out, a remote elsewhere, or yes', async () => {
  const signedOut = await codeOver(onStandIn(), { graphql: [['pullRequests(first: 0)', repositoryAnswer]] }, { signedIn: false });
  expect(await access(signedOut.app)).toMatchObject({ access: 'signed-out' });
  expect(signedOut.requests, 'GitHub is not asked without a sign-in').toEqual([]);
  await signedOut.app.stop();
  app = undefined;

  const elsewhere = await codeOver(() => 'https://gitlab.com/octo/repo.git', {});
  expect(await access(elsewhere.app)).toMatchObject({ access: 'not-github' });
  await elsewhere.app.stop();
  app = undefined;

  const ready = await codeOver(web => `git@${new URL(web).hostname}:octo/repo.git`, { graphql: [['pullRequests(first: 0)', repositoryAnswer]] });
  expect(await access(ready.app)).toEqual({ access: 'ok' });
  expect(ready.requests[0]).toMatchObject({ authorization: 'Bearer gho_token', body: { variables: { owner: 'octo', name: 'repo' } } });
});

it("opens a pull request from the checkout's branch, and reads one's details with its comments", async () => {
  const { app: running, requests } = await codeOver(onStandIn(), {
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

it('says why the pull requests could not be read, rather than that there are none', async () => {
  const signedOut = await codeOver(onStandIn(), {}, { signedIn: false });
  expect(await ask(signedOut.app, { type: 'pr.LIST_OPEN_PRS' }, 'pr.ERROR')).toMatchObject({ reason: 'signed-out' });
  expect(await ask(signedOut.app, { type: 'pr.CHECK_BRANCH_PR' }, 'pr.ERROR')).toMatchObject({ reason: 'signed-out' });
  await signedOut.app.stop();
  app = undefined;

  const refused = await codeOver(onStandIn(), { graphql: [['pullRequests(', { status: 502, body: { message: 'Server Error' } }]] });
  expect(await ask(refused.app, { type: 'pr.LIST_OPEN_PRS' }, 'pr.ERROR')).toMatchObject({ reason: 'failed', message: expect.stringContaining('Server Error') });
  expect(await ask(refused.app, { type: 'pr.CHECK_BRANCH_PR' }, 'pr.ERROR')).toMatchObject({ reason: 'failed' });
});

it('opens no pull request from a detached HEAD, and opens one from a branch under the name it has on the remote', async () => {
  const created = { status: 201, body: { number: 7 } };
  const settled = { body: { data: { repository: { pullRequest: pullRequestNode() } } } };
  const detached = await codeOver(onStandIn(), { rest: { 'POST /repos/octo/repo/pulls': created } }, { prepare: directory => git(directory, 'checkout', '--quiet', '--detach') });
  expect(await ask(detached.app, { type: 'pr.CREATE_PR', title: 'Add the thing', body: '' }, 'pr.ERROR')).toMatchObject({ message: expect.stringContaining('detached HEAD') });
  expect((await ask(detached.app, { type: 'pr.CHECK_BRANCH_PR' }, 'pr.BRANCH_PR_CHECKED')).data).toEqual({ pr: null });
  expect(detached.requests, 'GitHub is asked nothing of a branch named HEAD').toEqual([]);
  await detached.app.stop();
  app = undefined;

  // The local branch `thing` follows `feature/thing` on the remote, which is the head GitHub knows
  const renamed = await codeOver(onStandIn(), {
    rest: { 'POST /repos/octo/repo/pulls': created },
    graphql: [['defaultBranchRef', { body: { data: { repository: { defaultBranchRef: { name: 'main' } } } } }], ['pullRequest(', settled]],
  }, { prepare: async directory => {
    await git(directory, 'branch', '--quiet', '-m', 'thing');
    await git(directory, 'update-ref', 'refs/remotes/origin/feature/thing', 'HEAD');
    await git(directory, 'branch', '--quiet', '--set-upstream-to=origin/feature/thing');
  } });
  await ask(renamed.app, { type: 'pr.CREATE_PR', title: 'Add the thing', body: '' }, 'pr.PR_CREATED');
  expect(renamed.requests.find(request => request.path === '/repos/octo/repo/pulls')?.body).toMatchObject({ head: 'feature/thing' });
});

it('carries the description and each comment as written beside them as shown, with their images loadable', async () => {
  const asset = '/user-attachments/assets/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab';
  let web = '';
  const written = () => `![shot](${web}${asset})`;
  const node = () => pullRequestNode({ body: written(), comments: { nodes: [{ id: 'IC_1', body: written(), author: { login: 'hubot' }, createdAt: '', url: 'u#issuecomment-1', viewerDidAuthor: false }] } });
  const running = await codeOver(onStandIn(), {
    rest: { [`HEAD ${asset}`]: { status: 302, headers: { Location: 'https://objects.example/signed' } } },
    graphql: [['pullRequest(', () => ({ body: { data: { repository: { pullRequest: node() } } } })]],
  });
  web = running.web;
  const shown = '![shot](https://objects.example/signed)';

  const details = (await ask(running.app, { type: 'pr.SELECT_PR', number: 7 }, 'pr.PR_DETAILS_RECEIVED')).data;
  expect(details.pr).toMatchObject({ body: shown, rawBody: written() });
  expect(details.comments[0]).toMatchObject({ body: shown, rawBody: written() });
  expect((await ask(running.app, { type: 'pr.GET_COMMENTS', number: 7 }, 'pr.COMMENTS_RECEIVED')).data.comments[0]).toMatchObject({ body: shown, rawBody: written() });
});

it("deletes a pull request's branch through GitHub only where it is this repository's and no other open pull request is from it", async () => {
  let head = { headRefName: 'feature/thing', isCrossRepository: true };
  let others = [{ number: 9, isCrossRepository: false }];
  const { app: running, requests } = await codeOver(onStandIn(), {
    // Deleted already, on merge: GitHub says the reference does not exist
    rest: { 'DELETE /repos/octo/repo/git/refs/heads/feature/thing': { status: 422, body: { message: 'Reference does not exist' } } },
    graphql: [
      ['states: OPEN', () => ({ body: { data: { repository: { pullRequests: { nodes: [{ number: 7, isCrossRepository: false }, ...others] } } } } })],
      ['pullRequest(', () => ({ body: { data: { repository: { pullRequest: { id: 'PR_7', ...head } } } } })],
    ],
  });
  const deletes = () => requests.filter(request => request.method === 'DELETE');

  expect(await ask(running, { type: 'pr.DELETE_BRANCH', number: 7 }, 'pr.ERROR')).toMatchObject({ message: expect.stringContaining('fork') });
  head = { headRefName: 'feature/thing', isCrossRepository: false };
  expect(await ask(running, { type: 'pr.DELETE_BRANCH', number: 7 }, 'pr.ERROR')).toMatchObject({ message: expect.stringContaining('#9') });
  expect(deletes()).toEqual([]);

  others = [];
  expect((await ask(running, { type: 'pr.DELETE_BRANCH', number: 7 }, 'pr.BRANCH_DELETED')).data).toEqual({ branch: 'feature/thing' });
  expect(deletes().map(request => request.path)).toEqual(['/repos/octo/repo/git/refs/heads/feature/thing']);
});

it('reads the sign-in once for every git run and GitHub ask, again once the secrets change, and says it cannot once', async () => {
  const kept = new Map<string, string>();
  let reads = 0;
  let unreadable = false;
  const own = {
    get: (name: string) => {
      reads++;
      if (unreadable) throw new Error('cannot be read on this machine');
      return kept.get(name);
    },
    set: (name: string, value: string) => { kept.set(name, value); },
    delete: (name: string) => { kept.delete(name); },
  };
  // The host's secrets, as the pack is bound to them and as a test reads them
  mockService('secrets', { own, forPack: () => ({ own }) });
  const repositoryAnswer = { body: { data: { repository: { pullRequests: { totalCount: 1 } } } } };
  const { app: running } = await codeOver(onStandIn(), { graphql: [['pullRequests(first: 0)', repositoryAnswer]] });
  for (let i = 0; i < 3; i++) expect(await access(running)).toEqual({ access: 'ok' });
  await ask(running, { type: 'commit.GET_GIT_STATUS' }, 'commit.STATUS_RECEIVED');
  expect(reads, 'read once, for every git run and ask since').toBe(1);

  unreadable = true;
  await running.send('code', { type: 'SECRETS_CHANGED' });
  for (let i = 0; i < 3; i++) expect(await access(running)).toMatchObject({ access: 'signed-out' });
  expect(reads, 'read again once the secrets changed, and an unreadable one not read again each time').toBe(2);
});
