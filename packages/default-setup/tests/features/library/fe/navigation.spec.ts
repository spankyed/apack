import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { DocumentDTO, DocumentItem, FolderContents, FolderItem } from '#generated/types.ts';
import { askAnswered, askFailed } from '@apackdev/sdk/testing';

const sendToSystem = vi.hoisted(() => vi.fn());
/** The documents this window is fetching, by id: settling one answers its fetch as the library would */
const fetches = vi.hoisted(() => new Map<string, (outcome: unknown) => void>());
vi.mock('#generated/events.ts', async () => {
  const { fromPromise } = await import('xstate');
  return { sendToSystem, fromAsk: () => fromPromise(({ input }: { input: { id: string } }) => new Promise((resolve) => { fetches.set(input.id, resolve); })) };
});
const { librarySystem: libraryState } = await import('#features/library/fe/state.ts');
const actors: ReturnType<typeof createActor<typeof libraryState>>[] = [];
const view = () => { const actor = createActor(libraryState).start(); actors.push(actor); return actor; };
const document = (id: `Document-${string}`): DocumentDTO => ({ id, name: id, shortCode: 'DOC-1',
  content: [], tags: [], displayOrder: 0, createdAt: '2026-10-16', updatedAt: '2026-10-16' });
let minted = 0;
beforeEach(() => { sendToSystem.mockReset(); sendToSystem.mockImplementation(() => `c-${++minted}`); fetches.clear(); });
afterEach(() => actors.splice(0).forEach(actor => actor.stop()));
const folderItem = (id: string, extra: Partial<FolderItem> = {}): FolderItem => ({ id: id as FolderItem['id'], type: 'folder', name: id,
  parentId: null, childCount: 0, size: '--', kind: 'Folder', displayOrder: 0, createdAt: '', updatedAt: '', ...extra });
const contents = (folderId: string | null, items: FolderItem[]): FolderContents =>
  ({ items, currentFolderId: folderId as FolderContents['currentFolderId'], currentPath: [], breadcrumbs: [] });
const stored = (folderId: `${string}-${string}` | null, items: FolderItem[]) =>
  ({ type: 'FOLDER.READ' as const, folderId, folder: { onDisk: false as const, contents: contents(folderId, items) } });
const sent = (type: string) => sendToSystem.mock.calls.filter(([, event]) => event.type === type).map(([, event]) => event);
/** A document the view says is on disk, opened: the window starts fetching it */
const openOnDisk = (actor: ReturnType<typeof view>, id: `Document-${string}`) => {
  actor.send({ type: 'OPEN_ENTITY', id });
  actor.send({ type: 'DOCUMENT.READ', documentId: id, document: { onDisk: true } });
};
/** Settles the fetch of `id` with `outcome`, and lets the machine take it */
async function settleFetch(id: string, outcome: unknown) {
  fetches.get(id)!(outcome);
  await new Promise<void>((resolve) => setImmediate(resolve));
}
const fetched = (id: `Document-${string}`) => ({ ok: true, value: { document: document(id) } });

it('does not apply a fetch for a document the window has left', async () => {
  const actor = view();
  openOnDisk(actor, 'Document-first');
  actor.send({ type: 'OPEN_ENTITY', id: 'Collection-second' });
  await settleFetch('Document-first', fetched('Document-first'));
  expect(actor.getSnapshot().matches('browser')).toBe(true);
  expect(actor.getSnapshot().context.editingDocument).toBeUndefined();
  expect(actor.getSnapshot().context.currentFolderId).toBe('Collection-second');
});

it('opens cached document data without a fetch', () => {
  const actor = view();
  const item = { ...document('Document-cached'), type: 'document', parentId: null, size: '0 B', kind: 'Document', displayOrder: 7 } satisfies DocumentItem;
  actor.send(askAnswered('c-1', 'GET_FOLDER_CONTENTS', { items: [item], currentFolderId: null, currentPath: [], breadcrumbs: [] }));
  actor.send({ type: 'OPEN_ENTITY', id: 'Document-cached' });
  expect(actor.getSnapshot().context.editingDocument).toMatchObject({ id: 'Document-cached', displayOrder: 7 });
  expect([...fetches.keys()]).toEqual([]);
});

it('keeps the document available to a save while retiring its editor target', () => {
  const actor = view();
  actor.send({ type: 'OPEN_ENTITY', id: 'Document-first' });
  actor.send({ type: 'DOCUMENT.READ', documentId: 'Document-first', document: { onDisk: false, document: document('Document-first') } });
  actor.send({ type: 'SAVE_DOCUMENT', name: 'Saved', content: [], tags: [] });
  expect(sendToSystem).toHaveBeenCalledWith('library', expect.objectContaining({ type: 'UPDATE_DOCUMENT', id: 'Document-first', name: 'Saved' }));
  actor.send({ type: 'DOCUMENT.READ', documentId: 'Document-first', document: { onDisk: false, document: document('Document-first') } });
  expect(actor.getSnapshot().matches('browser')).toBe(true);
});

it('opens a symlinked document from a double-click, fetching it once its view says it is on disk', async () => {
  const actor = view();
  const id = 'Document-symlink' as const;
  const item = { id, type: 'document', name: 'linked.md', isSymlinked: true } as unknown as DocumentItem;
  actor.send({ type: 'DOUBLE_CLICK_ITEM', item });
  expect(actor.getSnapshot().matches('edit')).toBe(true);
  actor.send({ type: 'DOCUMENT.READ', documentId: id, document: { onDisk: true } });
  expect([...fetches.keys()]).toEqual([id]);
  await settleFetch(id, fetched(id));
  expect(actor.getSnapshot().context.editingDocument?.id).toBe(id);
});

it("shows the open folder's view, and writes nothing for a folder it has left", () => {
  const actor = view();
  actor.send({ type: 'NAVIGATE_TO_FOLDER', folderId: 'Collection-b' });
  actor.send(stored(null, [folderItem('Collection-left-behind')]));
  expect(actor.getSnapshot().context.items).toEqual([]);
  actor.send(stored('Collection-b', [folderItem('Collection-in-b')]));
  expect(actor.getSnapshot().context.items.map(item => item.id)).toEqual(['Collection-in-b']);
});

it('keeps what the user selected when the folder re-runs, and drops it once it is gone', () => {
  const actor = view();
  actor.send(stored(null, [folderItem('Collection-a'), folderItem('Collection-b')]));
  actor.send({ type: 'SELECT_ITEMS', itemIds: ['Collection-a'] });
  actor.send(stored(null, [folderItem('Collection-a'), folderItem('Collection-b'), folderItem('Collection-c')]));
  expect(actor.getSnapshot().context.selectedItems).toEqual(['Collection-a']);
  actor.send(stored(null, [folderItem('Collection-b')]));
  expect(actor.getSnapshot().context.selectedItems).toEqual([]);
});

it('fetches a folder on disk, and again when the system says it changed, and fills an expanded one in its slot', () => {
  const actor = view();
  actor.send({ type: 'NAVIGATE_TO_FOLDER', folderId: 'symlink:Collection-linked' });
  actor.send({ type: 'FOLDER.READ', folderId: 'symlink:Collection-linked', folder: { onDisk: true } });
  expect(sent('GET_FOLDER_CONTENTS')).toEqual([{ type: 'GET_FOLDER_CONTENTS', folderId: 'symlink:Collection-linked' }]);

  actor.send({ type: 'FOLDER_CHANGED', folderId: 'symlink:Collection-elsewhere' });
  expect(sent('GET_FOLDER_CONTENTS'), 'a folder this window does not show').toHaveLength(1);
  actor.send({ type: 'FOLDER_CHANGED', folderId: 'symlink:Collection-linked' });
  expect(sent('GET_FOLDER_CONTENTS')).toHaveLength(2);

  actor.send({ type: 'EXPAND_FOLDER', folderId: 'Collection-tree' });
  actor.send(askAnswered('c-1', 'GET_FOLDER_CONTENTS', contents('Collection-tree', [folderItem('Collection-child')])));
  expect(actor.getSnapshot().context.expandedFolderChildren['Collection-tree'].map(item => item.id)).toEqual(['Collection-child']);
  expect(actor.getSnapshot().context.loadingFolderIds).toEqual([]);
});

it('asks whether its symlinked folders still reach their disk, and marks the ones that do not', () => {
  const actor = view();
  actor.send(stored(null, [folderItem('Collection-linked', { isSymlink: true }), folderItem('Collection-plain')]));
  expect(sent('CHECK_SYMLINKS')).toEqual([{ type: 'CHECK_SYMLINKS', ids: ['Collection-linked'] }]);
  const linked = 'Collection-linked' as const;
  actor.send(askAnswered('c-1', 'CHECK_SYMLINKS', { ids: [linked], broken: [linked] }));
  expect(actor.getSnapshot().context.items.find(item => item.id === 'Collection-linked')).toMatchObject({ isBroken: true });
});

it('returns to the browser when the document open is deleted, here or in another window', () => {
  const actor = view();
  actor.send({ type: 'OPEN_ENTITY', id: 'Document-open' });
  actor.send({ type: 'DOCUMENT.READ', documentId: 'Document-open', document: { onDisk: false, document: document('Document-open') } });
  expect(actor.getSnapshot().context.editingDocument?.id).toBe('Document-open');
  actor.send({ type: 'DOCUMENT.READ', documentId: 'Document-open', document: { onDisk: false, document: null } });
  expect(actor.getSnapshot().matches('browser')).toBe(true);
  expect(actor.getSnapshot().context.editingDocument).toBeUndefined();
});

it('names the folder this window made, once it is shown, and reports a refused write', () => {
  const actor = view();
  actor.send({ type: 'CREATE_FOLDER', name: 'Fresh' });
  const call = sendToSystem.mock.results.at(-1)?.value as string;
  actor.send(askAnswered(call, 'CREATE_COLLECTION', { collection: { id: 'Collection-fresh' } } as never));
  expect(actor.getSnapshot().context.itemToEdit).toBe('Collection-fresh');
  actor.send(stored(null, [folderItem('Collection-fresh')]));
  expect(actor.getSnapshot().context.selectedItems).toEqual(['Collection-fresh']);

  actor.send(askFailed(call, 'CREATE_COLLECTION', { kind: 'failed', message: 'Path does not exist' }));
  expect(actor.getSnapshot().context.writeError).toBe('Path does not exist');
});

it('returns to the browser, saying why, when the document it opened is no longer on disk', async () => {
  const actor = view();
  openOnDisk(actor, 'Document-open');
  await settleFetch('Document-open', { ok: false, failure: { kind: 'not-found', message: 'Document not found' } });
  expect(actor.getSnapshot().matches('browser')).toBe(true);
  expect(actor.getSnapshot().context.writeError).toBe('Document not found');
});

it('stays on the document when its fetch was refused for a reason other than its being gone', async () => {
  const actor = view();
  openOnDisk(actor, 'Document-open');
  await settleFetch('Document-open', { ok: false, failure: { kind: 'no-access', message: 'EACCES: permission denied' } });
  expect(actor.getSnapshot().matches('browser')).toBe(false);
  expect(actor.getSnapshot().context.writeError).toBe('EACCES: permission denied');
});

it('stays on the document when what is gone is something else this window asked for', () => {
  const actor = view();
  openOnDisk(actor, 'Document-open');
  actor.send(askFailed('c-another-ask', 'UPDATE_SYMLINK_PATH', { kind: 'not-found', message: 'Path does not exist: /gone' }));
  expect(actor.getSnapshot().matches('browser')).toBe(false);
  expect(actor.getSnapshot().context.writeError).toBe('Path does not exist: /gone');
});
