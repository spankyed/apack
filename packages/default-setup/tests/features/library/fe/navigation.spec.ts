import { expect, it } from 'vitest';
import { system, within, type EventsOf, type Outcome } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import type { DocumentDTO, DocumentItem, FolderContents, FolderItem } from '#generated/types.ts';
import { librarySystem as libraryState } from '#features/library/fe/state.ts';

interface RecordedAsk {
  name: string;
  args: Record<string, unknown>;
  stopped: boolean;
  done: (outcome: Outcome<unknown>) => void;
}

const document = (id: `Document-${string}`): DocumentDTO => ({
  id, name: id, shortCode: 'DOC-1',
  content: [], tags: [], displayOrder: 0, createdAt: '2026-10-16', updatedAt: '2026-10-16',
});
const folderItem = (id: string, extra: Partial<FolderItem> = {}): FolderItem => ({
  id: id as FolderItem['id'], type: 'folder', name: id,
  parentId: null, childCount: 0, size: '--', kind: 'Folder', displayOrder: 0, createdAt: '', updatedAt: '', ...extra,
});
const contents = (folderId: string | null, items: FolderItem[]): FolderContents =>
  ({ items, currentFolderId: folderId as FolderContents['currentFolderId'], currentPath: [], breadcrumbs: [] });
const stored = (folderId: `${string}-${string}` | null, items: FolderItem[]) =>
  ({ type: 'FOLDER.READ' as const, folderId, folder: { onDisk: false as const, contents: contents(folderId, items) } });
const fetched = (id: `Document-${string}`): Outcome<unknown> => ({ ok: true, value: { document: document(id) } });

function view() {
  const asks: RecordedAsk[] = [];
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: (_to, name, args, _progress, done) => {
      const entry: RecordedAsk = { name, args: (args ?? {}) as Record<string, unknown>, stopped: false, done };
      asks.push(entry);
      return () => { entry.stopped = true; };
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/library', libraryState);
  const send = (event: EventsOf<typeof libraryState>) => sys.send(handle, event);

  return {
    asks,
    sent: (name: string) => asks.filter(each => each.name === name).map(each => ({ type: name, ...each.args })),
    fetching: () => asks.filter(each => each.name === 'GET_DOCUMENT').map(each => each.args.id),
    end: async (name: string, outcome: Outcome<unknown>) => {
      const ask = asks.filter(each => each.name === name).at(-1)!;
      if (!ask.stopped) ask.done(outcome);
      await sys.idle();
    },
    openOnDisk: (id: `Document-${string}`) => {
      send({ type: 'OPEN_ENTITY', id });
      send({ type: 'DOCUMENT.READ', documentId: id, document: { onDisk: true } });
    },
    settleFetch: async (id: string, outcome: Outcome<unknown>) => {
      const ask = asks.find(each => each.name === 'GET_DOCUMENT' && each.args.id === id)!;
      if (!ask.stopped) ask.done(outcome);
      await sys.idle();
    },
    read: () => sys.read(handle),
    send,
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('does not apply a fetch for a document the window has left', async () => {
  const ctx = view();
  try {
    ctx.openOnDisk('Document-first');
    ctx.send({ type: 'OPEN_ENTITY', id: 'Collection-second' });
    await ctx.settleFetch('Document-first', fetched('Document-first'));
    expect(ctx.read().at).toBe('browser');
    expect(ctx.read().data.editingDocument).toBeUndefined();
    expect(ctx.read().data.currentFolderId).toBe('Collection-second');
  } finally {
    ctx.cleanup();
  }
});

it('opens cached document data without a fetch', () => {
  const ctx = view();
  try {
    const item = { ...document('Document-cached'), type: 'document', parentId: null, size: '0 B', kind: 'Document', displayOrder: 7 } satisfies DocumentItem;
    ctx.send({ type: 'FOLDER.READ', folderId: null, folder: { onDisk: false, contents: { items: [item], currentFolderId: null, currentPath: [], breadcrumbs: [] } } });
    ctx.send({ type: 'OPEN_ENTITY', id: 'Document-cached' });
    expect(ctx.read().data.editingDocument).toMatchObject({ id: 'Document-cached', displayOrder: 7 });
    expect(ctx.fetching()).toEqual([]);
  } finally {
    ctx.cleanup();
  }
});

it('keeps the document available to a save while retiring its editor target', () => {
  const ctx = view();
  try {
    ctx.send({ type: 'OPEN_ENTITY', id: 'Document-first' });
    ctx.send({ type: 'DOCUMENT.READ', documentId: 'Document-first', document: { onDisk: false, document: document('Document-first') } });
    ctx.send({ type: 'SAVE_DOCUMENT', name: 'Saved', content: [], tags: [] });
    expect(ctx.sent('UPDATE_DOCUMENT')).toEqual([expect.objectContaining({ id: 'Document-first', name: 'Saved' })]);
    ctx.send({ type: 'DOCUMENT.READ', documentId: 'Document-first', document: { onDisk: false, document: document('Document-first') } });
    expect(ctx.read().at).toBe('browser');
  } finally {
    ctx.cleanup();
  }
});

it('opens a symlinked document from a double-click, fetching it once its view says it is on disk', async () => {
  const ctx = view();
  try {
    const id = 'Document-symlink' as const;
    const item = { id, type: 'document', name: 'linked.md', isSymlinked: true } as unknown as DocumentItem;
    ctx.send({ type: 'DOUBLE_CLICK_ITEM', item });
    expect(within(ctx.read(), 'edit')).toBe(true);
    ctx.send({ type: 'DOCUMENT.READ', documentId: id, document: { onDisk: true } });
    expect(ctx.fetching()).toEqual([id]);
    await ctx.settleFetch(id, fetched(id));
    expect(ctx.read().data.editingDocument?.id).toBe(id);
  } finally {
    ctx.cleanup();
  }
});

it("shows the open folder's view, and writes nothing for a folder it has left", () => {
  const ctx = view();
  try {
    ctx.send({ type: 'NAVIGATE_TO_FOLDER', folderId: 'Collection-b' });
    ctx.send(stored(null, [folderItem('Collection-left-behind')]));
    expect(ctx.read().data.items).toEqual([]);
    ctx.send(stored('Collection-b', [folderItem('Collection-in-b')]));
    expect(ctx.read().data.items.map(item => item.id)).toEqual(['Collection-in-b']);
  } finally {
    ctx.cleanup();
  }
});

it('keeps what the user selected when the folder re-runs, and drops it once it is gone', () => {
  const ctx = view();
  try {
    ctx.send(stored(null, [folderItem('Collection-a'), folderItem('Collection-b')]));
    ctx.send({ type: 'SELECT_ITEMS', itemIds: ['Collection-a'] });
    ctx.send(stored(null, [folderItem('Collection-a'), folderItem('Collection-b'), folderItem('Collection-c')]));
    expect(ctx.read().data.selectedItems).toEqual(['Collection-a']);
    ctx.send(stored(null, [folderItem('Collection-b')]));
    expect(ctx.read().data.selectedItems).toEqual([]);
  } finally {
    ctx.cleanup();
  }
});

it('fetches a folder on disk, and again when the system says it changed, and fills an expanded one in its slot', async () => {
  const ctx = view();
  try {
    ctx.send({ type: 'NAVIGATE_TO_FOLDER', folderId: 'symlink:Collection-linked' });
    ctx.send({ type: 'FOLDER.READ', folderId: 'symlink:Collection-linked', folder: { onDisk: true } });
    expect(ctx.sent('GET_FOLDER_CONTENTS')).toEqual([{ type: 'GET_FOLDER_CONTENTS', folderId: 'symlink:Collection-linked' }]);

    ctx.send({ type: 'FOLDER_CHANGED', folderId: 'symlink:Collection-elsewhere' });
    expect(ctx.sent('GET_FOLDER_CONTENTS'), 'a folder this window does not show').toHaveLength(1);
    ctx.send({ type: 'FOLDER_CHANGED', folderId: 'symlink:Collection-linked' });
    expect(ctx.sent('GET_FOLDER_CONTENTS')).toHaveLength(2);

    ctx.send({ type: 'EXPAND_FOLDER', folderId: 'Collection-tree' });
    ctx.send({ type: 'FOLDER.READ', folderId: 'Collection-tree', folder: { onDisk: true } });
    await ctx.end('GET_FOLDER_CONTENTS', { ok: true, value: contents('Collection-tree', [folderItem('Collection-child')]) });
    expect(ctx.read().data.expandedFolderChildren['Collection-tree'].map(item => item.id)).toEqual(['Collection-child']);
    expect(ctx.read().data.loadingFolderIds).toEqual([]);
  } finally {
    ctx.cleanup();
  }
});

it('asks whether its symlinked folders still reach their disk, and marks the ones that do not', async () => {
  const ctx = view();
  try {
    ctx.send(stored(null, [folderItem('Collection-linked', { isSymlink: true }), folderItem('Collection-plain')]));
    expect(ctx.sent('CHECK_SYMLINKS')).toEqual([{ type: 'CHECK_SYMLINKS', ids: ['Collection-linked'] }]);
    const linked = 'Collection-linked' as const;
    await ctx.end('CHECK_SYMLINKS', { ok: true, value: { ids: [linked], broken: [linked] } });
    expect(ctx.read().data.items.find(item => item.id === 'Collection-linked')).toMatchObject({ isBroken: true });
  } finally {
    ctx.cleanup();
  }
});

it('returns to the browser when the document open is deleted, here or in another window', () => {
  const ctx = view();
  try {
    ctx.send({ type: 'OPEN_ENTITY', id: 'Document-open' });
    ctx.send({ type: 'DOCUMENT.READ', documentId: 'Document-open', document: { onDisk: false, document: document('Document-open') } });
    expect(ctx.read().data.editingDocument?.id).toBe('Document-open');
    ctx.send({ type: 'DOCUMENT.READ', documentId: 'Document-open', document: { onDisk: false, document: null } });
    expect(ctx.read().at).toBe('browser');
    expect(ctx.read().data.editingDocument).toBeUndefined();
  } finally {
    ctx.cleanup();
  }
});

it('names the folder this window made, once it is shown, and reports a refused write', async () => {
  const ctx = view();
  try {
    ctx.send({ type: 'CREATE_FOLDER', name: 'Fresh' });
    await ctx.end('CREATE_COLLECTION', { ok: true, value: { collection: { id: 'Collection-fresh' } } });
    expect(ctx.read().data.itemToEdit).toBe('Collection-fresh');
    ctx.send(stored(null, [folderItem('Collection-fresh')]));
    expect(ctx.read().data.selectedItems).toEqual(['Collection-fresh']);

    ctx.send({ type: 'CREATE_FOLDER', name: 'Refused' });
    await ctx.end('CREATE_COLLECTION', { ok: false, failure: { kind: 'failed', message: 'Path does not exist' } });
    expect(ctx.read().data.writeError).toBe('Path does not exist');
    expect(ctx.read().pending.createCollection, 'no ask that ended is kept').toBe(0);
  } finally {
    ctx.cleanup();
  }
});

it('returns to the browser, saying why, when the document it opened is no longer on disk', async () => {
  const ctx = view();
  try {
    ctx.openOnDisk('Document-open');
    await ctx.settleFetch('Document-open', { ok: false, failure: { kind: 'not-found', message: 'Document not found' } as never });
    expect(ctx.read().at).toBe('browser');
    expect(ctx.read().data.writeError).toBe('Document not found');
  } finally {
    ctx.cleanup();
  }
});

it('stays on the document when its fetch was refused for a reason other than its being gone', async () => {
  const ctx = view();
  try {
    ctx.openOnDisk('Document-open');
    await ctx.settleFetch('Document-open', { ok: false, failure: { kind: 'no-access', message: 'EACCES: permission denied' } as never });
    expect(ctx.read().at).toBe('edit.ready');
    expect(ctx.read().data.writeError).toBe('EACCES: permission denied');
  } finally {
    ctx.cleanup();
  }
});

it('stays on the document when what is gone is something else this window asked for', async () => {
  const ctx = view();
  try {
    ctx.openOnDisk('Document-open');
    ctx.send({ type: 'RELINK_SYMLINK', collectionId: 'Collection-linked', newPath: '/gone' });
    await ctx.end('UPDATE_SYMLINK_PATH', { ok: false, failure: { kind: 'not-found', message: 'Path does not exist: /gone' } as never });
    expect(within(ctx.read(), 'edit')).toBe(true);
    expect(ctx.read().data.writeError).toBe('Path does not exist: /gone');
  } finally {
    ctx.cleanup();
  }
});
