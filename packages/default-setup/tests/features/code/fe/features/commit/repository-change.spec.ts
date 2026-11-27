// The news that a repository changed says which parts of it did, and the commit panel asks again for those
// alone. An edited file changes the status; reading the log, the stashes and the worktrees again for it is three
// git processes in every window that nobody needs. A diff is read when its tab opens, so the diffs the window
// has open are read again too, when the news says theirs changed.
import { afterEach, expect, it } from 'vitest';
import type { OpenDiffRef } from '#features/code/fe/features/commit/state.ts';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const NOTHING = { status: false, diffs: false, history: false, stashes: false, worktrees: false, refs: false };

const aDiffRef = (path: string, staged = false): OpenDiffRef => ({
  tab: `diff:${path}:${staged ? 'staged' : 'unstaged'}`,
  path,
  staged,
});

const OPEN: OpenDiffRef[] = [aDiffRef('a.ts'), aDiffRef('a.ts', true), aDiffRef('b.ts')];

const asked = (h: CommitHarness) => h.made.map((ask) => ask.event.type);
const diffsAsked = (h: CommitHarness) =>
  h.made
    .map((ask) => ask.event as { type: string; path: string; staged: boolean })
    .filter((event) => event.type === 'commit.GET_GIT_DIFF')
    .map((event) => `${event.path}:${event.staged ? 'staged' : 'unstaged'}`);

const told = (changed: Partial<typeof NOTHING> & { files?: string[] }, openDiffs: OpenDiffRef[] = []) => {
  const h = startCommit({ openDiffs });
  running.push(h);
  h.send({ type: 'commit.SHOWN' });
  h.reset();
  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, ...changed } });
  return h;
};

it('asks for the status alone when only the status changed', () => {
  expect(asked(told({ status: true }))).toEqual(['commit.GET_GIT_STATUS']);
});

it('asks for each list whose part changed', () => {
  expect(asked(told({ history: true }))).toEqual(['commit.LOG_LIST']);
  expect(asked(told({ stashes: true }))).toEqual(['commit.STASH_LIST']);
  expect(asked(told({ worktrees: true }))).toEqual(['commit.WORKTREE_LIST']);
  expect(new Set(asked(told({ status: true, history: true, stashes: true, worktrees: true }))))
    .toEqual(new Set(['commit.GET_GIT_STATUS', 'commit.LOG_LIST', 'commit.STASH_LIST', 'commit.WORKTREE_LIST']));
});

it('reads again the diffs the window has open of the files whose diff changed, and no other', () => {
  const h = told({ diffs: true, files: ['a.ts'] }, OPEN);
  expect(diffsAsked(h)).toEqual(['a.ts:unstaged', 'a.ts:staged']);
});

it('reads again every diff the window has open when the news names no file', () => {
  const h = told({ diffs: true }, OPEN);
  expect(diffsAsked(h)).toEqual(['a.ts:unstaged', 'a.ts:staged', 'b.ts:unstaged']);
});

it('reads no diff when none changed', () => {
  const h = told({ status: true, history: true }, OPEN);
  expect(new Set(asked(h))).toEqual(new Set(['commit.GET_GIT_STATUS', 'commit.LOG_LIST']));
});

it('reads again an open diff of a file inside a folder the news names', () => {
  const h = told({ diffs: true, files: ['src/new/'] }, [aDiffRef('src/new/a.ts'), aDiffRef('src/newer/b.ts'), aDiffRef('b.ts')]);
  expect(diffsAsked(h)).toEqual(['src/new/a.ts:unstaged']);
});

it('asks nothing while the window does not show the code surface, and asks for all that changed when it does', () => {
  const h = startCommit({ openDiffs: OPEN });
  running.push(h);

  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, status: true, diffs: true, files: ['a.ts'] } });
  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, history: true, diffs: true, files: ['b.ts'] } });
  expect(asked(h), 'not shown').toEqual([]);

  h.send({ type: 'commit.SHOWN' });
  expect(new Set(asked(h).filter((type) => type !== 'commit.GET_GIT_DIFF'))).toEqual(new Set(['commit.GET_GIT_STATUS', 'commit.LOG_LIST']));
  expect(diffsAsked(h)).toEqual(['a.ts:unstaged', 'a.ts:staged', 'b.ts:unstaged']);

  h.reset();
  h.send({ type: 'commit.HIDDEN' });
  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { ...NOTHING, status: true } });
  expect(asked(h), 'hidden again').toEqual([]);
  h.send({ type: 'commit.SHOWN' });
  h.send({ type: 'commit.SHOWN' });
  expect(asked(h), 'what was missed is asked about once').toEqual(['commit.GET_GIT_STATUS']);
});

it('resets commitMessage and isGeneratingMessage on repo switch and close', () => {
  const h = startCommit({ directory: '/repo-a' });
  running.push(h);

  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'feat: repo a draft' });
  h.send({ type: 'commit.GENERATING_MESSAGE' });
  expect(h.read().data.commitMessage).toBe('feat: repo a draft');
  expect(h.read().data.isGeneratingMessage).toBe(true);

  // Switch to repo B: both message and generating flag must reset
  h.send({ type: 'CODE_STARTED', directory: '/repo-b' });
  expect(h.read().at).toBe('open');
  expect(h.read().data.commitMessage).toBe('');
  expect(h.read().data.isGeneratingMessage).toBe(false);

  // Set again, then close (no directory): both must reset
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'fix: repo b draft' });
  h.send({ type: 'commit.GENERATING_MESSAGE' });
  h.send({ type: 'CODE_STARTED', directory: '' });
  expect(h.read().at).toBe('closed');
  expect(h.read().data.commitMessage).toBe('');
  expect(h.read().data.isGeneratingMessage).toBe(false);
});
