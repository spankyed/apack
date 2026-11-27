// What the panel waits on belongs to the folder, the tab, the stash list or the history it was asked of. A folder
// change leaves nothing busy and no write outstanding; an open diff takes only the answer to its latest ask; a
// piece staged from one diff is held in that diff's tab alone; a stash's files go when the list moves; and a file's
// history is asked for again as that file's.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
const open = (opts?: Parameters<typeof startCommit>[0]) => {
  const h = startCommit(opts);
  running.push(h);
  return h;
};
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

it('leaves nothing busy and no write outstanding when the surface starts over another folder', async () => {
  const h = open({ directory: null });
  h.send({ type: 'CODE_STARTED', directory: '/work/one' });
  h.send({ type: 'commit.PUSH_BRANCH' });
  h.send({ type: 'commit.STASH_PUSH' });
  h.send({ type: 'commit.WORKTREE_SWITCH', path: '/work/one-wt' });
  h.send({ type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'a piece' });
  h.send({ type: 'commit.STAGE_FILES', paths: ['a.txt'] });

  h.send({ type: 'CODE_STARTED', directory: '/work/two' });

  for (const ask of ['commit.PUBLISH_BRANCH', 'commit.STASH_PUSH', 'commit.WORKTREE_SWITCH', 'commit.APPLY_HUNK']) {
    expect(h.latestAsk(ask).stopped, `${ask} is waited on by nobody`).toBe(true);
  }
  expect(h.remotes().pending.push).toBe(false);
  expect(h.stashes().pending.stash).toBe(false);
  expect(h.worktrees().pending.worktreeSwitch).toBe(false);
  expect(h.open().pending.hunk).toBe(false);
  expect(h.latestAsk('commit.STAGE_FILES').stopped, 'the write made of the folder before is waited on by nobody').toBe(true);
  // The new folder's status is shown: no write of the folder before is waited on
  await h.latestAsk('commit.GET_GIT_STATUS').answer({
    files: [{ path: 'b.txt', status: 'modified' as const, staged: false }],
    truncated: false, branch: 'main', hasUpstream: true, commitsAhead: 0, commitsBehind: 0, watching: true,
  });
  expect(h.open().data.gitStatus.map((file) => file.path)).toEqual(['b.txt']);
});

it('takes only the answer to the latest ask for an open diff', async () => {
  const h = open({ openDiffs: [{ tab: 'diff:a.txt:unstaged', path: 'a.txt', staged: false }] });
  h.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  h.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  const [older, newer] = h.asksOf('commit.GET_GIT_DIFF');
  const diff = (modifiedContent: string) => ({ path: 'a.txt', staged: false, originalContent: '', modifiedContent });

  expect(older!.stopped, 'the ask before it is stopped, so its answer is never taken').toBe(true);
  await newer!.answer(diff('newer'));

  expect(h.reportsOf('REFRESH_DIFF_TAB').map((r) => (r as unknown as { diff: { modifiedContent: string } }).diff.modifiedContent)).toEqual(['newer']);
  expect(h.reportsOf('OPEN_DIFF_TAB')).toEqual([]);
});

it("holds a piece staged from one diff in that diff's tab, through another file's diff being read", async () => {
  const h = open();
  h.send({ type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'h1' });
  await h.latestAsk('commit.APPLY_HUNK').answer({ path: 'a.txt', staged: false, hunk: 'h1' });

  h.send({ type: 'commit.VIEW_DIFF', path: 'b.txt', staged: false });
  await h.latestAsk('commit.GET_GIT_DIFF').answer({ path: 'b.txt', staged: false, originalContent: '', modifiedContent: '' });

  expect(h.root().data.appliedHunks, "and not in the same file's staged diff").toEqual({ 'diff:a.txt:unstaged': ['h1'] });
});

async function stashesListed(h: CommitHarness, messages: string[]) {
  h.send({ type: 'commit.STASH_LIST' });
  await h.latestAsk('commit.STASH_LIST').answer({
    stashes: messages.map((message, index) => ({ index, ref: `stash@{${index}}`, message, date: `2026-11-1${index}` })),
  });
}
const files = (path: string) => [{ path, status: 'modified' }] as never;

it("lets go of a stash's files once the list moves, and of an ask made of the list before", async () => {
  const h = open();
  await stashesListed(h, ['first', 'second']);
  h.send({ type: 'commit.TOGGLE_STASH_FILES', index: 0 });
  await h.latestAsk('commit.GET_STASH_CHANGES').answer({ index: 0, files: files('first.txt') });
  h.send({ type: 'commit.TOGGLE_STASH_FILES', index: 1 });
  const askedBefore = h.latestAsk('commit.GET_STASH_CHANGES');

  // The first stash is dropped: the second is at index 0 now
  await stashesListed(h, ['second']);

  expect(askedBefore.stopped).toBe(true);
  expect(h.stashes().data.stashFiles).toEqual({});
});

it("keeps a stash's files open when the list is read again unchanged", async () => {
  const h = open();
  await stashesListed(h, ['first']);
  h.send({ type: 'commit.TOGGLE_STASH_FILES', index: 0 });
  await h.latestAsk('commit.GET_STASH_CHANGES').answer({ index: 0, files: files('first.txt') });

  await stashesListed(h, ['first']);

  expect(h.stashes().data.stashFiles).toEqual({ 0: files('first.txt') });
});

it("asks for a file's history again as that file's when the history moves, and shows the answer", async () => {
  const h = open();
  h.send({ type: 'commit.SHOWN' });
  h.send({ type: 'commit.SHOW_FILE_HISTORY', path: 'a.txt' });

  h.send({ type: 'commit.REPOSITORY_CHANGED', changed: { status: false, diffs: false, history: true, stashes: false, refs: false, worktrees: false } });

  expect(h.latestAsk('commit.LOG_LIST').event).toEqual({ type: 'commit.LOG_LIST', path: 'a.txt' });
  const commit = { hash: 'abc', parents: [], subject: 'edit a', authorName: 'A', authorEmail: 'a@x', date: '2026-11-14', refs: [] };
  await h.latestAsk('commit.LOG_LIST').answer({ commits: [commit], path: 'a.txt' });
  expect(h.history().data.commitLog).toEqual([commit]);
});
