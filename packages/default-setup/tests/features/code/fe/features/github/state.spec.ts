// A window's view of the GitHub sign-in: the code of the sign-in it started, how that ended, and the account every
// window is told. A sign-in is under way for as long as the window is `signingIn`: starting another, cancelling, or
// any window's sign-in ending it stops waiting on the one before.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';

const tell = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell, fromAsk: (await import('../../_support/asks.ts')).fromAsk }));

import { githubState } from '#features/code/fe/features/github/state.ts';

beforeEach(() => { tell.mockReset(); resetAsks(); });

/** A window that has started a sign-in */
const started = () => {
  const actor = createActor(githubState).start();
  actor.send({ type: 'github.SIGN_IN' });
  return { actor, signIn: latestAsk('github.SIGN_IN') };
};
const signingIn = (actor: ReturnType<typeof started>['actor']) => actor.getSnapshot().matches('signingIn');
const code = { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: 1 };
const octocat = { login: 'octocat' };

it('shows the code of the sign-in it asked for last, and stops waiting on the one before', () => {
  const { actor, signIn: first } = started();
  actor.send({ type: 'github.SIGN_IN' });
  const second = latestAsk('github.SIGN_IN');

  expect(first.stopped, 'starting another ends the first').toBe(true);
  first.tell({ ...code, userCode: 'OLD0-0000' });
  expect(actor.getSnapshot().context.code).toBeNull();
  expect(signingIn(actor)).toBe(true);

  second.tell(code);
  expect(actor.getSnapshot().context.code).toEqual(code);
});

it('takes the account its sign-in ends with, and shows no code after', async () => {
  const { actor, signIn } = started();
  signIn.tell(code);

  await signIn.answer(octocat);

  expect(signingIn(actor)).toBe(false);
  expect(actor.getSnapshot().context).toMatchObject({ account: octocat, code: null, failure: null });
});

it('says why a sign-in failed, but not that one was cancelled', async () => {
  const denied = started();
  denied.signIn.tell(code);
  await denied.signIn.refuse('The sign-in was refused at GitHub.', { kind: 'denied' });
  expect(signingIn(denied.actor)).toBe(false);
  expect(denied.actor.getSnapshot().context).toMatchObject({ code: null, failure: { reason: 'denied' } });

  const cancelled = started();
  await cancelled.signIn.refuse('Signing in to GitHub was cancelled.', { kind: 'cancelled' });
  expect(cancelled.actor.getSnapshot().context).toMatchObject({ code: null, failure: null });

  const unconfigured = started();
  await unconfigured.signIn.refuse('Signing in to GitHub is not set up.', { kind: 'unconfigured' });
  expect(unconfigured.actor.getSnapshot().context, 'nor one GitHub gave no code for').toMatchObject({ code: null, failure: { reason: 'unconfigured' } });

  const unreachable = started();
  await unreachable.signIn.refuse('GitHub could not be reached.');
  expect(unreachable.actor.getSnapshot().context.failure).toEqual({ reason: 'failed', message: 'GitHub could not be reached.' });
});

it('ends the sign-in on the backend when it is cancelled, and shows nothing of it', () => {
  const { actor, signIn } = started();
  signIn.tell(code);

  actor.send({ type: 'github.CANCEL_SIGN_IN' });

  expect(signIn.stopped).toBe(true);
  expect(signingIn(actor)).toBe(false);
  expect(actor.getSnapshot().context).toMatchObject({ code: null, failure: null });
});

it('takes the account any window signed in as, ending the sign-in it shows', () => {
  const { actor, signIn } = started();
  signIn.tell(code);

  actor.send({ type: 'github.ACCOUNT_CHANGED', account: octocat });

  expect(signIn.stopped).toBe(true);
  expect(signingIn(actor)).toBe(false);
  expect(actor.getSnapshot().context).toMatchObject({ account: octocat, code: null, failure: null });
});

it('reads who the app is signed in as when a view of it asks', async () => {
  const actor = createActor(githubState).start();
  expect(actor.getSnapshot().context.account, 'not known until the backend has said').toBeUndefined();

  actor.send({ type: 'github.GET_ACCOUNT' });
  await latestAsk('github.GET_ACCOUNT').answer(null);

  expect(actor.getSnapshot().context.account).toBeNull();
});

it("copies its sign-in's code and opens GitHub's page for it in the system browser, and nothing for another's", () => {
  const writeText = vi.fn(async () => true);
  const openExternal = vi.fn(async () => {});
  vi.stubGlobal('window', { electronAPI: { clipboard: { writeText }, shell: { openExternal } } });
  try {
    const { actor, signIn: first } = started();
    actor.send({ type: 'github.SIGN_IN' });

    first.tell({ ...code, userCode: 'OLD0-0000' });
    expect(writeText, 'a code from a sign-in this window has moved on from').not.toHaveBeenCalled();

    asksOf('github.SIGN_IN')[1]!.tell(code);
    expect(writeText.mock.calls).toEqual([['ABCD-1234']]);
    expect(openExternal.mock.calls).toEqual([['https://github.com/login/device']]);
  } finally {
    vi.unstubAllGlobals();
  }
});
