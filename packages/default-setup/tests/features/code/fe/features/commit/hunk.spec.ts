// Staging one piece of a file's change from its diff: the panel has git do it, and is busy until git answers
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { askFailed } from '@apackdev/sdk/testing';
import { sentCall } from '../../../../../_support/calls.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(() => sendToSystem.mockReset());

const PIECE = { type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'a piece' } as const;

it('has git stage the piece, and is busy with it until git says it is done', () => {
  const actor = createActor(commitState).start();

  actor.send(PIECE);

  expect(sendToSystem).toHaveBeenCalledWith('code', PIECE, { call: expect.any(String) });
  expect(actor.getSnapshot().context.isApplyingHunk).toBe(true);

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.APPLY_HUNK' as const, answer: { path: 'a.txt', staged: false, hunk: 'a piece' } });
  expect(actor.getSnapshot().context.isApplyingHunk).toBe(false);
});

it('is no longer busy, and says why, when git refuses the piece', () => {
  const actor = createActor(commitState).start();
  actor.send(PIECE);

  actor.send(askFailed(sentCall(sendToSystem, 'commit.APPLY_HUNK'), 'commit.APPLY_HUNK', { kind: 'git', message: 'The file has changed since this change was read.' }));

  expect(actor.getSnapshot().context).toMatchObject({ isApplyingHunk: false, gitError: 'The file has changed since this change was read.' });
});

// The tab's diff is read again a moment after a piece is staged, and until then it still lists that piece
it('holds a piece as done from when git stages it until a diff is read again', () => {
  const actor = createActor(commitState).start();
  actor.send(PIECE);

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.APPLY_HUNK' as const, answer: { path: 'a.txt', staged: false, hunk: 'a piece' } });
  expect(actor.getSnapshot().context.appliedHunks).toEqual({ 'diff:a.txt:unstaged': ['a piece'] });

  actor.send({ type: 'ASK_ANSWERED' as const, asked: 'commit.GET_GIT_DIFF' as const, answer: { path: 'a.txt', staged: false, originalContent: '', modifiedContent: '', hunks: [] } });
  expect(actor.getSnapshot().context.appliedHunks).toEqual({});
});
