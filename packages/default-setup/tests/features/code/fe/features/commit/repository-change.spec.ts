// The news that a repository changed says which parts of it did, and the commit panel asks again for those
// alone. An edited file changes the status; reading the log, the stashes and the worktrees again for it is three
// git processes in every window that nobody needs. A diff is read when its tab opens, so the diffs the window
// has open are read again too, when the news says theirs changed.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

const sendToSystem = vi.hoisted(() => vi.fn());
const getParentContext = vi.hoisted(() => vi.fn((): { openFiles?: unknown[] } => ({})));
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext,
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false };
/** What the panel asked the backend for, in order */
const asked = () => sendToSystem.mock.calls.map(([, event]) => (event as { type: string }).type);
const told = (changed: Partial<typeof NOTHING> & { files?: string[] }) => {
  const actor = createActor(commitState).start();
  sendToSystem.mockReset();
  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, ...changed } });
  actor.stop();
  return asked();
};

beforeEach(() => {
  sendToSystem.mockReset();
  getParentContext.mockReturnValue({});
});

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

const aDiffTab = (path: string, staged = false) =>
  ({ path: `diff:${path}:${staged ? 'staged' : 'unstaged'}`, isDiff: true, gitFile: { path, staged } });
/** What the window has open: three diffs of the repository's changed files, a file, and a pull request's diff */
const OPEN = [
  aDiffTab('a.ts'), aDiffTab('a.ts', true), aDiffTab('b.ts'),
  { path: '/repo/a.ts' },
  { path: 'pr-diff:a.ts', isDiff: true, isPrDiff: true, gitFile: { path: 'a.ts', staged: false } },
];
/** The diffs the panel asked the backend to read, in order */
const diffsAsked = () => sendToSystem.mock.calls
  .map(([, event]) => event as { type: string; path: string; staged: boolean })
  .filter(event => event.type === 'commit.GET_GIT_DIFF')
  .map(event => `${event.path}:${event.staged ? 'staged' : 'unstaged'}`);

it('reads again the diffs the window has open of the files whose diff changed, and no other', () => {
  getParentContext.mockReturnValue({ openFiles: OPEN });

  told({ diffs: true, files: ['a.ts'] });

  expect(diffsAsked()).toEqual(['a.ts:unstaged', 'a.ts:staged']);
});

it('reads again every diff the window has open when the news names no file', () => {
  getParentContext.mockReturnValue({ openFiles: OPEN });

  told({ diffs: true });

  expect(diffsAsked()).toEqual(['a.ts:unstaged', 'a.ts:staged', 'b.ts:unstaged']);
});

it('reads no diff when none changed', () => {
  getParentContext.mockReturnValue({ openFiles: OPEN });

  expect(told({ status: true, history: true })).toEqual(['commit.GET_GIT_STATUS', 'commit.LOG_LIST']);
});
