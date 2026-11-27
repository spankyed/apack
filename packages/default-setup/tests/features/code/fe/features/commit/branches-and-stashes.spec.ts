// A branch is made only when the user asks for one: a checkout that found no branch shows the name, and making it
// is its own ask. A stash takes the commit message typed only when it was named with it; one applied or popped
// leaves the message alone.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
const open = () => {
  const h = startCommit();
  running.push(h);
  return h;
};
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const checkoutUnderWay = (h: CommitHarness) =>
  Boolean(h.remotes().pending.checkout || h.remotes().pending.createBranch);

it('shows the branch a checkout found nowhere, and makes it only when asked to', async () => {
  const h = open();
  h.send({ type: 'commit.UPDATE_BRANCH_INPUT', input: 'topic' });
  h.send({ type: 'commit.CHECKOUT_BRANCH' });

  await h.latestAsk('commit.CHECKOUT_BRANCH').refuse('There is no branch named topic, here or on a remote.', { kind: 'git', code: 'unknown-ref', missingBranch: 'topic' });
  expect(checkoutUnderWay(h)).toBe(false);
  expect(h.open().data).toMatchObject({ gitFailure: { missingBranch: 'topic' } });
  expect(h.asksOf('commit.CREATE_BRANCH'), 'nothing made by itself').toEqual([]);

  h.send({ type: 'commit.CREATE_BRANCH', branchName: 'topic' });

  expect(h.latestAsk('commit.CREATE_BRANCH').event).toEqual({ type: 'commit.CREATE_BRANCH', branchName: 'topic' });
  expect(h.remotes().pending.createBranch).toBe(true);
  expect(h.open().data, 'the refusal it answers goes').toMatchObject({ gitError: null, gitFailure: null });
  await h.latestAsk('commit.CREATE_BRANCH').answer({ branchName: 'topic' });
  expect(checkoutUnderWay(h)).toBe(false);
});

it('keeps the commit message typed through a stash of one file, and gives it to a stash named with it', async () => {
  const h = open();
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix the thing' });

  h.send({ type: 'commit.STASH_PUSH', message: 'src/a.ts', paths: ['src/a.ts'] });
  await h.latestAsk('commit.STASH_PUSH').answer({ message: 'Saved' });
  expect(h.stashes().pending.stash).toBe(false);
  expect(h.root().data.commitMessage).toBe('Fix the thing');

  h.send({ type: 'commit.STASH_PUSH', message: 'Fix the thing', stagedOnly: false });
  await h.latestAsk('commit.STASH_PUSH').answer({ message: 'Saved' });
  expect(h.root().data.commitMessage, 'the stash took the message').toBe('');
});

it('leaves the commit message typed when a stash is applied or popped', async () => {
  const h = open();
  h.send({ type: 'commit.UPDATE_MESSAGE', message: 'Fix the thing' });

  h.send({ type: 'commit.STASH_POP', index: 0 });
  await h.latestAsk('commit.STASH_POP').answer({ index: 0, popped: true });

  expect(h.root().data.commitMessage).toBe('Fix the thing');
});
