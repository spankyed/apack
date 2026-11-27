// A window's view of the GitHub sign-in: the code of the sign-in it started, how that ended, and the account every
// window is told. A sign-in is under way for as long as the window is `signingIn`: starting another, cancelling, or
// any window's sign-in ending it stops waiting on the one before.
import { afterEach, expect, it, vi } from 'vitest';
import { githubState } from '#features/code/fe/features/github/state.ts';
import { startMachine } from '../../_support/asks.ts';

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

/** A window that has started a sign-in */
const started = () => {
  const h = startMachine(githubState);
  running.push(h);
  h.send({ type: 'github.SIGN_IN' });
  return { h, signIn: h.latestAsk('github.SIGN_IN') };
};
const signingIn = (h: ReturnType<typeof started>['h']) => h.read().at === 'signingIn';
const code = { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: 1 };
const octocat = { login: 'octocat' };

it('shows the code of the sign-in it asked for last, and stops waiting on the one before', async () => {
  const { h, signIn: first } = started();
  h.send({ type: 'github.SIGN_IN' });
  const second = h.latestAsk('github.SIGN_IN');

  expect(first.stopped, 'starting another ends the first').toBe(true);
  first.tell({ ...code, userCode: 'OLD0-0000' });
  await Promise.resolve();
  expect(h.read().data.code).toBeNull();
  expect(signingIn(h)).toBe(true);

  second.tell(code);
  await vi.waitFor(() => expect(h.read().data.code).toEqual(code));
});

it('takes the account its sign-in ends with, and shows no code after', async () => {
  const { h, signIn } = started();
  signIn.tell(code);

  await signIn.answer(octocat);

  expect(signingIn(h)).toBe(false);
  expect(h.read().data).toMatchObject({ account: octocat, code: null, failure: null });
});

it('says why a sign-in failed, but not that one was cancelled', async () => {
  const denied = started();
  denied.signIn.tell(code);
  await denied.signIn.refuse('The sign-in was refused at GitHub.', { kind: 'denied' });
  expect(signingIn(denied.h)).toBe(false);
  expect(denied.h.read().data).toMatchObject({ code: null, failure: { reason: 'denied' } });

  const cancelled = started();
  await cancelled.signIn.refuse('Signing in to GitHub was cancelled.', { kind: 'cancelled' });
  expect(cancelled.h.read().data).toMatchObject({ code: null, failure: null });

  const unconfigured = started();
  await unconfigured.signIn.refuse('Signing in to GitHub is not set up.', { kind: 'unconfigured' });
  expect(unconfigured.h.read().data, 'nor one GitHub gave no code for').toMatchObject({ code: null, failure: { reason: 'unconfigured' } });

  const unreachable = started();
  await unreachable.signIn.refuse('GitHub could not be reached.');
  expect(unreachable.h.read().data.failure).toEqual({ reason: 'failed', message: 'GitHub could not be reached.' });
});

it('ends the sign-in on the backend when it is cancelled, and shows nothing of it', () => {
  const { h, signIn } = started();
  signIn.tell(code);

  h.send({ type: 'github.CANCEL_SIGN_IN' });

  expect(signIn.stopped).toBe(true);
  expect(signingIn(h)).toBe(false);
  expect(h.read().data).toMatchObject({ code: null, failure: null });
});

it('takes the account any window signed in as, ending the sign-in it shows', () => {
  const { h, signIn } = started();
  signIn.tell(code);

  h.send({ type: 'github.ACCOUNT_CHANGED', account: octocat });

  expect(signIn.stopped).toBe(true);
  expect(signingIn(h)).toBe(false);
  expect(h.read().data).toMatchObject({ account: octocat, code: null, failure: null });
});

it('reads who the app is signed in as when a view of it asks', async () => {
  const h = startMachine(githubState);
  running.push(h);
  expect(h.read().data.account, 'not known until the backend has said').toBeUndefined();

  h.send({ type: 'github.GET_ACCOUNT' });
  await h.latestAsk('github.GET_ACCOUNT').answer(null);

  expect(h.read().data.account).toBeNull();
});

it("copies its sign-in's code and opens GitHub's page for it in the system browser, and nothing for another's", async () => {
  const writeText = vi.fn(async () => true);
  const openExternal = vi.fn(async () => {});
  vi.stubGlobal('window', { electronAPI: { clipboard: { writeText }, shell: { openExternal } } });
  try {
    const { h, signIn: first } = started();
    h.send({ type: 'github.SIGN_IN' });

    first.tell({ ...code, userCode: 'OLD0-0000' });
    await Promise.resolve();
    expect(writeText, 'a code from a sign-in this window has moved on from').not.toHaveBeenCalled();

    h.asksOf('github.SIGN_IN')[1]!.tell(code);
    await vi.waitFor(() => expect(writeText.mock.calls).toEqual([['ABCD-1234']]));
    expect(openExternal.mock.calls).toEqual([['https://github.com/login/device']]);
  } finally {
    vi.unstubAllGlobals();
  }
});
