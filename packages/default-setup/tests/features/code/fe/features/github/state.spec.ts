// A window's view of the GitHub sign-in: the code for the sign-in it started, how that ended, and the account every
// window is told. Starting a second sign-in ends the first, whose ending then arrives too: only the answers to the
// sign-in still asked for are this window's to show.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
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

  actor.send(answerTo(first, { type: 'github.SIGN_IN_FAILED', reason: 'cancelled', message: 'Signing in to GitHub was cancelled.' }));
  expect(actor.getSnapshot().context.signIn, "the first one's ending leaves the second").toEqual({});

  actor.send(answerTo(second, { type: 'github.SIGN_IN_CODE', ...code }));
  expect(actor.getSnapshot().context.signIn).toEqual({ code });
});

it('says why a sign-in failed, but not that one was cancelled', () => {
  const denied = started();
  denied.actor.send(answerTo(denied.call, { type: 'github.SIGN_IN_FAILED', reason: 'denied', message: 'The sign-in was refused at GitHub.' }));
  expect(denied.actor.getSnapshot().context).toMatchObject({ signIn: null, failure: { reason: 'denied' } });

  const cancelled = started();
  cancelled.actor.send(answerTo(cancelled.call, { type: 'github.SIGN_IN_FAILED', reason: 'cancelled', message: 'Signing in to GitHub was cancelled.' }));
  expect(cancelled.actor.getSnapshot().context).toMatchObject({ signIn: null, failure: null });
});

it('takes the account any window signed in as, ending the sign-in it shows', () => {
  const { actor, call } = started();
  actor.send(answerTo(call, { type: 'github.SIGN_IN_CODE', ...code }));

  actor.send({ type: 'github.ACCOUNT_CHANGED', account: { login: 'octocat' } });

  expect(actor.getSnapshot().context).toMatchObject({ account: { login: 'octocat' }, signIn: null, failure: null });
});
