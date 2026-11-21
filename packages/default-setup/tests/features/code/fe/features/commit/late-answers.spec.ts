// Each list the panel shows beside the status is read again when it is asked for: the read under way is stopped,
// so what is shown is always the answer to the latest ask, and never one made over the folder that was open before.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, resetAsks } from '../../_support/asks.ts';

const parent = vi.hoisted(() => ({ baseDirectory: '/work/one' }));
vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => parent),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => {
  resetAsks();
  parent.baseDirectory = '/work/one';
});

const stash = (of: string) => ({ index: 0, ref: 'stash@{0}', message: of, date: '' });
const worktree = (of: string) => ({ path: of, head: 'abc', branch: 'main', isBare: false, isCurrent: true, isMain: true, isLocked: false });
const commit = (of: string) => ({ hash: of, parents: [], subject: of, authorName: '', authorEmail: '', date: '', refs: [] });

/** Each list: the ask made for it, where the panel holds it, and an answer naming what it is of */
const LISTS = [
  { ask: 'commit.GET_ALL_BRANCHES', held: 'availableBranches', answer: (of: string) => ({ branches: [of] }), shown: (of: string): unknown[] => [of] },
  { ask: 'commit.STASH_LIST', held: 'stashList', answer: (of: string) => ({ stashes: [stash(of)] }), shown: (of: string): unknown[] => [stash(of)] },
  { ask: 'commit.WORKTREE_LIST', held: 'worktreeList', answer: (of: string) => ({ worktrees: [worktree(of)] }), shown: (of: string): unknown[] => [worktree(of)] },
  { ask: 'commit.LOG_LIST', held: 'commitLog', answer: (of: string) => ({ commits: [commit(of)] }), shown: (of: string): unknown[] => [commit(of)] },
] as const;

it.each(LISTS)('shows what answers the latest $ask, and stops waiting on the one made over the folder before', async ({ ask, held, answer, shown }) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'CODE_STARTED' });

  parent.baseDirectory = '/work/two';
  actor.send({ type: 'CODE_STARTED' });
  const [overOne, overTwo] = asksOf(ask);

  // The first folder's read is stopped once the second is open, so what it finds is shown by nobody
  expect(overOne!.stopped).toBe(true);
  await overOne!.answer(answer('one'));
  expect(actor.getSnapshot().context[held], 'the answer of the folder before is not shown').toEqual([]);

  await overTwo!.answer(answer('two'));
  expect(actor.getSnapshot().context[held]).toEqual(shown('two'));
});

it.each(LISTS)('asks for $ask again in place of the read under way, whose answer is not waited on', async ({ ask, held, answer, shown }) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'CODE_STARTED' });
  actor.send({ type: ask });
  const [earlier, latest] = asksOf(ask);

  expect(earlier!.stopped).toBe(true);
  await latest!.answer(answer('latest'));

  expect(actor.getSnapshot().context[held]).toEqual(shown('latest'));
});
