// A branch is made only when the user asks for one: a checkout that found no branch shows the name, and making it
// is its own ask. A stash takes the commit message typed only when it was named with it; one applied or popped
// leaves the message alone.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
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

it('shows the branch a checkout found nowhere, and makes it only when asked to', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: 'topic' });
  actor.send({ type: 'commit.CHECKOUT_BRANCH' });

  actor.send(answerTo(sentCall(sendToSystem, 'commit.CHECKOUT_BRANCH'), {
    type: 'commit.ERROR_RECEIVED', data: { message: 'There is no branch named topic, here or on a remote.', code: 'unknown-ref', missingBranch: 'topic' },
  }));
  expect(actor.getSnapshot().context).toMatchObject({ isCheckingOutBranch: false, gitFailure: { missingBranch: 'topic' } });
  expect(sendToSystem.mock.calls.map(([, event]) => event.type), 'nothing made by itself').not.toContain('commit.CREATE_BRANCH');

  actor.send({ type: 'commit.CREATE_BRANCH', branchName: 'topic' });

  expect(sendToSystem).toHaveBeenLastCalledWith('code', { type: 'commit.CREATE_BRANCH', branchName: 'topic' }, expect.objectContaining({ call: expect.any(String) }));
  expect(actor.getSnapshot().context, 'the refusal it answers goes').toMatchObject({ isCheckingOutBranch: true, gitError: null, gitFailure: null });
  actor.send(answerTo(sentCall(sendToSystem, 'commit.CREATE_BRANCH'), { type: 'commit.BRANCH_CHECKOUT_SUCCESS', data: { branchName: 'topic' } }));
  expect(actor.getSnapshot().context.isCheckingOutBranch).toBe(false);
});

it('keeps the commit message typed through a stash of one file, and gives it to a stash named with it', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix the thing' });

  actor.send({ type: 'commit.STASH_PUSH', message: 'src/a.ts', paths: ['src/a.ts'] });
  actor.send(answerTo(sentCall(sendToSystem, 'commit.STASH_PUSH'), { type: 'commit.STASH_SUCCESS', data: { message: 'Saved' } }));
  expect(actor.getSnapshot().context).toMatchObject({ isStashing: false, commitMessage: 'Fix the thing' });

  sendToSystem.mockReset();
  actor.send({ type: 'commit.STASH_PUSH', message: 'Fix the thing', stagedOnly: false });
  actor.send(answerTo(sentCall(sendToSystem, 'commit.STASH_PUSH'), { type: 'commit.STASH_SUCCESS', data: { message: 'Saved' } }));
  expect(actor.getSnapshot().context.commitMessage, 'the stash took the message').toBe('');
});

it('leaves the commit message typed when a stash is applied or popped', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix the thing' });

  actor.send({ type: 'commit.STASH_POP', index: 0 });
  actor.send({ type: 'commit.STASH_APPLIED', data: { index: 0, popped: true } });

  expect(actor.getSnapshot().context.commitMessage).toBe('Fix the thing');
});
