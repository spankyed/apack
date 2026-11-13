// Signing in to GitHub as a window does it, through the code system, against a stand-in for GitHub on this machine:
// the window that asked is shown the code, the token is kept as this pack's own secret, every window is told the
// account, and signing out forgets it. That no other pack can read the secret is the host's binding, held in
// `@apackdev/host`'s secrets specs.
import { afterEach, expect, it } from 'vitest';
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness';
import { createGitHubSignIn } from '#features/code/be/services/github.ts';
import { storedSignIn } from '#features/code/be/features/github.ts';
import { startGitHubStandIn, STAND_IN_TOKEN } from './_support/github-stand-in.ts';

const CODE = 'default-setup/code';
const asWindow = { sender: CODE, client: 'c-main' };
const stops: Array<() => Promise<void>> = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  for (const stop of stops.splice(0)) await stop();
  resetTestData();
});

it('shows the asker the code, keeps the token as its own secret, tells every window the account, and forgets it on sign-out', async () => {
  const standIn = await startGitHubStandIn({ tokenAnswers: [{ error: 'authorization_pending' }, { access_token: STAND_IN_TOKEN, scope: 'repo,workflow' }] });
  stops.push(standIn.close);
  mockService('github', createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1', wait: async () => {} }));
  app = await startApp({ systems: ['code'] });
  await app.connect();

  expect((await app.nextEmit('code', 'github.ACCOUNT', { answering: await app.send('code', { type: 'github.GET_ACCOUNT' }, asWindow) })).account).toBeNull();

  const call = await app.send('code', { type: 'github.SIGN_IN' }, asWindow);
  expect(await app.nextEmit('code', 'github.SIGN_IN_CODE', { answering: call })).toMatchObject({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' });
  expect((await app.nextEmit('code', 'github.ACCOUNT_CHANGED')).account).toMatchObject({ login: 'octocat' });

  expect(storedSignIn()).toMatchObject({ token: STAND_IN_TOKEN, scopes: ['repo', 'workflow'], account: { login: 'octocat' } });
  expect((await app.nextEmit('code', 'github.ACCOUNT', { answering: await app.send('code', { type: 'github.GET_ACCOUNT' }, asWindow) })).account).toMatchObject({ login: 'octocat' });

  await app.send('code', { type: 'github.SIGN_OUT' }, asWindow);
  expect((await app.nextEmit('code', 'github.ACCOUNT_CHANGED')).account).toBeNull();
  expect(storedSignIn()).toBeNull();
});

it('tells the asker why a sign-in ended without an account, and keeps nothing', async () => {
  const standIn = await startGitHubStandIn({ tokenAnswers: [{ error: 'access_denied' }] });
  stops.push(standIn.close);
  mockService('github', createGitHubSignIn({ endpoints: standIn.endpoints, clientId: 'client-1', wait: async () => {} }));
  app = await startApp({ systems: ['code'] });
  await app.connect();

  const call = await app.send('code', { type: 'github.SIGN_IN' }, asWindow);

  expect(await app.nextEmit('code', 'github.SIGN_IN_FAILED', { answering: call })).toMatchObject({ reason: 'denied' });
  expect(storedSignIn()).toBeNull();
});
