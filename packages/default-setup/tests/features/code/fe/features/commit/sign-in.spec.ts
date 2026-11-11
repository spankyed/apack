// A push or a pull the remote refused for want of a sign-in: the panel keeps what can be done about it with the
// error, has the GitHub CLI set git's sign-in up when the user takes the offer, and then runs the command again.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => sendToSystem.mockReset());

const GITHUB = { host: 'github.com', kind: 'github-cli' } as const;
const sent = () => sendToSystem.mock.calls.map(([, event]) => (event as { type: string }).type);

/** A panel whose push or pull was refused for want of a sign-in */
function panelRefused(during: 'push' | 'pull' | undefined) {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.ERROR_RECEIVED', data: { message: 'Failed: the remote asked for a sign-in', code: 'authentication', during, signIn: GITHUB } });
  sendToSystem.mockReset();
  return actor;
}

it('keeps what can be done about a sign-in with the error, and lets go of both together', () => {
  const actor = panelRefused('push');
  expect(actor.getSnapshot().context).toMatchObject({ gitError: 'Failed: the remote asked for a sign-in', gitFailure: { during: 'push', signIn: GITHUB } });

  actor.send({ type: 'commit.DISMISS_ERROR' });
  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
});

it('asks for the sign-in to be set up for the host, and is busy with it until it is answered', () => {
  const actor = panelRefused('push');

  actor.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

  expect(sendToSystem).toHaveBeenCalledWith('code', { type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });
  expect(actor.getSnapshot().context.isSettingUpSignIn).toBe(true);

  actor.send({ type: 'commit.ERROR_RECEIVED', data: { message: 'GitHub CLI is not signed in', code: 'authentication', signIn: GITHUB } });
  expect(actor.getSnapshot().context, 'a setup that failed is answered too').toMatchObject({ isSettingUpSignIn: false, gitError: 'GitHub CLI is not signed in' });
});

it.each([['push', 'commit.PUBLISH_BRANCH', 'isPushing'], ['pull', 'commit.PULL_BRANCH', 'isPulling']] as const)(
  'runs the %s again once git can sign in, and clears the error', (during, command, busy) => {
    const actor = panelRefused(during);

    actor.send({ type: 'commit.SIGN_IN_SET_UP', data: { host: 'github.com' } });

    expect(sent()).toEqual([command]);
    expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null, isSettingUpSignIn: false, [busy]: true });
  });

// Taken from the notice that fetching stopped: there is no command of the user's to run again
it('runs nothing again when the sign-in was not for a push or a pull', () => {
  const actor = panelRefused(undefined);

  actor.send({ type: 'commit.SIGN_IN_SET_UP', data: { host: 'github.com' } });

  expect(sent()).toEqual([]);
});

it('holds what can be done about the sign-in that stopped fetching, as the status says', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  const [, , { call }] = sendToSystem.mock.calls.at(-1) as [string, object, { call: string }];
  const status = (signIn?: typeof GITHUB) => answerTo(call, {
    type: 'commit.STATUS_RECEIVED' as const,
    data: { files: [], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 0, commitsBehind: 0, watching: true, fetchSuspended: signIn !== undefined, signIn },
  });

  actor.send(status(GITHUB));
  expect(actor.getSnapshot().context.fetchSignIn).toEqual(GITHUB);
});
