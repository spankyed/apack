// A push or a pull the remote refused for want of a sign-in: the panel keeps what can be done about it with the
// error, sets git's sign-in up when the user signs in to GitHub, and then runs the command again.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, made, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);

const GITHUB = { host: 'github.com', kind: 'github' } as const;
const sent = () => made.map(ask => ask.event.type);

/** A panel whose push or pull was refused for want of a sign-in */
async function panelRefused(during: 'push' | 'pull' | undefined) {
  const actor = createActor(commitState).start();
  actor.send({ type: during === 'pull' ? 'commit.PULL_BRANCH' : 'commit.PUSH_BRANCH' });
  await latestAsk(during === 'pull' ? 'commit.PULL_BRANCH' : 'commit.PUBLISH_BRANCH').refuse('Failed: the remote asked for a sign-in', { kind: 'git', code: 'authentication', during, signIn: GITHUB });
  resetAsks();
  return actor;
}

it('keeps what can be done about a sign-in with the error, and lets go of both together', async () => {
  const actor = await panelRefused('push');
  expect(actor.getSnapshot().context).toMatchObject({ gitError: 'Failed: the remote asked for a sign-in', gitFailure: { during: 'push', signIn: GITHUB } });

  actor.send({ type: 'commit.DISMISS_ERROR' });
  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
});

it('asks for the sign-in to be set up for the host, and is busy with it until it is answered', async () => {
  const actor = await panelRefused('push');

  actor.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

  expect(latestAsk('commit.SET_UP_SIGN_IN').event, 'with the push that was refused, which the answer brings back').toEqual({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'push' });
  expect(actor.getSnapshot().context.making.signIn).toBe(true);

  await latestAsk('commit.SET_UP_SIGN_IN').refuse('Sign in to GitHub to give git a sign-in for github.com.', { kind: 'git', code: 'authentication', signIn: GITHUB });
  expect(actor.getSnapshot().context.making.signIn, 'a setup that failed is answered too').toBe(false);
  expect(actor.getSnapshot().context.gitError).toBe('Sign in to GitHub to give git a sign-in for github.com.');
});

it.each([['push', 'commit.PUBLISH_BRANCH', 'push'], ['pull', 'commit.PULL_BRANCH', 'pull']] as const)(
  'runs the %s again once git can sign in, and clears the error', async (during, command, busy) => {
    const actor = await panelRefused(during);
    actor.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

    await latestAsk('commit.SET_UP_SIGN_IN').answer({ host: 'github.com', during });

    expect(sent()).toEqual(['commit.SET_UP_SIGN_IN', command]);
    expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
    expect(actor.getSnapshot().context.making.signIn).toBe(false);
    expect(actor.getSnapshot().context.making[busy]).toBe(true);
  });

// Taken from the notice that fetching stopped: there is no command of the user's to run again
it('runs nothing again when the sign-in was not for a push or a pull', async () => {
  const actor = await panelRefused(undefined);
  actor.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

  await latestAsk('commit.SET_UP_SIGN_IN').answer({ host: 'github.com' });

  expect(sent()).toEqual(['commit.SET_UP_SIGN_IN']);
});

it('holds what can be done about the sign-in that stopped fetching, as the status says', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });

  await latestAsk('commit.GET_GIT_STATUS').answer({ files: [], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 0, commitsBehind: 0, watching: true, fetchSuspended: true, signIn: GITHUB });
  expect(actor.getSnapshot().context.fetchSignIn).toEqual(GITHUB);
});

// What the panel holds of the refused command is cleared by the next status, which can arrive while the sign-in
// is being set up: the command travels with the ask and comes back with its answer
it('runs the push again when a status was answered while the sign-in was being set up', async () => {
  const actor = await panelRefused('push');
  actor.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });
  const asked = latestAsk('commit.SET_UP_SIGN_IN');
  actor.send({ type: 'commit.DISMISS_ERROR' });

  await asked.answer({ host: 'github.com', during: asked.event.during });

  expect(sent()).toEqual(['commit.SET_UP_SIGN_IN', 'commit.PUBLISH_BRANCH']);
});

it('runs the push again when the sign-in is set up at the second try', async () => {
  const actor = await panelRefused('push');
  actor.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });
  // A set-up that failed keeps the push it was for, as it was asked
  await latestAsk('commit.SET_UP_SIGN_IN').refuse('Sign in to GitHub to give git a sign-in for github.com.', { kind: 'git', code: 'authentication', during: 'push', signIn: GITHUB });

  actor.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });
  expect(latestAsk('commit.SET_UP_SIGN_IN').event).toEqual({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'push' });
});
