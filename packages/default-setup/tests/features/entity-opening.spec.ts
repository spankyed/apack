import { expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { OpenEntity } from '@apackdev/sdk/events';
import type { NoteSummary } from '#generated/types.ts';

vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {}; });
const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
const { default: actions } = await import('#features/actions/fe/state.ts');
const { default: prompts } = await import('#features/prompts/fe/state.ts');
const { default: notes } = await import('#features/notes/fe/state.ts');
const { default: threads } = await import('#features/threads/fe/state.ts');
const { default: flows } = await import('#features/flows/fe/state.ts');
const { librarySystem: library } = await import('#features/library/fe/state.ts');

interface DestinationActor {
  send(event: OpenEntity): void;
  getSnapshot(): { value: unknown; context: unknown };
  stop(): void;
}
const destinations: Array<[string, () => DestinationActor]> = [
  ['actions', () => createActor(actions).start()],
  ['prompts', () => createActor(prompts).start()],
  ['notes', () => createActor(notes).start()],
  ['threads', () => createActor(threads).start()],
  ['flows', () => createActor(flows).start()],
  ['library', () => createActor(library).start()],
];

it.each(destinations)('%s ignores an entity it does not declare as a destination', (_, start) => {
  const actor = start();
  try {
    const before = actor.getSnapshot();
    sendToSystem.mockClear();
    actor.send({ type: 'OPEN_ENTITY', id: 'Artifact-unrelated' });
    expect(actor.getSnapshot().value).toEqual(before.value);
    expect(actor.getSnapshot().context).toEqual(before.context);
    expect(sendToSystem).not.toHaveBeenCalled();
  } finally { actor.stop(); }
});

const note = (id: string, parentId: string | null = null): NoteSummary => ({
  id, parentId, title: id, icon: null, noteType: 'document', completed: false,
  hideCompletedChildren: false, displayOrder: 0, savedDisplayOrder: null, childCount: 0,
  createdAt: 1, favorite: false,
});

it('opens a nested note by canonical identity from welcome and another editor', () => {
  const actor = createActor(notes).start();
  try {
    actor.send({ type: 'NOTES.READ', notes: [note('Note-parent'), note('Note-child', 'Note-parent')] });
    actor.send({ type: 'OPEN_ENTITY', id: 'Note-child' });
    expect(actor.getSnapshot().hasTag('editor')).toBe(true);
    expect(actor.getSnapshot().context.currentNote?.id).toBe('Note-child');
    expect(actor.getSnapshot().context.expandedNodeIds).toContain('Note-parent');
    expect(sendToSystem).toHaveBeenLastCalledWith('notes', { type: 'VIEW_NOTE', id: 'Note-child' });
    actor.send({ type: 'OPEN_ENTITY', id: 'Note-parent' });
    expect(actor.getSnapshot().context.currentNote?.id).toBe('Note-parent');
  } finally { actor.stop(); }
});

it('opens a note selected in the tree and one reached through a link', () => {
  const actor = createActor(notes).start();
  try {
    actor.send({ type: 'NOTES.READ', notes: [note('Note-parent'), note('Note-child', 'Note-parent')] });
    actor.send({ type: 'NOTE.SELECT', noteId: 'Note-child' });
    expect(actor.getSnapshot().hasTag('editor')).toBe(true);
    expect(actor.getSnapshot().context.currentNote?.id).toBe('Note-child');
    expect(sendToSystem).toHaveBeenLastCalledWith('notes', { type: 'VIEW_NOTE', id: 'Note-child' });
    actor.send({ type: 'NOTE.LINK_CLICKED', noteId: 'Note-parent' });
    expect(actor.getSnapshot().context.currentNote?.id).toBe('Note-parent');
  } finally { actor.stop(); }
});

it('opens an unlisted thread and fills only the current target without replaying navigation', () => {
  const actor = createActor(threads).start();
  try {
    actor.send({ type: 'SHOW_CREATE_FORM' });
    actor.send({ type: 'OPEN_ENTITY', id: 'Thread-first' });
    expect(sendToSystem).toHaveBeenLastCalledWith('threads', { type: 'VIEW_THREAD', threadId: 'Thread-first' });
    actor.send({ type: 'OPEN_ENTITY', id: 'Thread-second' });
    actor.send({ type: 'SET_VIEW_DATA', id: 'Thread-first', data: { topic: 'Abandoned' } });
    expect(actor.getSnapshot().context.view.id).toBe('Thread-second');
    expect(actor.getSnapshot().context.view.topic).not.toBe('Abandoned');
    actor.send({ type: 'SET_VIEW_DATA', id: 'Thread-second', data: { topic: 'Current' } });
    expect(actor.getSnapshot().context.view.topic).toBe('Current');
    actor.send({ type: 'VIEW_LIST' });
    actor.send({ type: 'SET_VIEW_DATA', id: 'Thread-second', data: { topic: 'Updated' } });
    expect(actor.getSnapshot().matches('list')).toBe(true);
  } finally { actor.stop(); }
});
