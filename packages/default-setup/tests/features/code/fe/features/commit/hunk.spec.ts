// Staging one piece of a file's change from its diff: the panel has git do it, and is busy until git answers
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

beforeEach(resetAsks);

const PIECE = { type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'a piece' } as const;

it('has git stage the piece, and is busy with it until git says it is done', async () => {
  const actor = createActor(commitState).start();

  actor.send(PIECE);

  expect(latestAsk('commit.APPLY_HUNK').event).toEqual(PIECE);
  expect(actor.getSnapshot().context.making.hunk).toBe(true);

  await latestAsk('commit.APPLY_HUNK').answer({ path: 'a.txt', staged: false, hunk: 'a piece' });
  expect(actor.getSnapshot().context.making.hunk).toBe(false);
});

it('is no longer busy, and says why, when git refuses the piece', async () => {
  const actor = createActor(commitState).start();
  actor.send(PIECE);

  await latestAsk('commit.APPLY_HUNK').refuse('The file has changed since this change was read.', { kind: 'git' });

  expect(actor.getSnapshot().context.making.hunk).toBe(false);
  expect(actor.getSnapshot().context.gitError).toBe('The file has changed since this change was read.');
});

// The tab's diff is read again a moment after a piece is staged, and until then it still lists that piece
it('holds a piece as done from when git stages it until a diff is read again', async () => {
  const actor = createActor(commitState).start();
  actor.send(PIECE);

  await latestAsk('commit.APPLY_HUNK').answer({ path: 'a.txt', staged: false, hunk: 'a piece' });
  expect(actor.getSnapshot().context.appliedHunks).toEqual({ 'diff:a.txt:unstaged': ['a piece'] });

  actor.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  await latestAsk('commit.GET_GIT_DIFF').answer({ path: 'a.txt', staged: false, originalContent: '', modifiedContent: '', hunks: [] });
  expect(actor.getSnapshot().context.appliedHunks).toEqual({});
});
