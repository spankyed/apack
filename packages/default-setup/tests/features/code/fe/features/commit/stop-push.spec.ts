// The panel offers to stop a push only while one runs, and a stopped push is no failure: it leaves pushing, with
// nothing to show as an error.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);

it('stops the push running by no longer waiting on it, and stops nothing when none runs', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.STOP_PUSH' });
  expect(asksOf('commit.PUBLISH_BRANCH')).toEqual([]);
  expect(actor.getSnapshot().context.pushStopped).toBe(false);

  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.STOP_PUSH' });
  expect(latestAsk('commit.PUBLISH_BRANCH').stopped).toBe(true);
});

it('leaves pushing once the push is stopped, with no error to show', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  expect(actor.getSnapshot().context.making.push).toBe(true);
  latestAsk('commit.PUBLISH_BRANCH').tell({ during: 'push', stage: 'Writing objects', percent: 42 });

  actor.send({ type: 'commit.STOP_PUSH' });

  expect(actor.getSnapshot().context.making.push).toBe(false);
  expect(actor.getSnapshot().context).toMatchObject({ pushStopped: true, gitError: null, progress: null });
});
