// Each list the panel shows beside the status is read again when it is asked for: the read under way is stopped,
// so what is shown is always the answer to the latest ask, and never one made over the folder that was open before.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const stash = (of: string) => ({ index: 0, ref: 'stash@{0}', message: of, date: '' });
const worktree = (of: string) => ({ path: of, head: 'abc', branch: 'main', isBare: false, isCurrent: true, isMain: true, isLocked: false });
const commit = (of: string) => ({ hash: of, parents: [], subject: of, authorName: '', authorEmail: '', date: '', refs: [] });

const LISTS = [
  { ask: 'commit.GET_ALL_BRANCHES', read: (h: CommitHarness) => h.remotes().data.availableBranches, answer: (of: string) => ({ branches: [of] }), shown: (of: string): unknown[] => [of] },
  { ask: 'commit.STASH_LIST', read: (h: CommitHarness) => h.stashes().data.stashList, answer: (of: string) => ({ stashes: [stash(of)] }), shown: (of: string): unknown[] => [stash(of)] },
  { ask: 'commit.WORKTREE_LIST', read: (h: CommitHarness) => h.worktrees().data.worktreeList, answer: (of: string) => ({ worktrees: [worktree(of)] }), shown: (of: string): unknown[] => [worktree(of)] },
  { ask: 'commit.LOG_LIST', read: (h: CommitHarness) => h.history().data.commitLog, answer: (of: string) => ({ commits: [commit(of)] }), shown: (of: string): unknown[] => [commit(of)] },
] as const;

it.each(LISTS)('shows what answers the latest $ask, and stops waiting on the one made over the folder before', async ({ ask, read, answer, shown }) => {
  const h = startCommit({ directory: null });
  running.push(h);
  h.send({ type: 'CODE_STARTED', directory: '/work/one' });
  h.send({ type: 'CODE_STARTED', directory: '/work/two' });
  const [overOne, overTwo] = h.asksOf(ask);

  expect(overOne!.stopped).toBe(true);
  await overOne!.answer(answer('one'));
  expect(read(h), 'the answer of the folder before is not shown').toEqual([]);

  await overTwo!.answer(answer('two'));
  expect(read(h)).toEqual(shown('two'));
});

it.each(LISTS)('asks for $ask again in place of the read under way, whose answer is not waited on', async ({ ask, read, answer, shown }) => {
  const h = startCommit({ directory: null });
  running.push(h);
  h.send({ type: 'CODE_STARTED', directory: '/work/one' });
  h.send({ type: ask });
  const [earlier, latest] = h.asksOf(ask);

  expect(earlier!.stopped).toBe(true);
  await latest!.answer(answer('latest'));

  expect(read(h)).toEqual(shown('latest'));
});
