// What the commit machine holds while a commit, an amend, a tag or a reset is asked for, and what each answer
// leaves: one commit at a time, a stopped push said as stopped, and a message with nothing to commit said as that.
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
const sent = (type: string) => sendToSystem.mock.calls.filter(([, event]) => event.type === type);

it('says a push that was stopped was stopped, and a push run again starts over', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.PUSH_STOPPED' });
  expect(actor.getSnapshot().context).toMatchObject({ isPushing: false, pushStopped: true });

  actor.send({ type: 'commit.PUSH_BRANCH' });
  expect(actor.getSnapshot().context.pushStopped).toBe(false);
  actor.send({ type: 'commit.BRANCH_PUSHED', data: { branchName: 'main' } });
  expect(actor.getSnapshot().context).toMatchObject({ isPushing: false, pushStopped: false });
});

it('asks for one commit at a time, and for another once the first is answered', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix it' });

  actor.send({ type: 'commit.COMMIT' });
  actor.send({ type: 'commit.COMMIT' });
  actor.send({ type: 'commit.AMEND', message: 'Fix it' });
  expect(sent('commit.COMMIT'), 'the second click, and an amend, wait for the first').toHaveLength(1);
  expect(sent('commit.AMEND')).toHaveLength(0);

  actor.send(answerTo(sentCall(sendToSystem, 'commit.COMMIT'), { type: 'commit.ERROR_RECEIVED', data: { message: 'The hook refused it' } }));
  expect(actor.getSnapshot().context.isCommitting).toBe(false);

  actor.send({ type: 'commit.COMMIT' });
  expect(sent('commit.COMMIT')).toHaveLength(2);
  actor.send({ type: 'commit.COMMIT_SUCCESS', message: 'Fix it' });
  expect(actor.getSnapshot().context).toMatchObject({ isCommitting: false, commitMessage: '' });
});

it('holds an amend as a commit until it is answered, by its amend or by the question it needs', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.AMEND' });
  expect(actor.getSnapshot().context.isCommitting).toBe(true);
  actor.send({ type: 'commit.REWRITE_NEEDS_CONFIRMATION', data: { message: 'The last commit is already pushed.' } });
  expect(actor.getSnapshot().context.isCommitting, 'the user is asked').toBe(false);

  actor.send({ type: 'commit.CONFIRM_REWRITE' });
  expect(sent('commit.AMEND').at(-1)?.[1]).toMatchObject({ evenIfPublished: true });
  expect(actor.getSnapshot().context.isCommitting).toBe(true);
  actor.send({ type: 'commit.AMENDED' });
  expect(actor.getSnapshot().context.isCommitting).toBe(false);
});

it('says a message of only co-author lines has nothing to commit, rather than sending nothing', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Co-Authored-By: Someone <someone@example.com>' });

  actor.send({ type: 'commit.COMMIT' });

  expect(sent('commit.COMMIT')).toHaveLength(0);
  expect(actor.getSnapshot().context).toMatchObject({ isCommitting: false, gitError: expect.stringContaining('only Co-Authored-By lines') });
});

it('holds a tag pushed or deleted busy until its own answer, and keeps the tag last pushed', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_TAG', name: 'v1' });
  expect(actor.getSnapshot().context.tagBusy).toEqual({ name: 'v1', action: 'push' });

  actor.send(answerTo(sentCall(sendToSystem, 'commit.PUSH_TAG'), { type: 'commit.TAG_PUSHED', data: { name: 'v1' } }));
  expect(actor.getSnapshot().context).toMatchObject({ tagBusy: null, tagPushed: { name: 'v1' } });

  actor.send({ type: 'commit.DELETE_TAG', name: 'v1' });
  actor.send(answerTo(sentCall(sendToSystem, 'commit.DELETE_TAG'), { type: 'commit.ERROR_RECEIVED', data: { message: 'no such tag' } }));
  expect(actor.getSnapshot().context.tagBusy, 'refused: no longer busy').toBeNull();
});

it('holds a reset busy until it is answered', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.RESET_TO_COMMIT', hash: 'abc1234' });
  expect(actor.getSnapshot().context.resettingTo).toBe('abc1234');

  actor.send({ type: 'commit.RESET_COMMIT_SUCCESS', data: { hash: 'abc1234' } });
  expect(actor.getSnapshot().context.resettingTo).toBeNull();
});
