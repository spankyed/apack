// GitHub's API as the pull request panel calls it, against a stand-in for GitHub on this machine: what a remote's
// address names, the shapes the panel takes from GitHub's answers, what each action sends where, and each refusal
// as the reason the panel acts on.
import { afterEach, expect, it } from 'vitest';
import { createGitHubApi, GitHubApiError, repoOfRemote, type Pause } from '#features/code/be/services/github-api.ts';
import { pullRequestNode, startGitHubApiStandIn, type StandInRoutes } from '../_support/github-api-stand-in.ts';

const stops: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });

const REPO = { owner: 'octo', name: 'repo' };

async function api(routes: StandInRoutes) {
  const standIn = await startGitHubApiStandIn(routes);
  stops.push(standIn.close);
  const pauses: number[] = [];
  const pause: Pause = async (ms) => { pauses.push(ms); };
  return { ...standIn, pauses, gh: createGitHubApi({ endpoints: standIn.endpoints, token: 'gho_token', repo: REPO, pause }) };
}

const reasonOf = (promise: Promise<unknown>) => promise.then(
  () => 'resolved',
  (error: unknown) => error instanceof GitHubApiError ? error.reason : `not an API failure: ${String(error)}`,
);

it("names the repository a github.com remote's address holds, and nothing for another host or a path", () => {
  expect(repoOfRemote('https://github.com/octo/repo.git')).toEqual(REPO);
  expect(repoOfRemote('https://github.com/octo/repo')).toEqual(REPO);
  expect(repoOfRemote('git@github.com:octo/repo.git')).toEqual(REPO);
  expect(repoOfRemote('ssh://git@github.com/octo/repo.git')).toEqual(REPO);
  expect(repoOfRemote('https://user@github.com/octo/my.repo.git')).toEqual({ owner: 'octo', name: 'my.repo' });
  expect(repoOfRemote('https://gitlab.com/octo/repo.git')).toBeUndefined();
  expect(repoOfRemote('/srv/git/repo.git')).toBeUndefined();
});

it("reads a pull request's details in the shape the panel takes: checks, commits and comments flattened", async () => {
  const { gh, requests } = await api({ graphql: [['pullRequest(', { body: { data: { repository: { pullRequest: pullRequestNode() } } } }]] });

  const details = await gh.getPRDetails(7);

  expect(details).toMatchObject({
    number: 7, title: 'Add the thing', headRefName: 'feature/thing', state: 'OPEN', author: { login: 'octocat' },
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
    statusCheckRollup: [
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'ci/legacy', state: 'PENDING' },
    ],
    commits: [{ oid: 'abc123', messageHeadline: 'Add the thing', committedDate: '2026-11-13T09:00:00Z' }],
    comments: [{ id: 'IC_kwDOAbc', body: 'Looks good', author: { login: 'hubot' }, url: 'https://github.com/octo/repo/pull/7#issuecomment-1001', viewerDidAuthor: false }],
  });
  expect(details).not.toHaveProperty('checks');
  expect(details).not.toHaveProperty('commitList');
  expect(requests[0]).toMatchObject({ path: '/graphql', authorization: 'Bearer gho_token', body: { variables: { owner: 'octo', name: 'repo', number: 7 } } });
});

it("lists the open pull requests, and finds a branch's with an open one first", async () => {
  const { gh } = await api({ graphql: [
    ['headRefName: $branch', { body: { data: { repository: { pullRequests: { nodes: [
      pullRequestNode({ number: 5, state: 'CLOSED' }), pullRequestNode({ number: 6, state: 'OPEN' }),
    ] } } } } }],
    ['states: OPEN', { body: { data: { repository: { pullRequests: { nodes: [pullRequestNode()] } } } } }],
  ] });

  expect((await gh.listOpenPRs()).map(pr => pr.number)).toEqual([7]);
  expect((await gh.findPRForBranch('feature/thing'))?.number).toBe(6);
});

it("asks again while GitHub is still working out whether a new pull request can merge, onto the repository's default branch", async () => {
  let looks = 0;
  const { gh, requests, pauses } = await api({
    rest: { 'POST /repos/octo/repo/pulls': { status: 201, body: { number: 7 } } },
    graphql: [
      ['defaultBranchRef', { body: { data: { repository: { defaultBranchRef: { name: 'trunk' } } } } }],
      ['pullRequest(', () => ({ body: { data: { repository: { pullRequest: pullRequestNode(++looks < 3 ? { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' } : {}) } } } })],
    ],
  });

  const created = await gh.createPR({ title: 'Add the thing', body: 'It adds the thing.', head: 'feature/thing' });

  expect(requests.find(request => request.path === '/repos/octo/repo/pulls')?.body).toEqual({ title: 'Add the thing', body: 'It adds the thing.', head: 'feature/thing', base: 'trunk', draft: false });
  expect(pauses).toEqual([2000, 4000]);
  expect(created).toMatchObject({ number: 7, mergeable: 'MERGEABLE' });
});

it('sends each change where GitHub takes it', async () => {
  const { gh, requests } = await api({
    rest: {
      'PUT /repos/octo/repo/pulls/7/merge': { body: { merged: true } },
      'PATCH /repos/octo/repo/pulls/7': { body: {} },
      'POST /repos/octo/repo/issues/7/comments': { status: 201, body: {} },
      'PATCH /repos/octo/repo/issues/comments/1001': { body: {} },
      'DELETE /repos/octo/repo/issues/comments/1001': { status: 204 },
      'POST /repos/octo/repo/pulls/7/comments/2002/replies': { status: 201, body: {} },
      'PATCH /repos/octo/repo/pulls/comments/2002': { body: {} },
      'DELETE /repos/octo/repo/pulls/comments/2002': { status: 204 },
    },
    graphql: [
      ['convertPullRequestToDraft', { body: { data: {} } }],
      ['markPullRequestReadyForReview', { body: { data: {} } }],
      ['unresolveReviewThread', { body: { data: {} } }],
      ['resolveReviewThread', { body: { data: {} } }],
      ['pullRequest(', { body: { data: { repository: { pullRequest: { id: 'PR_kwDOAbc123', number: 7 } } } } }],
    ],
  });

  await gh.mergePR(7, 'squash');
  await gh.closePR(7);
  await gh.updatePR(7, { title: 'Retitled', base: 'trunk' });
  await gh.createPRComment(7, 'A comment');
  await gh.editPRComment(1001, 'Edited');
  await gh.deletePRComment(1001);
  await gh.replyToReviewThread(7, 2002, 'A reply');
  await gh.editReviewComment(2002, 'Edited review');
  await gh.deleteReviewComment(2002);
  await gh.markDraft(7);
  await gh.markReady(7);
  await gh.resolveReviewThread('PRRT_1');
  await gh.unresolveReviewThread('PRRT_1');

  expect(requests.filter(request => request.path !== '/graphql').map(({ method, path, body }) => [method, path, body])).toEqual([
    ['PUT', '/repos/octo/repo/pulls/7/merge', { merge_method: 'squash' }],
    ['PATCH', '/repos/octo/repo/pulls/7', { state: 'closed' }],
    ['PATCH', '/repos/octo/repo/pulls/7', { title: 'Retitled', base: 'trunk' }],
    ['POST', '/repos/octo/repo/issues/7/comments', { body: 'A comment' }],
    ['PATCH', '/repos/octo/repo/issues/comments/1001', { body: 'Edited' }],
    ['DELETE', '/repos/octo/repo/issues/comments/1001', undefined],
    ['POST', '/repos/octo/repo/pulls/7/comments/2002/replies', { body: 'A reply' }],
    ['PATCH', '/repos/octo/repo/pulls/comments/2002', { body: 'Edited review' }],
    ['DELETE', '/repos/octo/repo/pulls/comments/2002', undefined],
  ]);
  const mutations = requests.filter(request => String(request.body?.query).startsWith('mutation'));
  expect(mutations.map(request => [request.body.query.match(/\{ (\w+)\(/)?.[1], request.body.variables.id])).toEqual([
    ['convertPullRequestToDraft', 'PR_kwDOAbc123'],
    ['markPullRequestReadyForReview', 'PR_kwDOAbc123'],
    ['resolveReviewThread', 'PRRT_1'],
    ['unresolveReviewThread', 'PRRT_1'],
  ]);
});

it('says why GitHub refused, as the panel acts on it', async () => {
  const refused = (answer: object) => api({ graphql: [['repository', answer]], rest: { 'PUT /repos/octo/repo/pulls/7/merge': answer } });

  expect(await reasonOf((await refused({ status: 401, body: { message: 'Bad credentials' } })).gh.checkAccess())).toBe('signed-out');
  expect(await reasonOf((await refused({ status: 403, headers: { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/octo/sso' }, body: { message: 'Resource protected by organization SAML enforcement' } })).gh.checkAccess())).toBe('sso');
  expect(await reasonOf((await refused({ body: { data: null, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'octo/repo'." }] } })).gh.checkAccess())).toBe('not-found');
  expect(await reasonOf((await refused({ body: { data: null, errors: [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes to execute this query." }] } })).gh.checkAccess())).toBe('missing-scope');
  expect(await reasonOf((await refused({ status: 403, body: { message: 'Resource not accessible by integration' } })).gh.mergePR(7))).toBe('missing-scope');
  expect(await reasonOf((await refused({ status: 405, body: { message: 'Pull Request is not mergeable' } })).gh.mergePR(7))).toBe('failed');
});

it('replaces each image a user attached with the signed address GitHub redirects it to', async () => {
  const standIn = await startGitHubApiStandIn({});
  stops.push(standIn.close);
  const asset = `${standIn.endpoints.web}/user-attachments/assets/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab`;
  const gh = createGitHubApi({ endpoints: standIn.endpoints, token: 'gho_token', repo: REPO });
  // The stand-in answers the attachment with a redirect, as GitHub does a signed-in look at one
  const routed = await startGitHubApiStandIn({ rest: { 'HEAD /user-attachments/assets/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab': { status: 302, headers: { Location: 'https://objects.example/signed?x=1' } } } });
  stops.push(routed.close);
  const viaRouted = createGitHubApi({ endpoints: routed.endpoints, token: 'gho_token', repo: REPO });
  const routedAsset = asset.replace(standIn.endpoints.web, routed.endpoints.web);

  expect(await viaRouted.resolveAssetUrls(`![shot](${routedAsset}) and again ${routedAsset}`)).toBe('![shot](https://objects.example/signed?x=1) and again https://objects.example/signed?x=1');
  expect(routed.requests.filter(request => request.method === 'HEAD')).toHaveLength(1);
  expect(await gh.resolveAssetUrls('no images here')).toBe('no images here');
});
