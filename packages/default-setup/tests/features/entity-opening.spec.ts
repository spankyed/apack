import { expect, it, vi } from 'vitest';
import { system, type AnyState, type State, type ViewHost, type ViewUpdate } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import type { OpenEntity } from '@apackdev/sdk/events';
import type { NoteSummary } from '#generated/types.ts';
import actions from '#features/actions/fe/state.ts';
import prompts from '#features/prompts/fe/state.ts';
import notes from '#features/notes/fe/state.ts';
import threads from '#features/threads/fe/state.ts';
import flows from '#features/flows/fe/state.ts';
import { librarySystem as library } from '#features/library/fe/state.ts';

vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {}; });
const tell = vi.hoisted(() => vi.fn());

interface DestinationActor {
  send(event: OpenEntity): void;
  getSnapshot(): { value: unknown; context: unknown };
  stop(): void;
}
function startStateSurface(ref: string, def: AnyState): DestinationActor {
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: (to, event) => { tell(to, event); },
    ask: () => () => {},
    follow: () => ({ stop: () => {} }),
  });
  const handle = sys.start(ref, def as State<any, any, any, never>);
  return {
    send: (event) => sys.send(handle, event as never),
    getSnapshot: () => {
      const snap = sys.read(handle) as { at?: string; data: unknown };
      return { value: snap.at, context: snap.data };
    },
    stop: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}
const destinations: Array<[string, () => DestinationActor]> = [
  ['actions', () => startStateSurface('default-setup/actions', actions)],
  ['prompts', () => startStateSurface('default-setup/prompts', prompts)],
  ['notes', () => startStateSurface('default-setup/notes', notes)],
  ['threads', () => startStateSurface('default-setup/threads', threads)],
  ['flows', () => startStateSurface('default-setup/flows', flows)],
  ['library', () => startStateSurface('default-setup/library', library)],
];

it.each(destinations)('%s ignores an entity it does not declare as a destination', (_, start) => {
  const actor = start();
  try {
    const before = actor.getSnapshot();
    tell.mockClear();
    actor.send({ type: 'OPEN_ENTITY', id: 'Artifact-unrelated' });
    expect(actor.getSnapshot().value).toEqual(before.value);
    expect(actor.getSnapshot().context).toEqual(before.context);
    expect(tell).not.toHaveBeenCalled();
  } finally { actor.stop(); }
});

const note = (id: string, parentId: string | null = null): NoteSummary => ({
  id, parentId, title: id, icon: null, noteType: 'document', completed: false,
  hideCompletedChildren: false, displayOrder: 0, savedDisplayOrder: null, childCount: 0,
  createdAt: 1, favorite: false,
});

it('opens a nested note by canonical identity from welcome and another editor', () => {
  const actor = startStateSurface('default-setup/notes', notes);
  try {
    actor.send({ type: 'NOTES.READ', notes: [note('Note-parent'), note('Note-child', 'Note-parent')] } as never);
    actor.send({ type: 'OPEN_ENTITY', id: 'Note-child' });
    expect(actor.getSnapshot().value).toBe('editor');
    expect((actor.getSnapshot().context as { currentNote?: { id: string }; expandedNodeIds: string[] }).currentNote?.id).toBe('Note-child');
    expect((actor.getSnapshot().context as { expandedNodeIds: string[] }).expandedNodeIds).toContain('Note-parent');
    expect(tell).toHaveBeenLastCalledWith('default-setup/notes', { type: 'VIEW_NOTE', id: 'Note-child' });
    actor.send({ type: 'OPEN_ENTITY', id: 'Note-parent' });
    expect((actor.getSnapshot().context as { currentNote?: { id: string } }).currentNote?.id).toBe('Note-parent');
  } finally { actor.stop(); }
});

it('opens a note selected in the tree and one reached through a link', () => {
  const actor = startStateSurface('default-setup/notes', notes);
  try {
    actor.send({ type: 'NOTES.READ', notes: [note('Note-parent'), note('Note-child', 'Note-parent')] } as never);
    actor.send({ type: 'NOTE.SELECT', noteId: 'Note-child' } as never);
    expect(actor.getSnapshot().value).toBe('editor');
    expect((actor.getSnapshot().context as { currentNote?: { id: string } }).currentNote?.id).toBe('Note-child');
    expect(tell).toHaveBeenLastCalledWith('default-setup/notes', { type: 'VIEW_NOTE', id: 'Note-child' });
    actor.send({ type: 'NOTE.LINK_CLICKED', noteId: 'Note-parent' } as never);
    expect((actor.getSnapshot().context as { currentNote?: { id: string } }).currentNote?.id).toBe('Note-parent');
  } finally { actor.stop(); }
});

it('opens an unlisted thread and fills only the current target without replaying navigation', () => {
  const detailSubs = new Map<string, (update: ViewUpdate<unknown>) => void>();
  const views: ViewHost = (_feature, view, args, updated) => {
    if (view === 'detail') {
      const targetId = (args as { id: string }).id;
      detailSubs.set(targetId, updated);
    }
    return () => {};
  };
  const guard = defectGuard();
  const sys = system({ side: 'window', views, onDefect: guard.onDefect });
  sys.attach({
    tell: (to, event) => { tell(to, event); },
    ask: () => () => {},
    follow: () => ({ stop: () => {} }),
  });
  const handle = sys.start('default-setup/threads', threads);
  try {
    sys.send(handle, { type: 'SHOW_CREATE_FORM' });
    sys.send(handle, { type: 'OPEN_ENTITY', id: 'Thread-first' });
    expect(tell).toHaveBeenLastCalledWith('default-setup/threads', { type: 'VIEW_THREAD', threadId: 'Thread-first' });
    sys.send(handle, { type: 'OPEN_ENTITY', id: 'Thread-second' });
    detailSubs.get('Thread-first')?.({ ok: true, value: { id: 'Thread-first', topic: 'Abandoned', messageIds: [] } });
    expect(sys.read(handle).data.view.id).toBe('Thread-second');
    expect(sys.read(handle).data.view.topic).not.toBe('Abandoned');
    detailSubs.get('Thread-second')?.({ ok: true, value: { id: 'Thread-second', topic: 'Current', messageIds: [] } });
    expect(sys.read(handle).data.view.topic).toBe('Current');
    sys.send(handle, { type: 'VIEW_LIST' });
    detailSubs.get('Thread-second')?.({ ok: true, value: { id: 'Thread-second', topic: 'Updated', messageIds: [] } });
    expect(sys.read(handle).at).toBe('list');
  } finally {
    guard.assertNone();
    sys.stop();
    guard[Symbol.dispose]();
  }
});
