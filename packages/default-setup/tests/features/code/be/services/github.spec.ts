// Signing in to GitHub with the device flow, against a stand-in for GitHub's endpoints on this machine: the code
// GitHub gives, the asks for the token at the interval GitHub sets, and each way the asking ends. The wait between
// asks is recorded rather than slept, so what is asserted is the interval asked for, not how long a run took.
import { afterEach, expect, it } from 'vitest';
import { createGitHubSignIn, GitHubSignInError, GITHUB_SCOPES, type Wait } from '#features/code/be/services/github.ts';
import { startGitHubStandIn, STAND_IN_TOKEN, type TokenAnswer } from '../_support/github-stand-in.ts';

const stops: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });

/** A sign-in over a stand-in answering `tokenAnswers`, whose waits are recorded and pass at once */
async function signIn(tokenAnswers: TokenAnswer[], { clock = () => 0, expiresIn }: { clock?: () => number; expiresIn?: number } = {}) {
  const standIn = await startGitHubStandIn({ tokenAnswers, ...(expiresIn !== undefined && { expiresIn }) });
  stops.push(standIn.close);
  const waits: number[] = [];
  const wait: Wait = async (ms, signal) => { waits.push(ms); signal.throwIfAborted(); };
  return { ...standIn, waits, github: createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1', wait, now: clock }) };
}

const reasonOf = (promise: Promise<unknown>) => promise.then(
  () => 'resolved',
  (error: unknown) => error instanceof GitHubSignInError ? error.reason : `not a sign-in failure: ${String(error)}`,
);

it('gives the code to show, asks at the interval GitHub set until approved, and says whose account it is', async () => {
  const { github, waits, requests } = await signIn([{ error: 'authorization_pending' }, { access_token: STAND_IN_TOKEN, scope: 'repo,workflow' }]);
  const signal = new AbortController().signal;

  const code = await github.fetchDeviceCode(signal);
  expect(code).toMatchObject({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', intervalMs: 5000, expiresAt: 900_000 });
  expect(requests[0]).toMatchObject({ path: '/login/device/code', fields: { client_id: 'client-1', scope: GITHUB_SCOPES.join(' ') } });

  expect(await github.pollForToken(code, signal)).toEqual({ token: STAND_IN_TOKEN, scopes: ['repo', 'workflow'] });
  expect(waits, 'one wait before each ask').toEqual([5000, 5000]);
  expect(requests.filter(request => request.path === '/login/oauth/access_token').map(request => request.fields)).toEqual([
    { client_id: 'client-1', device_code: 'device-1', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
    { client_id: 'client-1', device_code: 'device-1', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
  ]);

  expect(await github.fetchAccount(STAND_IN_TOKEN, signal)).toEqual({ login: 'octocat', name: 'The Octocat', avatarUrl: 'https://avatars.example/octocat' });
  expect(requests.at(-1)?.authorization).toBe(`Bearer ${STAND_IN_TOKEN}`);
});

it('asks further apart when GitHub says slow down: by the interval it names, or five seconds more', async () => {
  const { github, waits } = await signIn([
    { error: 'slow_down', interval: 10 },
    { error: 'slow_down' },
    { error: 'authorization_pending' },
    { access_token: STAND_IN_TOKEN, scope: 'repo' },
  ]);
  const signal = new AbortController().signal;

  await github.pollForToken(await github.fetchDeviceCode(signal), signal);

  expect(waits).toEqual([5000, 10_000, 15_000, 15_000]);
});

it('ends as expired when GitHub says the code expired, and when the code has expired before an ask', async () => {
  const signal = new AbortController().signal;
  const told = await signIn([{ error: 'authorization_pending' }, { error: 'expired_token' }]);
  expect(await reasonOf(told.github.pollForToken(await told.github.fetchDeviceCode(signal), signal))).toBe('expired');

  let time = 0;
  const lapsed = await signIn([{ error: 'authorization_pending' }], { clock: () => time, expiresIn: 10 });
  const code = await lapsed.github.fetchDeviceCode(signal);
  time = 10_000;
  expect(await reasonOf(lapsed.github.pollForToken(code, signal))).toBe('expired');
  expect(lapsed.requests.filter(request => request.path === '/login/oauth/access_token'), 'GitHub is not asked about an expired code').toEqual([]);
});

it('ends as denied when the user refused it at GitHub, and as failed on an answer it does not know', async () => {
  const signal = new AbortController().signal;
  const denied = await signIn([{ error: 'access_denied' }]);
  expect(await reasonOf(denied.github.pollForToken(await denied.github.fetchDeviceCode(signal), signal))).toBe('denied');
  const unknown = await signIn([{ error: 'unsupported_grant_type' }]);
  expect(await reasonOf(unknown.github.pollForToken(await unknown.github.fetchDeviceCode(signal), signal))).toBe('failed');
});

it('ends as cancelled when the asker aborts while it waits', async () => {
  const { github } = await signIn([{ error: 'authorization_pending' }]);
  const controller = new AbortController();
  const code = await github.fetchDeviceCode(controller.signal);
  controller.abort();
  expect(await reasonOf(github.pollForToken(code, controller.signal))).toBe('cancelled');
});

it('asks GitHub nothing without an OAuth App to sign in as', async () => {
  const { endpoints, requests } = await signIn([]);
  const github = createGitHubSignIn({ endpoints, clientId: '', wait: async () => {} });
  expect(await reasonOf(github.fetchDeviceCode(new AbortController().signal))).toBe('unconfigured');
  expect(requests).toEqual([]);
});
