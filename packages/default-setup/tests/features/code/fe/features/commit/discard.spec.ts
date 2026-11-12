// The panel offers to undo the last discard that kept what it removed, says what cannot be brought back before a
// discard is confirmed, and says what an undo left alone.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

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

const sent = () => sendToSystem.mock.calls.map(([, event]) => event as { type: string });
const panel = () => createActor(commitState).start();
const discarded = (paths: string[], kept: { id?: string; notKept: string[] }) => ({ type: 'commit.FILES_REVERTED' as const, data: { paths, kept } });

it('asks what cannot be brought back as the dialog for a file opens, and holds the answer with what it was asked of', () => {
  const actor = panel();

  actor.send({ type: 'commit.TOGGLE_REVERT_DIALOG', file: { path: 'big/', status: 'untracked', staged: false, isDirectory: true } });
  expect(sent()).toContainEqual({ type: 'commit.PREVIEW_DISCARD', paths: ['big/'] });

  actor.send({ type: 'commit.DISCARD_PREVIEWED', data: { paths: ['big/'], notKept: ['big/video.bin'] } });
  expect(actor.getSnapshot().context.discardPreview).toEqual({ paths: ['big/'], notKept: ['big/video.bin'] });
});

it('offers to undo a discard that kept something, and asks for it to be put back by its id', () => {
  const actor = panel();

  actor.send(discarded(['a.txt', 'b.txt'], { id: 'abc123', notKept: ['huge.bin'] }));
  expect(actor.getSnapshot().context.lastDiscard).toEqual({ id: 'abc123', paths: ['a.txt', 'b.txt'], notKept: ['huge.bin'] });

  sendToSystem.mockReset();
  actor.send({ type: 'commit.UNDO_DISCARD' });
  expect(sent()).toContainEqual({ type: 'commit.RESTORE_DISCARDED', id: 'abc123' });
});

// A discard of a deletion, or of files all too large, removed nothing that can be put back
it('keeps the offer it has when a later discard kept nothing', () => {
  const actor = panel();
  actor.send(discarded(['a.txt'], { id: 'abc123', notKept: [] }));

  actor.send(discarded(['gone.txt'], { notKept: [] }));

  expect(actor.getSnapshot().context.lastDiscard?.id).toBe('abc123');
});

it('drops the offer once undone, and says what was left alone until that is dismissed', () => {
  const actor = panel();
  actor.send(discarded(['a.txt', 'b.txt'], { id: 'abc123', notKept: [] }));

  actor.send({ type: 'commit.DISCARD_RESTORED', data: { id: 'abc123', restored: ['a.txt'], left: ['b.txt'] } });
  expect(actor.getSnapshot().context).toMatchObject({ lastDiscard: null, discardLeft: ['b.txt'] });

  actor.send({ type: 'commit.DISMISS_DISCARD' });
  expect(actor.getSnapshot().context.discardLeft).toEqual([]);
});

// An answer for a discard that has since been replaced by a newer one says nothing about the offer now shown
it('leaves the offer for a newer discard when an older one is answered as put back', () => {
  const actor = panel();
  actor.send(discarded(['a.txt'], { id: 'older', notKept: [] }));
  actor.send(discarded(['b.txt'], { id: 'newer', notKept: [] }));

  actor.send({ type: 'commit.DISCARD_RESTORED', data: { id: 'older', restored: ['a.txt'], left: [] } });

  expect(actor.getSnapshot().context.lastDiscard?.id).toBe('newer');
});
