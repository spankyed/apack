// How far along a push, a pull or a checkout is: the panel holds what git last said until the command is answered
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, resetAsks, type MadeAsk } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);

const WRITING = { during: 'push', stage: 'Writing objects', percent: 42 } as const;

it.each([
  ['it is pushed', (push: MadeAsk) => push.answer({ branchName: 'main' })],
  ['git refuses it', (push: MadeAsk) => push.refuse('Failed to push', { kind: 'git' })],
] as const)('holds how far along a push is, as its ask says, and lets go of it once %s', async (_when, end) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });

  latestAsk('commit.PUBLISH_BRANCH').tell(WRITING);
  expect(actor.getSnapshot().context.progress).toEqual(WRITING);

  await end(latestAsk('commit.PUBLISH_BRANCH'));
  expect(actor.getSnapshot().context.progress).toBeNull();
  expect(actor.getSnapshot().context.making.push).toBe(false);
});
