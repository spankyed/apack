// A window's view of the GitHub sign-in: the code for the sign-in it started, how that ended, and the account every
// window is told. Starting a second sign-in ends the first, whose ending then arrives too: only the answer to the
// sign-in still asked for, and the ending of the sign-in whose code it shows, are this window's to show.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { askAnswered, askFailed } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));

import { githubState } from '#features/code/fe/features/github/state.ts';

beforeEach(() => { sendToSystem.mockReset(); });

const started = () => {
  const actor = createActor(githubState).start();
  actor.send({ type: 'github.SIGN_IN' });
  // The latest sign-in asked, which is this actor's: a case may start more than one
  const asked = sendToSystem.mock.calls.filter(([, event]) => (event as { type: string }).type === 'github.SIGN_IN').length
  return { actor, call: sentCall(sendToSystem, 'github.SIGN_IN', asked - 1) };
};
const code = { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: 1 };

it('shows the code of the sign-in it asked for, and not one an earlier sign-in ended with', () => {
  const { actor, call: first } = started();
  actor.send({ type: 'github.SIGN_IN' });
  const second = sentCall(sendToSystem, 'github.SIGN_IN', 1);

  actor.send(askFailed(first, 'github.SIGN_IN', { kind: 'cancelled', message: 'Signing in to GitHub was cancelled.' }));
  expect(actor.getSnapshot().context.signIn, "the first one's ending leaves the second").toEqual({});

  actor.send(askAnswered(second, 'github.SIGN_IN', code));
  expect(actor.getSnapshot().context.signIn).toEqual({ code });
});

it('says why a sign-in failed, but not that one was cancelled', () => {
  const denied = started();
  denied.actor.send(askAnswered(denied.call, 'github.SIGN_IN', code));
  denied.actor.send({ type: 'github.SIGN_IN_FAILED', userCode: code.userCode, reason: 'denied', message: 'The sign-in was refused at GitHub.' });
  expect(denied.actor.getSnapshot().context).toMatchObject({ signIn: null, failure: { reason: 'denied' } });

  const cancelled = started();
  cancelled.actor.send(askAnswered(cancelled.call, 'github.SIGN_IN', code));
  cancelled.actor.send({ type: 'github.SIGN_IN_FAILED', userCode: code.userCode, reason: 'cancelled', message: 'Signing in to GitHub was cancelled.' });
  expect(cancelled.actor.getSnapshot().context).toMatchObject({ signIn: null, failure: null });

  const unconfigured = started();
  unconfigured.actor.send(askFailed(unconfigured.call, 'github.SIGN_IN', { kind: 'unconfigured', message: 'Signing in to GitHub is not set up.' }));
  expect(unconfigured.actor.getSnapshot().context, 'nor one GitHub gave no code for').toMatchObject({ signIn: null, failure: { reason: 'unconfigured' } });
});

it('takes no ending of a sign-in other than the one whose code it shows', () => {
  const { actor, call } = started();
  actor.send(askAnswered(call, 'github.SIGN_IN', code));
  actor.send({ type: 'github.SIGN_IN_FAILED', userCode: 'OLD0-0000', reason: 'expired', message: 'The code expired.' });
  expect(actor.getSnapshot().context).toMatchObject({ signIn: { code }, failure: null });
});

it('takes the account any window signed in as, ending the sign-in it shows', () => {
  const { actor, call } = started();
  actor.send(askAnswered(call, 'github.SIGN_IN', code));

  actor.send({ type: 'github.ACCOUNT_CHANGED', account: { login: 'octocat' } });

  expect(actor.getSnapshot().context).toMatchObject({ account: { login: 'octocat' }, signIn: null, failure: null });
});

it("copies its sign-in's code and opens GitHub's page for it in the system browser, and nothing for another's", () => {
  const writeText = vi.fn(async () => true);
  const openExternal = vi.fn(async () => {});
  vi.stubGlobal('window', { electronAPI: { clipboard: { writeText }, shell: { openExternal } } });
  try {
    const { actor, call: first } = started();
    actor.send({ type: 'github.SIGN_IN' });
    const second = sentCall(sendToSystem, 'github.SIGN_IN', 1);

    actor.send(askAnswered(first, 'github.SIGN_IN', { ...code, userCode: 'OLD0-0000' }));
    expect(writeText, 'a code from a sign-in this window has moved on from').not.toHaveBeenCalled();

    actor.send(askAnswered(second, 'github.SIGN_IN', code));
    expect(writeText.mock.calls).toEqual([['ABCD-1234']]);
    expect(openExternal.mock.calls).toEqual([['https://github.com/login/device']]);
  } finally {
    vi.unstubAllGlobals();
  }
});
