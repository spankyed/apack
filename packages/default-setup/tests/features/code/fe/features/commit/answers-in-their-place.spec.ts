// What the panel waits on belongs to the folder, the tab, the stash list or the history it was asked of. A folder
// change leaves nothing busy and no write outstanding; an open diff takes only the answer to its latest ask; a
// piece staged from one diff is held in that diff's tab alone; a stash's files go when the list moves; and a file's
// history is asked for again as that file's.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';

const parent = vi.hoisted(() => ({ baseDirectory: '/work/one', openFiles: [] as object[] }));
const sendEventToParent = vi.hoisted(() => vi.fn());
const addTabToParent = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent,
  updateParentState: vi.fn(),
  sendEventToParent,
  getParentContext: vi.fn(() => parent),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => {
  resetAsks();
  sendEventToParent.mockReset();
  addTabToParent.mockReset();
  parent.baseDirectory = '/work/one';
  parent.openFiles = [];
});


it('leaves nothing busy and no write outstanding when the surface starts over another folder', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'CODE_STARTED' });
  actor.send({ type: 'commit.PUSH_BRANCH' });
  actor.send({ type: 'commit.STASH_PUSH' });
  actor.send({ type: 'commit.WORKTREE_SWITCH', path: '/work/one-wt' });
  actor.send({ type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'a piece' });
  actor.send({ type: 'commit.STAGE_FILES', paths: ['a.txt'] });

  parent.baseDirectory = '/work/two';
  actor.send({ type: 'CODE_STARTED' });

  for (const ask of ['commit.PUBLISH_BRANCH', 'commit.STASH_PUSH', 'commit.WORKTREE_SWITCH', 'commit.APPLY_HUNK']) {
    expect(latestAsk(ask).stopped, `${ask} is waited on by nobody`).toBe(true);
  }
  expect(Object.keys(actor.getSnapshot().children).filter(id => ['push', 'stash', 'worktreeSwitch', 'hunk'].includes(id))).toEqual([]);
  expect(latestAsk('commit.STAGE_FILES').stopped, 'the write made of the folder before is waited on by nobody').toBe(true);
  // The new folder's status is shown: no write of the folder before is waited on
  await latestAsk('commit.GET_GIT_STATUS').answer({ files: [{ path: 'b.txt', status: 'modified' as const, staged: false }], truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 0, commitsBehind: 0, watching: true });
  expect(actor.getSnapshot().context.gitStatus.map(file => file.path)).toEqual(['b.txt']);
});

it('takes only the answer to the latest ask for an open diff', async () => {
  parent.openFiles = [{ path: 'diff:a.txt:unstaged', isDiff: true, gitFile: { path: 'a.txt', staged: false } }];
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  const [older, newer] = asksOf('commit.GET_GIT_DIFF');
  const diff = (modifiedContent: string) => ({ path: 'a.txt', staged: false, originalContent: '', modifiedContent });

  expect(older!.stopped, 'the ask before it is stopped, so its answer is never taken').toBe(true);
  await newer!.answer(diff('newer'));

  expect(sendEventToParent.mock.calls.map(([, event]) => event.diff.modifiedContent)).toEqual(['newer']);
  expect(addTabToParent).not.toHaveBeenCalled();
});

it('holds a piece staged from one diff in that diff\'s tab, through another file\'s diff being read', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'h1' });
  await latestAsk('commit.APPLY_HUNK').answer({ path: 'a.txt', staged: false, hunk: 'h1' });

  actor.send({ type: 'commit.VIEW_DIFF', path: 'b.txt', staged: false });
  await latestAsk('commit.GET_GIT_DIFF').answer({ path: 'b.txt', staged: false, originalContent: '', modifiedContent: '' });

  expect(actor.getSnapshot().context.appliedHunks, 'and not in the same file\'s staged diff').toEqual({ 'diff:a.txt:unstaged': ['h1'] });
});

/** A stash list answering the latest ask for one */
async function stashesListed(actor: ReturnType<typeof createActor<typeof commitState>>, messages: string[]) {
  actor.send({ type: 'commit.STASH_LIST' });
  await latestAsk('commit.STASH_LIST').answer({ stashes: messages.map((message, index) => ({ index, ref: `stash@{${index}}`, message, date: `2026-11-1${index}` })) });
}
const files = (path: string) => [{ path, status: 'modified' }] as never;

it('lets go of a stash\'s files once the list moves, and of an ask made of the list before', async () => {
  const actor = createActor(commitState).start();
  await stashesListed(actor, ['first', 'second']);
  actor.send({ type: 'commit.TOGGLE_STASH_FILES', index: 0 });
  await latestAsk('commit.GET_STASH_CHANGES').answer({ index: 0, files: files('first.txt') });
  actor.send({ type: 'commit.TOGGLE_STASH_FILES', index: 1 });
  const askedBefore = latestAsk('commit.GET_STASH_CHANGES');

  // The first stash is dropped: the second is at index 0 now
  await stashesListed(actor, ['second']);

  expect(askedBefore.stopped).toBe(true);
  expect(actor.getSnapshot().context.stashFiles).toEqual({});
});

it('keeps a stash\'s files open when the list is read again unchanged', async () => {
  const actor = createActor(commitState).start();
  await stashesListed(actor, ['first']);
  actor.send({ type: 'commit.TOGGLE_STASH_FILES', index: 0 });
  await latestAsk('commit.GET_STASH_CHANGES').answer({ index: 0, files: files('first.txt') });

  await stashesListed(actor, ['first']);

  expect(actor.getSnapshot().context.stashFiles).toEqual({ 0: files('first.txt') });
});

it('asks for a file\'s history again as that file\'s when the history moves, and shows the answer', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.SHOWN' });
  actor.send({ type: 'commit.SHOW_FILE_HISTORY', path: 'a.txt' });

  actor.send({ type: 'commit.REPOSITORY_CHANGED', changed: { status: false, diffs: false, history: true, stashes: false, refs: false, worktrees: false } });

  expect(latestAsk('commit.LOG_LIST').event).toEqual({ type: 'commit.LOG_LIST', path: 'a.txt' });
  const commit = { hash: 'abc', parents: [], subject: 'edit a', authorName: 'A', authorEmail: 'a@x', date: '2026-11-14', refs: [] };
  await latestAsk('commit.LOG_LIST').answer({ commits: [commit], path: 'a.txt' });
  expect(actor.getSnapshot().context.commitLog).toEqual([commit]);
});
