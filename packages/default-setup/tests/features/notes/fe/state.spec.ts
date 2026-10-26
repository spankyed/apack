// The notes surface over its views. The canvas hands it the tree view's results (`NOTES.READ`) and each open note's
// (`NOTE.READ`); it applies them, or holds them behind this window's unanswered writes — a result from before a write
// would put old text back under the user's typing — and asks for them again (`writes.refreshes`) once the last write
// is answered. The note this window creates opens here and nowhere else.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { answerTo } from '@apackdev/sdk/testing';
import type { NoteDTO, NoteSummary } from '#generated/types.ts';

let minted = 0;
const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
const { default: notesState } = await import('#features/notes/fe/state.ts');

const actors: ReturnType<typeof createActor<typeof notesState>>[] = [];
const start = () => { const actor = createActor(notesState).start(); actors.push(actor); return actor; };
const summary = (id: string, title = id, parentId: string | null = null): NoteSummary => ({
  id, parentId, title, icon: null, noteType: 'document', completed: false, hideCompletedChildren: false,
  displayOrder: 0, savedDisplayOrder: null, childCount: 0, createdAt: 1, favorite: false,
});
const full = (id: string, content: string): NoteDTO => ({ ...summary(id), content, updatedAt: 1, lastSeen: 0 });
const context = (actor: ReturnType<typeof start>) => actor.getSnapshot().context;
/** The call the nth `UPDATE_NOTE`, or whatever `type`, was sent under */
const callOf = (type: string, nth = 0) => {
  const at = sendToSystem.mock.calls.map(([, event]) => (event as { type: string }).type).reduce<number[]>((all, each, i) => (each === type ? [...all, i] : all), [])[nth];
  return sendToSystem.mock.results[at].value as string;
};

beforeEach(() => {
  sendToSystem.mockReset();
  sendToSystem.mockImplementation(() => `c-${++minted}`);
});
afterEach(() => actors.splice(0).forEach(actor => actor.stop()));

/** A note open in the editor, its text read */
function open(id = 'Note-a', text = 'stored') {
  const actor = start();
  actor.send({ type: 'NOTES.READ', notes: [summary(id)] });
  actor.send({ type: 'NOTE.SELECT', noteId: id });
  actor.send({ type: 'NOTE.READ', noteId: id, note: full(id, text) });
  return actor;
}

it('opens a note from the tree and takes its text from its view', () => {
  const actor = open();
  expect(actor.getSnapshot().hasTag('editor')).toBe(true);
  expect(context(actor).currentNote?.id).toBe('Note-a');
  expect(context(actor).contents['Note-a']).toBe('stored');
});

it('holds a read behind an unanswered write, and reads again once the write is answered', () => {
  const actor = open();
  actor.send({ type: 'NOTE.UPDATE_CONTENT', noteId: 'Note-a', content: 'typed' });
  // A read from before the write landed would put the old text back under the typing
  actor.send({ type: 'NOTE.READ', noteId: 'Note-a', note: full('Note-a', 'stored') });
  expect(context(actor).contents['Note-a']).toBe('typed');

  const before = context(actor).writes.refreshes;
  actor.send(answerTo(callOf('UPDATE_NOTE'), { type: 'NOTE_WRITTEN' }));
  expect(context(actor).writes.refreshes).toBe(before + 1);
  actor.send({ type: 'NOTE.READ', noteId: 'Note-a', note: full('Note-a', 'typed') });
  expect(context(actor).contents['Note-a']).toBe('typed');
});

it('follows the tree: a rename elsewhere reaches the open note, and its deletion returns to the welcome page', () => {
  const actor = open();
  actor.send({ type: 'NOTES.READ', notes: [summary('Note-a', 'renamed elsewhere')] });
  expect(context(actor).currentNote?.title).toBe('renamed elsewhere');

  actor.send({ type: 'NOTES.READ', notes: [] });
  expect(actor.getSnapshot().hasTag('welcome')).toBe(true);
  expect(context(actor).currentNoteId).toBeNull();
});

it('opens the note this window created, by the answer, once, and marks it new', () => {
  const actor = start();
  actor.send({ type: 'NOTES.READ', notes: [] });
  actor.send({ type: 'NOTE.CREATE' });
  actor.send(answerTo(callOf('CREATE_NOTE'), { type: 'NOTE_CREATED', note: summary('Note-new', 'Untitled') }));
  expect(actor.getSnapshot().hasTag('editor')).toBe(true);
  expect(context(actor)).toMatchObject({ currentNoteId: 'Note-new', createdNoteId: 'Note-new' });

  actor.send({ type: 'NOTES.READ', notes: [summary('Note-new', 'Untitled')] });
  expect(context(actor).notes.map(each => each.id), 'listed once').toEqual(['Note-new']);
});

it('reads again after a refused write, which left an edit on screen that is not stored', () => {
  const actor = open();
  actor.send({ type: 'NOTE.UPDATE_TITLE', noteId: 'Note-a', title: 'refused' });
  const before = context(actor).writes.refreshes;
  actor.send(answerTo(callOf('UPDATE_NOTE'), { type: 'NOTE_WRITE_FAILED', error: 'No note' }));
  expect(context(actor).writes.refreshes).toBe(before + 1);
});
