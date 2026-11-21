// Each ask that keeps the panel busy is answered by the backend under its own call, and only that answer ends it:
// a blame that fails says nothing about a push still running. An error shows its message whichever ask it answers,
// and one answering no ask the panel holds ends nothing. A status that is read clears only a failure of the kind a
// status read reports, never a write's.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState, worktreeChangeUnderWay } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);

const STATUS = { files: [], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 1, commitsBehind: 0, watching: true };

it('ends a running push only on its own failure, not on a failed blame', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  latestAsk('commit.PUBLISH_BRANCH').tell({ during: 'push', stage: 'Writing objects', percent: 42 });
  actor.send({ type: 'commit.SHOW_BLAME', path: 'a.txt' });

  await latestAsk('commit.GET_BLAME').refuse('no such path in HEAD', { kind: 'git' });

  expect(actor.getSnapshot().context.making.push, 'the push goes on').toBe(true);
  expect(actor.getSnapshot().context, 'the blame is let go of').toMatchObject({
    blame: null, progress: { during: 'push' }, gitError: 'no such path in HEAD',
  });

  await latestAsk('commit.PUBLISH_BRANCH').refuse('Failed to push', { kind: 'git' });
  expect(actor.getSnapshot().context.making.push).toBe(false);
  expect(actor.getSnapshot().context).toMatchObject({ progress: null, gitError: 'Failed to push' });
});

it('shows a failure of another ask, and ends nothing else with it', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.STASH_DROP', index: 0 });

  await latestAsk('commit.STASH_DROP').refuse('something else failed', { kind: 'git' });

  expect(actor.getSnapshot().context.making.push).toBe(true);
  expect(actor.getSnapshot().context.gitError).toBe('something else failed');
});

it.each([
  ['a stash', { type: 'commit.STASH_PUSH' }, 'commit.STASH_PUSH', 'stash'],
  ['a worktree added', { type: 'commit.WORKTREE_ADD', path: '/work/two', branch: 'two' }, 'commit.WORKTREE_ADD', 'worktreeAdd'],
  ['a worktree switch', { type: 'commit.WORKTREE_SWITCH', path: '/work/two' }, 'commit.WORKTREE_SWITCH', 'worktreeSwitch'],
  ['speeding the status up', { type: 'commit.SPEED_UP_STATUS' }, 'commit.SPEED_UP_STATUS', 'speedUp'],
  ['a checkout', { type: 'commit.CHECKOUT_BRANCH' }, 'commit.CHECKOUT_BRANCH', 'checkout'],
] as const)('is no longer busy with %s once it fails', async (_what, ask, sent, busy) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: 'two' });
  actor.send(ask);
  expect(actor.getSnapshot().context.making[busy]).toBe(true);

  await latestAsk(sent).refuse('git refused', { kind: 'git' });

  expect(actor.getSnapshot().context.making[busy]).toBe(false);
  expect(actor.getSnapshot().context.gitError).toBe('git refused');
});

it('stops reading a commit\'s message to reword it once the read fails', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.START_REWORD', hash: 'abc123' });

  await latestAsk('commit.GET_COMMIT_MESSAGE').refuse('bad object abc123', { kind: 'git' });

  expect(actor.getSnapshot().context.rewording).toBeNull();
});

it('is no longer busy with a worktree switch once the backend says it switched', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.WORKTREE_SWITCH', path: '/work/two' });

  await latestAsk('commit.WORKTREE_SWITCH').answer({ path: '/work/two' });

  expect(worktreeChangeUnderWay(actor.getSnapshot().context.making)).toBe(false);
});

/** Asks for the status, and hands back the ask to end */
function statusAsked(actor: ReturnType<typeof createActor<typeof commitState>>) {
  actor.send({ type: 'commit.REFRESH_STATUS' });
  return latestAsk('commit.GET_GIT_STATUS');
}

it('keeps a failed push\'s error, and what can be done about it, through a status read', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  const signIn = { host: 'github.com', kind: 'github' } as const;
  await latestAsk('commit.PUBLISH_BRANCH').refuse('the remote asked for a sign-in', { kind: 'git', code: 'authentication', during: 'push', signIn });

  await statusAsked(actor).answer(STATUS);

  expect(actor.getSnapshot().context).toMatchObject({ gitError: 'the remote asked for a sign-in', gitFailure: { during: 'push', signIn } });
});

it('clears the status read\'s own failure once a status is read', async () => {
  const actor = createActor(commitState).start();
  await statusAsked(actor).refuse('Not a git repository', { kind: 'git' });
  expect(actor.getSnapshot().context.gitError).toBe('Not a git repository');
  expect(actor.getSnapshot().context.making.statusShown, 'no longer shown as loading').toBe(false);

  await statusAsked(actor).answer(STATUS);

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
});

it('clears a refusal of the kind a status read reports, whichever ask it answered, once a status is read', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.STASH_PUSH' });
  await latestAsk('commit.STASH_PUSH').refuse('Not trusted.', { kind: 'git', code: 'untrusted' });

  await statusAsked(actor).answer(STATUS);

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
});

it('holds no ask once each has ended, whether it was done or refused', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.txt'] });
  actor.send({ type: 'commit.PREVIEW_DISCARD', paths: ['a.txt'] });
  actor.send({ type: 'commit.GENERATE_MESSAGE' });

  await latestAsk('commit.PREVIEW_DISCARD').refuse('nothing to discard', { kind: 'git' });
  await latestAsk('commit.GENERATE_MESSAGE').answer({});
  await latestAsk('commit.STAGE_FILES').answer({ paths: ['a.txt'] });
  await latestAsk('commit.GET_GIT_STATUS').answer(STATUS);

  expect(actor.getSnapshot().context.making).toEqual(createActor(commitState).getSnapshot().context.making);
});
