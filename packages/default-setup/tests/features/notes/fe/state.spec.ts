// The notes surface over its views. The canvas hands it the tree view's results (`NOTES.READ`) and each open note's
// (`NOTE.READ`); it applies them, or holds them behind this window's unanswered writes — a result from before a write
// would put old text back under the user's typing — and asks for them again (`writes.refreshes`) once the last write
// has ended. The note this window creates opens here and nowhere else.
import { expect, it } from 'vitest';
import { system, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import type { NoteDTO, NoteSummary } from '#generated/types.ts';
import notesState from '#features/notes/fe/state.ts';

interface RecordedAsk {
  name: string;
  done: (outcome: Outcome<unknown>) => void;
}

const summary = (id: string, title = id, parentId: string | null = null): NoteSummary => ({
  id, parentId, title, icon: null, noteType: 'document', completed: false, hideCompletedChildren: false,
  displayOrder: 0, savedDisplayOrder: null, childCount: 0, createdAt: 1, favorite: false,
});
const full = (id: string, content: string): NoteDTO => ({ ...summary(id), content, updatedAt: 1, lastSeen: 0 });

function start() {
  const asks: RecordedAsk[] = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (_to, name, _args, _progress, done) => {
      asks.push({ name, done });
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/notes', notesState);

  return {
    asks,
    read: () => sys.read(handle),
    data: () => sys.read(handle).data,
    send: (event: EventsOf<typeof notesState>) => sys.send(handle, event),
    end: async (name: string, outcome: Outcome<unknown>, nth = 0) => {
      asks.filter(each => each.name === name)[nth].done(outcome);
      await sys.idle();
    },
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

/** A note open in the editor, its text read */
function open(id = 'Note-a', text = 'stored') {
  const ctx = start();
  ctx.send({ type: 'NOTES.READ', notes: [summary(id)] });
  ctx.send({ type: 'NOTE.SELECT', noteId: id });
  ctx.send({ type: 'NOTE.READ', noteId: id, note: full(id, text) });
  return ctx;
}

it('opens a note from the tree and takes its text from its view', () => {
  const ctx = open();
  try {
    expect(ctx.read().at).toBe('editor');
    expect(ctx.data().currentNote?.id).toBe('Note-a');
    expect(ctx.data().contents['Note-a']).toBe('stored');
  } finally {
    ctx.cleanup();
  }
});

it('holds a read behind an unanswered write, and reads again once the write is answered', async () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NOTE.UPDATE_CONTENT', noteId: 'Note-a', content: 'typed' });
    // A read from before the write landed would put the old text back under the typing
    ctx.send({ type: 'NOTE.READ', noteId: 'Note-a', note: full('Note-a', 'stored') });
    expect(ctx.data().contents['Note-a']).toBe('typed');

    const before = ctx.data().writes.refreshes;
    await ctx.end('UPDATE_NOTE', { ok: true, value: undefined });
    expect(ctx.data().writes.refreshes).toBe(before + 1);
    ctx.send({ type: 'NOTE.READ', noteId: 'Note-a', note: full('Note-a', 'typed') });
    expect(ctx.data().contents['Note-a']).toBe('typed');
  } finally {
    ctx.cleanup();
  }
});

it('follows the tree: a rename elsewhere reaches the open note, and its deletion returns to the welcome page', () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NOTES.READ', notes: [summary('Note-a', 'renamed elsewhere')] });
    expect(ctx.data().currentNote?.title).toBe('renamed elsewhere');

    ctx.send({ type: 'NOTES.READ', notes: [] });
    expect(ctx.read().at).toBe('welcome');
    expect(ctx.data().currentNoteId).toBeNull();
  } finally {
    ctx.cleanup();
  }
});

it('opens the note this window created, by the answer, once, and marks it new', async () => {
  const ctx = start();
  try {
    ctx.send({ type: 'NOTES.READ', notes: [] });
    ctx.send({ type: 'NOTE.CREATE' });
    await ctx.end('CREATE_NOTE', { ok: true, value: { note: summary('Note-new', 'Untitled') } });
    expect(ctx.read().at).toBe('editor');
    expect(ctx.data()).toMatchObject({ currentNoteId: 'Note-new', createdNoteId: 'Note-new' });

    ctx.send({ type: 'NOTES.READ', notes: [summary('Note-new', 'Untitled')] });
    expect(ctx.data().notes.map(each => each.id), 'listed once').toEqual(['Note-new']);
  } finally {
    ctx.cleanup();
  }
});

it('reads again after a refused write, which left an edit on screen that is not stored', async () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NOTE.UPDATE_TITLE', noteId: 'Note-a', title: 'refused' });
    const before = ctx.data().writes.refreshes;
    await ctx.end('UPDATE_NOTE', { ok: false, failure: { kind: 'failed', message: 'No note' } });
    expect(ctx.data().writes.refreshes).toBe(before + 1);
  } finally {
    ctx.cleanup();
  }
});

it('holds its views until the last of several writes has ended, however each ended', async () => {
  const ctx = open();
  try {
    ctx.send({ type: 'NOTE.UPDATE_TITLE', noteId: 'Note-a', title: 'one' });
    ctx.send({ type: 'NOTE.UPDATE_CONTENT', noteId: 'Note-a', content: 'two' });
    const before = ctx.data().writes.refreshes;

    await ctx.end('UPDATE_NOTE', { ok: false, failure: { kind: 'failed', message: 'No note' } }, 0);
    ctx.send({ type: 'NOTE.READ', noteId: 'Note-a', note: full('Note-a', 'stored') });
    expect(ctx.data().contents['Note-a'], 'still held behind the second write').toBe('two');
    expect(ctx.data().writes.refreshes).toBe(before);

    await ctx.end('UPDATE_NOTE', { ok: true, value: undefined }, 1);
    expect(ctx.data().writes.refreshes).toBe(before + 1);
    expect(Object.keys(ctx.read().pending.updateNote), 'no ask that ended is kept').toEqual([]);
  } finally {
    ctx.cleanup();
  }
});

it('ties pendingSubDocumentInsert to its createNote key, clears on failure/navigation, and never drops valid created notes', async () => {
  const ctx = open('Note-parent', 'hello');
  try {
    ctx.send({ type: 'NOTES.READ', notes: [summary('Note-parent'), summary('Note-other')] });

    // 1. Failed sub-document insert clears pendingSubDocumentInsert
    ctx.send({ type: 'NOTE.REQUEST_DOCUMENT_INSERT', parentId: 'Note-parent', cursorPos: 5 });
    expect(ctx.data().pendingSubDocumentInsert).toMatchObject({ cursorPos: 5, parentId: 'Note-parent' });
    await ctx.end('CREATE_NOTE', { ok: false, failure: { kind: 'failed', message: 'disk full' } }, 0);
    expect(ctx.data().pendingSubDocumentInsert).toBeNull();
    expect(ctx.data().lastSubDocumentInsertChildId).toBeNull();

    // 2. Concurrent regular NOTE.CREATE while a sub-document insert is pending is NOT hijacked or dropped
    ctx.send({ type: 'NOTE.REQUEST_DOCUMENT_INSERT', parentId: 'Note-parent', cursorPos: 10 });
    ctx.send({ type: 'NOTE.CREATE', title: 'Unrelated Note' });

    // Unrelated NOTE.CREATE finishes first (ask index 2)
    await ctx.end('CREATE_NOTE', { ok: true, value: { note: summary('Note-unrelated', 'Unrelated Note') } }, 2);
    expect(ctx.data().notes.some((n) => n.id === 'Note-unrelated'), 'valid created note added to data.notes').toBe(true);
    expect(ctx.data().pendingSubDocumentInsert, 'unrelated create did not consume pending insert').not.toBeNull();

    // Navigating via NOTE.SELECT clears pendingSubDocumentInsert
    ctx.send({ type: 'NOTE.SELECT', noteId: 'Note-other' });
    expect(ctx.data().pendingSubDocumentInsert).toBeNull();

    // Even when the superseded sub-document create finishes later (ask index 1), it is still added to data.notes
    await ctx.end('CREATE_NOTE', { ok: true, value: { note: summary('Note-sub', 'Untitled', 'Note-parent') } }, 1);
    expect(ctx.data().notes.some((n) => n.id === 'Note-sub')).toBe(true);

    // 3. VIEW_WELCOME also clears pendingSubDocumentInsert
    ctx.send({ type: 'NOTE.SELECT', noteId: 'Note-parent' });
    ctx.send({ type: 'NOTE.REQUEST_DOCUMENT_INSERT', parentId: 'Note-parent', cursorPos: 3 });
    expect(ctx.data().pendingSubDocumentInsert).not.toBeNull();
    ctx.send({ type: 'VIEW_WELCOME' });
    expect(ctx.read().at).toBe('welcome');
    expect(ctx.data().pendingSubDocumentInsert).toBeNull();
  } finally {
    ctx.cleanup();
  }
});
