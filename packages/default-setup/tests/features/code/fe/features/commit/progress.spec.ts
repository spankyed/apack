// How far along a push, a pull or a checkout is: the panel holds what git last said until the command is answered
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

const WRITING = { during: 'push', stage: 'Writing objects', percent: 42 } as const;

it.each([
  ['it is pushed', { type: 'commit.BRANCH_PUSHED', data: { branchName: 'main' } }],
  ['git refuses it', { type: 'commit.ERROR_RECEIVED', data: { message: 'Failed to push' } }],
] as const)('holds how far along a push is, and lets go of it once %s', (_when, answer) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });

  actor.send({ type: 'commit.PROGRESS', data: WRITING });
  expect(actor.getSnapshot().context.progress).toEqual(WRITING);

  actor.send(answerTo(sentCall(sendToSystem, 'commit.PUBLISH_BRANCH'), answer));
  expect(actor.getSnapshot().context).toMatchObject({ progress: null, isPushing: false });
});
