// A push or a pull the remote refused for want of a sign-in: the panel keeps what can be done about it with the
// error, sets git's sign-in up when the user signs in to GitHub, and then runs the command again.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const GITHUB = { host: 'github.com', kind: 'github' } as const;
const sent = (h: CommitHarness) => h.made.map((ask) => ask.event.type);

async function panelRefused(during: 'push' | 'pull' | undefined) {
  const h = startCommit();
  running.push(h);
  h.send({ type: during === 'pull' ? 'commit.PULL_BRANCH' : 'commit.PUSH_BRANCH' });
  await h.latestAsk(during === 'pull' ? 'commit.PULL_BRANCH' : 'commit.PUBLISH_BRANCH').refuse('Failed: the remote asked for a sign-in', { kind: 'git', code: 'authentication', during, signIn: GITHUB });
  h.reset();
  return h;
}

it('keeps what can be done about a sign-in with the error, and lets go of both together', async () => {
  const h = await panelRefused('push');
  expect(h.open().data).toMatchObject({ gitError: 'Failed: the remote asked for a sign-in', gitFailure: { during: 'push', signIn: GITHUB } });

  h.send({ type: 'commit.DISMISS_ERROR' });
  expect(h.open().data).toMatchObject({ gitError: null, gitFailure: null });
});

it('asks for the sign-in to be set up for the host, and is busy with it until it is answered', async () => {
  const h = await panelRefused('push');

  h.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

  expect(h.latestAsk('commit.SET_UP_SIGN_IN').event, 'with the push that was refused, which the answer brings back').toEqual({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'push' });
  expect(h.remotes().pending.signIn).toBe(true);

  await h.latestAsk('commit.SET_UP_SIGN_IN').refuse('Sign in to GitHub to give git a sign-in for github.com.', { kind: 'git', code: 'authentication', signIn: GITHUB });
  expect(h.remotes().pending.signIn, 'a setup that failed is answered too').toBe(false);
  expect(h.open().data.gitError).toBe('Sign in to GitHub to give git a sign-in for github.com.');
});

it.each([['push', 'commit.PUBLISH_BRANCH', 'push'], ['pull', 'commit.PULL_BRANCH', 'pull']] as const)(
  'runs the %s again once git can sign in, and clears the error', async (during, command, busy) => {
    const h = await panelRefused(during);
    h.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

    await h.latestAsk('commit.SET_UP_SIGN_IN').answer({ host: 'github.com', during });

    expect(sent(h)).toEqual(['commit.SET_UP_SIGN_IN', command]);
    expect(h.open().data).toMatchObject({ gitError: null, gitFailure: null });
    expect(h.remotes().pending.signIn).toBe(false);
    expect(h.remotes().pending[busy]).toBe(true);
  });

it('runs nothing again when the sign-in was not for a push or a pull', async () => {
  const h = await panelRefused(undefined);
  h.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });

  await h.latestAsk('commit.SET_UP_SIGN_IN').answer({ host: 'github.com' });

  expect(sent(h)).toEqual(['commit.SET_UP_SIGN_IN']);
});

it('holds what can be done about the sign-in that stopped fetching, as the status says', async () => {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.REFRESH_STATUS' });

  await h.latestAsk('commit.GET_GIT_STATUS').answer({ files: [], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 0, commitsBehind: 0, watching: true, fetchSuspended: true, signIn: GITHUB });
  expect(h.open().data.fetchSignIn).toEqual(GITHUB);
});

it('runs the push again when a status was answered while the sign-in was being set up', async () => {
  const h = await panelRefused('push');
  h.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });
  const asked = h.latestAsk('commit.SET_UP_SIGN_IN');
  h.send({ type: 'commit.DISMISS_ERROR' });

  await asked.answer({ host: 'github.com', during: asked.event.during });

  expect(sent(h)).toEqual(['commit.SET_UP_SIGN_IN', 'commit.PUBLISH_BRANCH']);
});

it('runs the push again when the sign-in is set up at the second try', async () => {
  const h = await panelRefused('push');
  h.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });
  await h.latestAsk('commit.SET_UP_SIGN_IN').refuse('Sign in to GitHub to give git a sign-in for github.com.', { kind: 'git', code: 'authentication', during: 'push', signIn: GITHUB });

  h.send({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com' });
  expect(h.latestAsk('commit.SET_UP_SIGN_IN').event).toEqual({ type: 'commit.SET_UP_SIGN_IN', host: 'github.com', during: 'push' });
});
