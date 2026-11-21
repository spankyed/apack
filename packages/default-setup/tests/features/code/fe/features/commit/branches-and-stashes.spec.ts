// A branch is made only when the user asks for one: a checkout that found no branch shows the name, and making it
// is its own ask. A stash takes the commit message typed only when it was named with it; one applied or popped
// leaves the message alone.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { asksOf, latestAsk, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState, checkoutUnderWay } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);

it('shows the branch a checkout found nowhere, and makes it only when asked to', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: 'topic' });
  actor.send({ type: 'commit.CHECKOUT_BRANCH' });

  await latestAsk('commit.CHECKOUT_BRANCH').refuse('There is no branch named topic, here or on a remote.', { kind: 'git', code: 'unknown-ref', missingBranch: 'topic' });
  expect(checkoutUnderWay(actor.getSnapshot().context.making)).toBe(false);
  expect(actor.getSnapshot().context).toMatchObject({ gitFailure: { missingBranch: 'topic' } });
  expect(asksOf('commit.CREATE_BRANCH'), 'nothing made by itself').toEqual([]);

  actor.send({ type: 'commit.CREATE_BRANCH', branchName: 'topic' });

  expect(latestAsk('commit.CREATE_BRANCH').event).toEqual({ type: 'commit.CREATE_BRANCH', branchName: 'topic' });
  expect(actor.getSnapshot().context.making.createBranch).toBe(true);
  expect(actor.getSnapshot().context, 'the refusal it answers goes').toMatchObject({ gitError: null, gitFailure: null });
  await latestAsk('commit.CREATE_BRANCH').answer({ branchName: 'topic' });
  expect(checkoutUnderWay(actor.getSnapshot().context.making)).toBe(false);
});

it('keeps the commit message typed through a stash of one file, and gives it to a stash named with it', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix the thing' });

  actor.send({ type: 'commit.STASH_PUSH', message: 'src/a.ts', paths: ['src/a.ts'] });
  await latestAsk('commit.STASH_PUSH').answer({ message: 'Saved' });
  expect(actor.getSnapshot().context.making.stash).toBe(false);
  expect(actor.getSnapshot().context.commitMessage).toBe('Fix the thing');

  actor.send({ type: 'commit.STASH_PUSH', message: 'Fix the thing', stagedOnly: false });
  await latestAsk('commit.STASH_PUSH').answer({ message: 'Saved' });
  expect(actor.getSnapshot().context.commitMessage, 'the stash took the message').toBe('');
});

it('leaves the commit message typed when a stash is applied or popped', async () => {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix the thing' });

  actor.send({ type: 'commit.STASH_POP', index: 0 });
  await latestAsk('commit.STASH_POP').answer({ index: 0, popped: true });

  expect(actor.getSnapshot().context.commitMessage).toBe('Fix the thing');
});
