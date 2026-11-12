// The panel asks for its branches, stashes, worktrees and commits when the code surface starts over a folder, and
// the backend answers every ask. An answer to an ask made over the folder that was open before is of that folder:
// only the answer to the latest ask of each list is shown.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
const parent = vi.hoisted(() => ({ baseDirectory: '/work/one' }));
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => parent),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => {
  sendToSystem.mockReset();
  parent.baseDirectory = '/work/one';
});

const stash = (of: string) => ({ index: 0, ref: 'stash@{0}', message: of, date: '' });
const worktree = (of: string) => ({ path: of, head: 'abc', branch: 'main', isBare: false, isCurrent: true, isMain: true, isLocked: false });
const commit = (of: string) => ({ hash: of, shortHash: of, subject: of, body: '', authorName: '', authorEmail: '', date: '', refs: '' });

/** Each list: the event that asks for it, where the panel holds it, and an answer naming what it is of */
const LISTS = [
  { ask: 'commit.GET_ALL_BRANCHES', held: 'availableBranches', answer: (of: string) => ({ type: 'commit.BRANCHES_RECEIVED' as const, data: { branches: [of] } }), shown: (of: string): unknown[] => [of] },
  { ask: 'commit.STASH_LIST', held: 'stashList', answer: (of: string) => ({ type: 'commit.STASH_LIST_RECEIVED' as const, data: { stashes: [stash(of)] } }), shown: (of: string): unknown[] => [stash(of)] },
  { ask: 'commit.WORKTREE_LIST', held: 'worktreeList', answer: (of: string) => ({ type: 'commit.WORKTREE_LIST_RECEIVED' as const, data: { worktrees: [worktree(of)] } }), shown: (of: string): unknown[] => [worktree(of)] },
  { ask: 'commit.LOG_LIST', held: 'commitLog', answer: (of: string) => ({ type: 'commit.LOG_LIST_RECEIVED' as const, data: { commits: [commit(of)] } }), shown: (of: string): unknown[] => [commit(of)] },
] as const;

it.each(LISTS)('shows what answers the latest $ask, and not the answer to the one made over the folder before', ({ ask, held, answer, shown }) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'CODE_STARTED' });
  const overOne = sentCall(sendToSystem, ask, 0);

  parent.baseDirectory = '/work/two';
  actor.send({ type: 'CODE_STARTED' });
  const overTwo = sentCall(sendToSystem, ask, 1);

  // The first folder's answer arrives once the second is open
  actor.send(answerTo(overOne, answer('one')));
  expect(actor.getSnapshot().context[held], 'the answer of the folder before is not shown').toEqual([]);

  actor.send(answerTo(overTwo, answer('two')));
  expect(actor.getSnapshot().context[held]).toEqual(shown('two'));
});

it.each(LISTS)('shows nothing for a $ask answer that answers no ask of this panel', ({ held, answer }) => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'CODE_STARTED' });

  actor.send(answer('elsewhere'));

  expect(actor.getSnapshot().context[held]).toEqual([]);
});
