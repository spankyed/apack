// The panel offers to undo the last discard that kept what it removed, says what cannot be brought back before a
// discard is confirmed, and says what an undo left alone.
import { afterEach, expect, it } from 'vitest';
import { startCommit, type CommitHarness } from './_support.ts';

const running: CommitHarness[] = [];
const panel = () => {
  const h = startCommit();
  running.push(h);
  return h;
};
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

const sent = (h: CommitHarness) => h.made.map((ask) => ask.event);

async function discarded(h: CommitHarness, paths: string[], kept: { id?: string; notKept: string[] }) {
  h.send({ type: 'commit.REVERT_FILES', paths });
  await h.latestAsk('commit.REVERT_FILES').answer({ paths, kept });
}

it('asks what cannot be brought back as the dialog for a file opens, and holds the answer with what it was asked of', async () => {
  const h = panel();

  h.send({ type: 'commit.TOGGLE_REVERT_DIALOG', file: { path: 'big/', status: 'untracked', staged: false, isDirectory: true } });
  expect(sent(h)).toContainEqual({ type: 'commit.PREVIEW_DISCARD', paths: ['big/'] });

  await h.latestAsk('commit.PREVIEW_DISCARD').answer({ paths: ['big/'], notKept: ['big/video.bin'] });
  expect(h.recovery().data.discardPreview).toEqual({ paths: ['big/'], notKept: ['big/video.bin'] });
});

it('offers to undo a discard that kept something, and asks for it to be put back by its id', async () => {
  const h = panel();

  await discarded(h, ['a.txt', 'b.txt'], { id: 'abc123', notKept: ['huge.bin'] });
  expect(h.recovery().data.lastDiscard).toEqual({ id: 'abc123', paths: ['a.txt', 'b.txt'], notKept: ['huge.bin'] });

  h.send({ type: 'commit.UNDO_DISCARD' });
  expect(sent(h)).toContainEqual({ type: 'commit.RESTORE_DISCARDED', id: 'abc123' });
});

it('keeps the offer it has when a later discard kept nothing', async () => {
  const h = panel();
  await discarded(h, ['a.txt'], { id: 'abc123', notKept: [] });

  await discarded(h, ['gone.txt'], { notKept: [] });

  expect(h.recovery().data.lastDiscard?.id).toBe('abc123');
});

it('drops the offer once undone, and says what was left alone until that is dismissed', async () => {
  const h = panel();
  await discarded(h, ['a.txt', 'b.txt'], { id: 'abc123', notKept: [] });

  h.send({ type: 'commit.UNDO_DISCARD' });
  await h.latestAsk('commit.RESTORE_DISCARDED').answer({ id: 'abc123', restored: ['a.txt'], left: ['b.txt'] });
  expect(h.recovery().data).toMatchObject({ lastDiscard: null, discardLeft: ['b.txt'] });

  h.send({ type: 'commit.DISMISS_DISCARD' });
  expect(h.recovery().data.discardLeft).toEqual([]);
});

it('leaves the offer for a newer discard when an older one is answered as put back', async () => {
  const h = panel();
  await discarded(h, ['a.txt'], { id: 'older', notKept: [] });
  h.send({ type: 'commit.UNDO_DISCARD' });
  await discarded(h, ['b.txt'], { id: 'newer', notKept: [] });

  await h.latestAsk('commit.RESTORE_DISCARDED').answer({ id: 'older', restored: ['a.txt'], left: [] });

  expect(h.recovery().data.lastDiscard?.id).toBe('newer');
});
