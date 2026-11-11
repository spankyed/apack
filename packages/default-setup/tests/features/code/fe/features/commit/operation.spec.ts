// Git can be stopped in the middle of a merge, a rebase, a cherry-pick or a revert. The commit panel says so from
// the status it is sent, and has git carry on with it, skip a commit or give it up.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');
type RepositoryOperation = import('#features/code/be/types.ts').RepositoryOperation;

beforeEach(() => sendToSystem.mockReset());

const MERGE: RepositoryOperation = { kind: 'merge', subject: 'side' };
/** A panel that has been sent a status holding this operation */
function panelTold(operation?: RepositoryOperation) {
  const actor = createActor(commitState).start();
  actor.send({ type: 'commit.REFRESH_STATUS' });
  const [, , { call }] = sendToSystem.mock.calls.at(-1) as [string, object, { call: string }];
  actor.send(answerTo(call, {
    type: 'commit.STATUS_RECEIVED' as const,
    data: { files: [], truncated: false, branch: 'main', hasUpstream: false, commitsAhead: 0, commitsBehind: 0, watching: true, operation },
  }));
  return actor;
}

it('holds what git is in the middle of, and nothing when the status names nothing', () => {
  expect(panelTold(MERGE).getSnapshot().context.operation).toEqual(MERGE);
  expect(panelTold().getSnapshot().context.operation).toBeNull();
});

it('has git move it on, and is busy with that until git answers', () => {
  const actor = panelTold(MERGE);

  actor.send({ type: 'commit.MOVE_OPERATION', move: 'continue' });
  expect(sendToSystem).toHaveBeenLastCalledWith('code', { type: 'commit.MOVE_OPERATION', move: 'continue' });
  expect(actor.getSnapshot().context.isMovingOperation).toBe(true);

  actor.send({ type: 'commit.OPERATION_MOVED', data: { move: 'continue' } });
  expect(actor.getSnapshot().context.isMovingOperation).toBe(false);
});

it('says why when git could not, and is no longer busy', () => {
  const actor = panelTold(MERGE);
  actor.send({ type: 'commit.MOVE_OPERATION', move: 'continue' });

  actor.send({ type: 'commit.ERROR_RECEIVED', data: { message: 'you have unmerged files' } });

  expect(actor.getSnapshot().context).toMatchObject({ isMovingOperation: false, gitError: 'you have unmerged files', operation: MERGE });
});
