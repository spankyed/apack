// The panel offers to stop a push only while one runs, and a stopped push is no failure: it leaves pushing, with
// nothing to show as an error.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

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
const sent = () => sendToSystem.mock.calls.map(([, event]) => (event as { type: string }).type);

it('asks the backend to stop the push running, and to stop nothing when none runs', () => {
  const actor = createActor(commitState).start();

  actor.send({ type: 'commit.STOP_PUSH' });
  expect(sent()).toEqual([]);

  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.STOP_PUSH' });
  expect(sent()).toContain('commit.STOP_PUSH');
});

it('leaves pushing once the push is stopped, with no error to show', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.PUSH_BRANCH' });
  expect(actor.getSnapshot().context.isPushing).toBe(true);

  actor.send({ type: 'commit.PUSH_STOPPED' });

  expect(actor.getSnapshot().context).toMatchObject({ isPushing: false, gitError: null, progress: null });
});
