// What the panel waits on belongs to the folder, the tab, the stash list or the history it was asked of. A folder
// change leaves nothing busy and no write outstanding; an open diff takes only the answer to its latest ask; a
// piece staged from one diff is held in that diff's tab alone; a stash's files go when the list moves; and a file's
// history is asked for again as that file's.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { askAnswered } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
const parent = vi.hoisted(() => ({ baseDirectory: '/work/one', openFiles: [] as object[] }));
const sendEventToParent = vi.hoisted(() => vi.fn());
const addTabToParent = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent,
  updateParentState: vi.fn(),
  sendEventToParent,
  getParentContext: vi.fn(() => parent),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => {
  sendToSystem.mockReset();
  sendEventToParent.mockReset();
  addTabToParent.mockReset();
  parent.baseDirectory = '/work/one';
  parent.openFiles = [];
});

const sentOf = (type: string) => sendToSystem.mock.calls.filter(([, event]) => (event as { type: string }).type === type);
const lastCall = (type: string) => sentCall(sendToSystem, type, sentOf(type).length - 1);

it('leaves nothing busy and no write outstanding when the surface starts over another folder', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'CODE_STARTED' });
  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.STASH_PUSH' });
  actor.send({ type: 'commit.WORKTREE_SWITCH', path: '/work/one-wt' });
  actor.send({ type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'a piece' });
  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.txt'] });

  parent.baseDirectory = '/work/two';
  actor.send({ type: 'CODE_STARTED' });

  expect(actor.getSnapshot().context).toMatchObject({
    isPushing: false, isStashing: false, isWorktreeLoading: false, isApplyingHunk: false, busyAsks: {},
  });
  // The new folder's status is shown: no write of the folder before is waited on
  actor.send(askAnswered(lastCall('commit.GET_GIT_STATUS'), 'commit.GET_GIT_STATUS', { files: [{ path: 'b.txt', status: 'modified' as const, staged: false }], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 0, commitsBehind: 0, watching: true }));
  expect(actor.getSnapshot().context.gitStatus.map(file => file.path)).toEqual(['b.txt']);
});

it('takes only the answer to the latest ask for an open diff', () => {
  parent.openFiles = [{ path: 'diff:a.txt:unstaged', isDiff: true, gitFile: { path: 'a.txt', staged: false } }];
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  const [older, newer] = [sentCall(sendToSystem, 'commit.GET_GIT_DIFF', 0), sentCall(sendToSystem, 'commit.GET_GIT_DIFF', 1)];
  const diff = (modifiedContent: string) => ({ path: 'a.txt', staged: false, originalContent: '', modifiedContent });

  actor.send(askAnswered(newer, 'commit.GET_GIT_DIFF', diff('newer')));
  actor.send(askAnswered(older, 'commit.GET_GIT_DIFF', diff('older')));

  expect(sendEventToParent.mock.calls.map(([, event]) => event.diff.modifiedContent)).toEqual(['newer']);
  expect(addTabToParent).not.toHaveBeenCalled();
});

it('holds a piece staged from one diff in that diff\'s tab, through another file\'s diff being read', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'h1' });
  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.APPLY_HUNK' as const, answer: { path: 'a.txt', staged: false, hunk: 'h1' } });

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.GET_GIT_DIFF' as const, answer: { path: 'b.txt', staged: false, originalContent: '', modifiedContent: '' } });

  expect(actor.getSnapshot().context.appliedHunks, 'and not in the same file\'s staged diff').toEqual({ 'diff:a.txt:unstaged': ['h1'] });
});

/** A stash list answering the latest ask for one */
function stashesListed(actor: ReturnType<typeof createActor<typeof commitState>>, messages: string[]) {
  actor.send({ type: 'commit.STASH_LIST' });
  actor.send(askAnswered(lastCall('commit.STASH_LIST'), 'commit.STASH_LIST', { stashes: messages.map((message, index) => ({ index, ref: `stash@{${index}}`, message, date: `2026-11-1${index}` })) }));
}
const files = (path: string) => [{ path, status: 'modified' }] as never;

it('lets go of a stash\'s files once the list moves, and of an answer asked of the list before', () => {
  const actor = createActor(commitState).start();
  stashesListed(actor, ['first', 'second']);
  actor.send({ type: 'commit.TOGGLE_STASH_FILES', index: 0 });
  actor.send(askAnswered(lastCall('commit.GET_STASH_CHANGES'), 'commit.GET_STASH_CHANGES', { index: 0, files: files('first.txt') }));
  actor.send({ type: 'commit.TOGGLE_STASH_FILES', index: 1 });
  const askedBefore = lastCall('commit.GET_STASH_CHANGES');

  // The first stash is dropped: the second is at index 0 now
  stashesListed(actor, ['second']);
  actor.send(askAnswered(askedBefore, 'commit.GET_STASH_CHANGES', { index: 1, files: files('second.txt') }));

  expect(actor.getSnapshot().context.stashFiles).toEqual({});
});

it('keeps a stash\'s files open when the list is read again unchanged', () => {
  const actor = createActor(commitState).start();
  stashesListed(actor, ['first']);
  actor.send({ type: 'commit.TOGGLE_STASH_FILES', index: 0 });
  actor.send(askAnswered(lastCall('commit.GET_STASH_CHANGES'), 'commit.GET_STASH_CHANGES', { index: 0, files: files('first.txt') }));

  stashesListed(actor, ['first']);

  expect(actor.getSnapshot().context.stashFiles).toEqual({ 0: files('first.txt') });
});

it('asks for a file\'s history again as that file\'s when the history moves, and shows the answer', () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });
  actor.send({ type: 'commit.SHOW_FILE_HISTORY', path: 'a.txt' });

  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { status: false, diffs: false, history: true, stashes: false, refs: false, worktrees: false } });

  expect(sentOf('commit.LOG_LIST').at(-1)![1]).toEqual({ type: 'commit.LOG_LIST', path: 'a.txt' });
  const commit = { hash: 'abc', parents: [], subject: 'edit a', authorName: 'A', authorEmail: 'a@x', date: '2026-11-14', refs: [] };
  actor.send(askAnswered(lastCall('commit.LOG_LIST'), 'commit.LOG_LIST', { commits: [commit], path: 'a.txt' }));
  expect(actor.getSnapshot().context.commitLog).toEqual([commit]);
});
