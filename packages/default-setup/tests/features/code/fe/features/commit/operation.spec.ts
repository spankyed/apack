// Git can be stopped in the middle of a merge, a rebase, a cherry-pick or a revert. The commit panel says so from
// the status it is sent, and has git carry on with it, skip a commit or give it up.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');
type RepositoryOperation = import('#features/code/be/types.ts').RepositoryOperation;

beforeEach(resetAsks);

const MERGE: RepositoryOperation = { kind: 'merge', subject: 'side' };
/** A panel that has been sent a status holding this operation */
async function panelTold(operation?: RepositoryOperation, fetchSuspended?: boolean) {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  await latestAsk('commit.GET_GIT_STATUS').answer({ files: [], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true, operation, fetchSuspended });
  return actor;
}

it('holds whether fetching by itself has stopped, as the status says', async () => {
  expect((await panelTold(undefined, true)).getSnapshot().context.isFetchSuspended).toBe(true);
  expect((await panelTold()).getSnapshot().context.isFetchSuspended).toBe(false);
});

it('holds what git is in the middle of, and nothing when the status names nothing', async () => {
  expect((await panelTold(MERGE)).getSnapshot().context.operation).toEqual(MERGE);
  expect((await panelTold()).getSnapshot().context.operation).toBeNull();
});

it('has git move it on, and is busy with that until git answers', async () => {
  const actor = await panelTold(MERGE);

  actor.send({ type: 'commit.MOVE_OPERATION', move: 'continue' });
  expect(latestAsk('commit.MOVE_OPERATION').event).toEqual({ type: 'commit.MOVE_OPERATION', move: 'continue' });
  expect(actor.getSnapshot().context.making.moveOperation).toBe(true);

  await latestAsk('commit.MOVE_OPERATION').answer({ move: 'continue' });
  expect(actor.getSnapshot().context.making.moveOperation).toBe(false);
});

it('says why when git could not, and is no longer busy', async () => {
  const actor = await panelTold(MERGE);
  actor.send({ type: 'commit.MOVE_OPERATION', move: 'continue' });

  await latestAsk('commit.MOVE_OPERATION').refuse('you have unmerged files', { kind: 'git' });

  expect(actor.getSnapshot().context.making.moveOperation).toBe(false);
  expect(actor.getSnapshot().context).toMatchObject({ gitError: 'you have unmerged files', operation: MERGE });
});
