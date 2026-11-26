// What the panel holds was read from one folder. When the code surface starts over another, what the first
// was read as, the refusal git gave there and the discard it offered to undo are gone; starting again over the same folder,
// as a reconnect does, keeps them.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const trust = { repository: '/work/one/.git', asks: [{ kind: 'hook' as const, name: 'pre-commit', file: '/work/one/.git/hooks/pre-commit' }] };

/** A panel over `/work/one` holding a refusal and an undone discard that left a file */
async function held() {
  const h = startCommit({ directory: null });
  running.push(h);
  h.send({ type: 'CODE_STARTED', directory: '/work/one' });
  h.send({ type: 'commit.REVERT_FILES', paths: ['a.txt', 'b.txt'] });
  await h.latestAsk('commit.REVERT_FILES').answer({ paths: ['a.txt', 'b.txt'], kept: { id: 'abc123', notKept: [] } });
  h.send({ type: 'commit.UNDO_DISCARD' });
  await h.latestAsk('commit.RESTORE_DISCARDED').answer({ id: 'abc123', restored: ['a.txt'], left: ['b.txt'] });
  await h.latestAsk('commit.GET_GIT_STATUS').refuse('Not trusted.', { kind: 'git', code: 'untrusted', trust });
  return h;
}

it('keeps what it holds when the surface starts again over the same folder', async () => {
  const h = await held();

  h.send({ type: 'CODE_STARTED', directory: '/work/one' });

  expect(h.recovery().data.discardLeft).toEqual(['b.txt']);
  expect(h.open().data).toMatchObject({ gitError: 'Not trusted.', gitFailure: { trust } });
});

it('drops the refusal and the discard of one folder when the surface starts over another', async () => {
  const h = await held();

  h.send({ type: 'CODE_STARTED', directory: '/work/two' });

  expect(h.open().data).toMatchObject({
    gitStatus: [], gitError: null, gitFailure: null, gitBranch: '', hasUpstream: true,
  });
  expect(h.recovery().data).toMatchObject({ discardLeft: [], lastDiscard: null });
  expect(h.remotes().data.availableBranches).toEqual([]);
  expect(h.history().data.commitLog).toEqual([]);
});
