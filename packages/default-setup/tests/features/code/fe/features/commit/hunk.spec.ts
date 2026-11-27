// Staging one piece of a file's change from its diff: the panel has git do it, and is busy until git answers
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

const PIECE = { type: 'commit.APPLY_HUNK', path: 'a.txt', staged: false, hunk: 'a piece' } as const;

it('has git stage the piece, and is busy with it until git says it is done', async () => {
  const h = open();

  h.send(PIECE);

  expect(h.latestAsk('commit.APPLY_HUNK').event).toEqual(PIECE);
  expect(h.open().pending.hunk).toBe(true);

  await h.latestAsk('commit.APPLY_HUNK').answer({ path: 'a.txt', staged: false, hunk: 'a piece' });
  expect(h.open().pending.hunk).toBe(false);
});

it('is no longer busy, and says why, when git refuses the piece', async () => {
  const h = open();
  h.send(PIECE);

  await h.latestAsk('commit.APPLY_HUNK').refuse('The file has changed since this change was read.', { kind: 'git' });

  expect(h.open().pending.hunk).toBe(false);
  expect(h.open().data.gitError).toBe('The file has changed since this change was read.');
});

it('holds a piece as done from when git stages it until a diff is read again', async () => {
  const h = open();
  h.send(PIECE);

  await h.latestAsk('commit.APPLY_HUNK').answer({ path: 'a.txt', staged: false, hunk: 'a piece' });
  expect(h.root().data.appliedHunks).toEqual({ 'diff:a.txt:unstaged': ['a piece'] });

  h.send({ type: 'commit.VIEW_DIFF', path: 'a.txt', staged: false });
  await h.latestAsk('commit.GET_GIT_DIFF').answer({ path: 'a.txt', staged: false, originalContent: '', modifiedContent: '', hunks: [] });
  expect(h.root().data.appliedHunks).toEqual({});
});
