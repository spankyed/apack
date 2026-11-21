// The panel offers to undo the last discard that kept what it removed, says what cannot be brought back before a
// discard is confirmed, and says what an undo left alone.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { latestAsk, made, resetAsks } from '../../_support/asks.ts';

vi.mock('#generated/events.ts', async () => ({ tell: vi.fn(), fromAsk: (await import('../../_support/asks.ts')).fromAsk }));
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent: vi.fn(),
  updateParentState: vi.fn(),
  sendEventToParent: vi.fn(),
  getParentContext: vi.fn(() => ({})),
}));

const { commitState } = await import('#features/code/fe/features/commit/state.ts');

beforeEach(resetAsks);

const sent = () => made.map(ask => ask.event);
const panel = () => createActor(commitState).start();
type Panel = ReturnType<typeof panel>;
/** A discard of `paths` the panel asked for, answered with what it kept */
async function discarded(actor: Panel, paths: string[], kept: { id?: string; notKept: string[] }) {
  actor.send({ type: 'commit.REVERT_FILES', paths });
  await latestAsk('commit.REVERT_FILES').answer({ paths, kept });
}

it('asks what cannot be brought back as the dialog for a file opens, and holds the answer with what it was asked of', async () => {
  const actor = panel();

  actor.send({ type: 'commit.TOGGLE_REVERT_DIALOG', file: { path: 'big/', status: 'untracked', staged: false, isDirectory: true } });
  expect(sent()).toContainEqual({ type: 'commit.PREVIEW_DISCARD', paths: ['big/'] });

  await latestAsk('commit.PREVIEW_DISCARD').answer({ paths: ['big/'], notKept: ['big/video.bin'] });
  expect(actor.getSnapshot().context.discardPreview).toEqual({ paths: ['big/'], notKept: ['big/video.bin'] });
});

it('offers to undo a discard that kept something, and asks for it to be put back by its id', async () => {
  const actor = panel();

  await discarded(actor, ['a.txt', 'b.txt'], { id: 'abc123', notKept: ['huge.bin'] });
  expect(actor.getSnapshot().context.lastDiscard).toEqual({ id: 'abc123', paths: ['a.txt', 'b.txt'], notKept: ['huge.bin'] });

  actor.send({ type: 'commit.UNDO_DISCARD' });
  expect(sent()).toContainEqual({ type: 'commit.RESTORE_DISCARDED', id: 'abc123' });
});

// A discard of a deletion, or of files all too large, removed nothing that can be put back
it('keeps the offer it has when a later discard kept nothing', async () => {
  const actor = panel();
  await discarded(actor, ['a.txt'], { id: 'abc123', notKept: [] });

  await discarded(actor, ['gone.txt'], { notKept: [] });

  expect(actor.getSnapshot().context.lastDiscard?.id).toBe('abc123');
});

it('drops the offer once undone, and says what was left alone until that is dismissed', async () => {
  const actor = panel();
  await discarded(actor, ['a.txt', 'b.txt'], { id: 'abc123', notKept: [] });

  actor.send({ type: 'commit.UNDO_DISCARD' });
  await latestAsk('commit.RESTORE_DISCARDED').answer({ id: 'abc123', restored: ['a.txt'], left: ['b.txt'] });
  expect(actor.getSnapshot().context).toMatchObject({ lastDiscard: null, discardLeft: ['b.txt'] });

  actor.send({ type: 'commit.DISMISS_DISCARD' });
  expect(actor.getSnapshot().context.discardLeft).toEqual([]);
});

// An answer for a discard that has since been replaced by a newer one says nothing about the offer now shown
it('leaves the offer for a newer discard when an older one is answered as put back', async () => {
  const actor = panel();
  await discarded(actor, ['a.txt'], { id: 'older', notKept: [] });
  actor.send({ type: 'commit.UNDO_DISCARD' });
  await discarded(actor, ['b.txt'], { id: 'newer', notKept: [] });

  await latestAsk('commit.RESTORE_DISCARDED').answer({ id: 'older', restored: ['a.txt'], left: [] });

  expect(actor.getSnapshot().context.lastDiscard?.id).toBe('newer');
});
