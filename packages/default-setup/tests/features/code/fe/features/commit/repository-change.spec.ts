// The news that a repository changed says which parts of it did, and the commit panel asks again for those
// alone. An edited file changes the status; reading the log, the stashes and the worktrees again for it is three
// git processes in every window that nobody needs.
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

const NOTHING = { status: false, history: false, stashes: false, worktrees: false };
/** What the panel asked the backend for, in order */
const asked = () => sendToSystem.mock.calls.map(([, event]) => (event as { type: string }).type);
const told = (changed: Partial<typeof NOTHING>) => {
  const actor = createActor(commitState).start();
  sendToSystem.mockReset();
  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, ...changed } });
  actor.stop();
  return asked();
};

beforeEach(() => sendToSystem.mockReset());

it('asks for the status alone when only the status changed', () => {
  expect(told({ status: true })).toEqual(['commit.GET_GIT_STATUS']);
});

it('asks for each list whose part changed', () => {
  expect(told({ history: true })).toEqual(['commit.LOG_LIST']);
  expect(told({ stashes: true })).toEqual(['commit.STASH_LIST']);
  expect(told({ worktrees: true })).toEqual(['commit.WORKTREE_LIST']);
  expect(told({ status: true, history: true, stashes: true, worktrees: true }))
    .toEqual(['commit.GET_GIT_STATUS', 'commit.LOG_LIST', 'commit.STASH_LIST', 'commit.WORKTREE_LIST']);
});
