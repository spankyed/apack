// Git can be stopped in the middle of a merge, a rebase, a cherry-pick or a revert. The commit panel says so from
// the status it is sent, and has git carry on with it, skip a commit or give it up.
import { afterEach, expect, it } from 'vitest';
import type { RepositoryOperation } from '#features/code/be/types.ts';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const MERGE: RepositoryOperation = { kind: 'merge', subject: 'side' };

async function panelTold(operation?: RepositoryOperation, fetchSuspended?: boolean) {
  const h = startCommit();
  running.push(h);
  h.send({ type: 'commit.REFRESH_STATUS' });
  await h.latestAsk('commit.GET_GIT_STATUS').answer({
    files: [], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true, operation, fetchSuspended,
  });
  return h;
}

it('holds whether fetching by itself has stopped, as the status says', async () => {
  expect((await panelTold(undefined, true)).open().data.isFetchSuspended).toBe(true);
  expect((await panelTold()).open().data.isFetchSuspended).toBe(false);
});

it('holds what git is in the middle of, and nothing when the status names nothing', async () => {
  expect((await panelTold(MERGE)).open().data.operation).toEqual(MERGE);
  expect((await panelTold()).open().data.operation).toBeNull();
});

it('has git move it on, and is busy with that until git answers', async () => {
  const h = await panelTold(MERGE);

  h.send({ type: 'commit.MOVE_OPERATION', move: 'continue' });
  expect(h.latestAsk('commit.MOVE_OPERATION').event).toEqual({ type: 'commit.MOVE_OPERATION', move: 'continue' });
  expect(h.remotes().pending.moveOperation).toBe(true);

  await h.latestAsk('commit.MOVE_OPERATION').answer({ move: 'continue' });
  expect(h.remotes().pending.moveOperation).toBe(false);
});

it('says why when git could not, and is no longer busy', async () => {
  const h = await panelTold(MERGE);
  h.send({ type: 'commit.MOVE_OPERATION', move: 'continue' });

  await h.latestAsk('commit.MOVE_OPERATION').refuse('you have unmerged files', { kind: 'git' });

  expect(h.remotes().pending.moveOperation).toBe(false);
  expect(h.open().data).toMatchObject({ gitError: 'you have unmerged files', operation: MERGE });
});
