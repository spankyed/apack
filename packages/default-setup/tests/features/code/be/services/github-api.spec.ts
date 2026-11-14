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
  expect(repoOfRemote('http://127.0.0.1:4100/octo/repo.git', 'http://127.0.0.1:4100'), 'the GitHub the app signs in to, a stand-in here').toEqual(REPO);
  expect(repoOfRemote('https://github.com/octo/repo.git', 'http://127.0.0.1:4100')).toBeUndefined();
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

it("takes no fork's pull request from a branch of the same name for the branch's own", async () => {
  const { gh } = await api({ graphql: [
    ['states: OPEN', { body: { data: { repository: { pullRequests: { nodes: [
      { number: 8, isCrossRepository: true }, { number: 6, isCrossRepository: false },
    ] } } } } }],
    ['headRefName: $branch', { body: { data: { repository: { pullRequests: { nodes: [
      pullRequestNode({ number: 8, state: 'OPEN', isCrossRepository: true }), pullRequestNode({ number: 5, state: 'CLOSED' }),
    ] } } } } }],
  ] });

  expect((await gh.findPRForBranch('feature/thing'))?.number).toBe(5);
  expect(await gh.openPRsFromBranch('feature/thing')).toEqual([6]);
});

it("deletes a branch through GitHub, and takes one GitHub no longer has as deleted", async () => {
  let gone = false;
  const { gh, requests } = await api({ rest: {
    'DELETE /repos/octo/repo/git/refs/heads/feature/thing': () => gone
      ? { status: 422, body: { message: 'Reference does not exist', documentation_url: 'https://docs.github.com/rest/git/refs#delete-a-reference' } }
      : (gone = true, { status: 204 }),
    'DELETE /repos/octo/repo/git/refs/heads/protected': { status: 422, body: { message: 'Cannot delete this protected branch' } },
  } });

  await gh.deleteBranch('feature/thing');
  await gh.deleteBranch('feature/thing');
  expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual(['DELETE /repos/octo/repo/git/refs/heads/feature/thing', 'DELETE /repos/octo/repo/git/refs/heads/feature/thing']);
  expect(await reasonOf(gh.deleteBranch('protected'))).toBe('failed');
});

it("reads a busy pull request's discussion and threads newest first, back to the first", async () => {
  const node = (id: number) => ({ id: `IC_${id}`, body: `comment ${id}`, author: { login: 'hubot' }, createdAt: '', url: `u#issuecomment-${id}`, viewerDidAuthor: false });
  const threadNode = (id: string) => ({ id, isResolved: false, isOutdated: false, path: 'a.ts', line: 1, comments: { nodes: [] } });
  const { gh, requests } = await api({ graphql: [
    ['before: $before', request => request.body.query.includes('reviewThreads')
      ? { body: { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasPreviousPage: false }, nodes: [threadNode('T1')] } } } } } }
      : { body: { data: { repository: { pullRequest: { comments: { pageInfo: { hasPreviousPage: false }, nodes: [node(1)] } } } } } }],
    ['reviewThreads(', { body: { data: { repository: { pullRequest: { id: 'PR_1', reviewThreads: { pageInfo: { hasPreviousPage: true, startCursor: 'T' }, nodes: [threadNode('T2')] } } } } } }],
    ['pullRequest(', { body: { data: { repository: { pullRequest: pullRequestNode({
      comments: { pageInfo: { hasPreviousPage: true, startCursor: 'C' }, nodes: [node(2), node(3)] },
    }) } } } }],
  ] });

  expect((await gh.getPRDetails(7)).comments.map(comment => comment.id)).toEqual(['IC_1', 'IC_2', 'IC_3']);
  expect((await gh.getReviewThreads(7)).map(thread => thread.id)).toEqual(['T1', 'T2']);
  expect(requests[0]!.body.query).toMatch(/comments\(last: 100\)/);
  expect(requests.filter(request => request.body.variables.before).map(request => request.body.variables.before)).toEqual(['C', 'T']);
});

it('asks nothing again of a closed or merged pull request, whose merge state GitHub never works out', async () => {
  const { gh, pauses } = await api({ graphql: [['pullRequest(', { body: { data: { repository: { pullRequest: pullRequestNode({ state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }) } } } }]] });

  expect(await gh.fetchPRDetailsSettled(7)).toMatchObject({ state: 'MERGED' });
  expect(pauses).toEqual([]);
});

it("says GitHub's reasons for refusing a pull request, not only that it failed validation", async () => {
  const { gh } = await api({
    rest: { 'POST /repos/octo/repo/pulls': { status: 422, body: { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: 'A pull request already exists for octo:feature/thing.' }] } } },
    graphql: [['defaultBranchRef', { body: { data: { repository: { defaultBranchRef: { name: 'main' } } } } }]],
  });

  await expect(gh.createPR({ title: 't', body: '', head: 'feature/thing' })).rejects.toThrow('Validation Failed: A pull request already exists for octo:feature/thing.');
});

it('says when the rate limit is used up, and when GitHub takes asks again', async () => {
  const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as GitHubApiError);
  const resets = Math.floor(Date.now() / 1000) + 600;

  const primary = await failure((await api({ graphql: [['repository', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resets) }, body: { message: 'API rate limit exceeded for user ID 1.' } }]] })).gh.checkAccess());
  expect(primary).toMatchObject({ reason: 'rate-limited', resetsAt: resets * 1000 });

  const before = Date.now();
  const secondary = await failure((await api({ rest: { 'PUT /repos/octo/repo/pulls/7/merge': { status: 429, headers: { 'retry-after': '60' }, body: { message: 'You have exceeded a secondary rate limit.' } } } })).gh.mergePR(7));
  expect(secondary?.reason).toBe('rate-limited');
  expect(secondary?.resetsAt).toBeGreaterThanOrEqual(before + 60_000);

  const graphql = await failure((await api({ graphql: [['repository', { body: { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } }]] })).gh.checkAccess());
  expect(graphql?.reason).toBe('rate-limited');
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
