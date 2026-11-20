// Each ask that keeps the panel busy is answered by the backend under its own call, and only that answer ends it:
// a blame that fails says nothing about a push still running. An error shows its message whichever ask it answers,
// and one answering no ask the panel holds ends nothing. A status that is read clears only a failure of the kind a
// status read reports, never a write's.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { askAnswered, askFailed } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';

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

/** Git's refusal of the ask sent as `asked` under `call` */
const failed = <K extends string>(call: string, asked: K, message: string, extra: object = {}) => askFailed(call, asked, { kind: 'git' as const, message, ...extra });

it('ends a running push only on its own failure, not on a failed blame', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.PROGRESS', data: { during: 'push', stage: 'Writing objects', percent: 42 } });
  actor.send({ type: 'commit.SHOW_BLAME', path: 'a.txt' });

  actor.send(failed(sentCall(sendToSystem, 'commit.GET_BLAME'), 'commit.GET_BLAME', 'no such path in HEAD'));

  expect(actor.getSnapshot().context, 'the blame is let go of, the push goes on').toMatchObject({
    blame: null, isPushing: true, progress: { during: 'push' }, gitError: 'no such path in HEAD',
  });

  actor.send(failed(sentCall(sendToSystem, 'commit.PUBLISH_BRANCH'), 'commit.PUBLISH_BRANCH', 'Failed to push'));
  expect(actor.getSnapshot().context).toMatchObject({ isPushing: false, progress: null, gitError: 'Failed to push' });
});

it('shows an error that answers no ask it holds, and ends nothing with it', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });

  // The pull request panel's checkout, whose answer comes to this panel by its name
  actor.send(failed('c-asked-elsewhere', 'commit.CHECKOUT_BRANCH', 'something else failed'));

  expect(actor.getSnapshot().context).toMatchObject({ isPushing: true, gitError: 'something else failed' });
});

it.each([
  ['a stash', { type: 'commit.STASH_PUSH' }, 'commit.STASH_PUSH', 'isStashing'],
  ['a worktree added', { type: 'commit.WORKTREE_ADD', path: '/work/two', branch: 'two' }, 'commit.WORKTREE_ADD', 'isWorktreeLoading'],
  ['a worktree switch', { type: 'commit.WORKTREE_SWITCH', path: '/work/two' }, 'commit.WORKTREE_SWITCH', 'isWorktreeLoading'],
  ['speeding the status up', { type: 'commit.SPEED_UP_STATUS' }, 'commit.SPEED_UP_STATUS', 'isSpeedingUpStatus'],
  ['a checkout', { type: 'commit.CHECKOUT_BRANCH' }, 'commit.CHECKOUT_BRANCH', 'isCheckingOutBranch'],
] as const)('is no longer busy with %s once it fails', (_what, ask, sent, busy) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: 'two' });
  actor.send(ask);
  expect(actor.getSnapshot().context[busy]).toBe(true);

  actor.send(failed(sentCall(sendToSystem, sent), sent as string, 'git refused') as never);

  expect(actor.getSnapshot().context).toMatchObject({ [busy]: false, gitError: 'git refused' });
});

it('stops reading a commit\'s message to reword it once the read fails', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.START_REWORD', hash: 'abc123' });

  actor.send(failed(sentCall(sendToSystem, 'commit.GET_COMMIT_MESSAGE'), 'commit.GET_COMMIT_MESSAGE', 'bad object abc123'));

  expect(actor.getSnapshot().context.rewording).toBeNull();
});

it('is no longer busy with a worktree switch once the backend says it switched', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.WORKTREE_SWITCH', path: '/work/two' });

  actor.send(askAnswered(sentCall(sendToSystem, 'commit.WORKTREE_SWITCH'), 'commit.WORKTREE_SWITCH', { path: '/work/two' }));

  expect(actor.getSnapshot().context.isWorktreeLoading).toBe(false);
});

/** A status answering the latest ask for one */
function statusAnswered(actor: ReturnType<typeof createActor<typeof commitState>>) {
  actor.send({ type: 'commit.REFRESH_STATUS' });
  const call = sentCall(sendToSystem, 'commit.GET_GIT_STATUS', sendToSystem.mock.calls.filter(([, event]) => (event as { type: string }).type === 'commit.GET_GIT_STATUS').length - 1);
  return (answer: (call: string) => object) => actor.send(answer(call) as never);
}
const STATUS = (call: string) => askAnswered(call, 'commit.GET_GIT_STATUS', { files: [], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 1, commitsBehind: 0, watching: true });

it('keeps a failed push\'s error, and what can be done about it, through a status read', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  const signIn = { host: 'github.com', kind: 'github' } as const;
  actor.send(failed(sentCall(sendToSystem, 'commit.PUBLISH_BRANCH'), 'commit.PUBLISH_BRANCH', 'the remote asked for a sign-in', { code: 'authentication', during: 'push', signIn }));

  statusAnswered(actor)(STATUS);

  expect(actor.getSnapshot().context).toMatchObject({ gitError: 'the remote asked for a sign-in', gitFailure: { during: 'push', signIn } });
});

it('clears the status read\'s own failure once a status is read', () => {
  const actor = createActor(commitState).start();
  statusAnswered(actor)(call => failed(call, 'commit.GET_GIT_STATUS', 'Not a git repository'));
  expect(actor.getSnapshot().context).toMatchObject({ gitError: 'Not a git repository', isGitLoading: false });

  statusAnswered(actor)(STATUS);

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
});

it('clears a refusal of the kind a status read reports, whichever ask it answered, once a status is read', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.STASH_PUSH' });
  actor.send(failed(sentCall(sendToSystem, 'commit.STASH_PUSH'), 'commit.STASH_PUSH', 'Not trusted.', { code: 'untrusted' }));

  statusAnswered(actor)(STATUS);

  expect(actor.getSnapshot().context).toMatchObject({ gitError: null, gitFailure: null });
});
