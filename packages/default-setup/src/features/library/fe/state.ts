import type { OutcomeOf, Read, Value } from '@apackdev/state';
import type { OpenEntity } from '@apackdev/sdk/events';
import {
  canGoBack,
  canGoForward,
  createNavHistory,
  entityIs,
  goBack,
  goForward,
  pushNavHistory,
  type NavHistory,
  type SurfaceChrome,
  type TrailClickEvent,
} from '@apackdev/sdk/fe';
import { Trash2 } from 'lucide-vue-next';
import type { EARS } from '#generated/ears.ts';
import { state, type PackNet } from '#generated/state.ts';
import type { DocumentDTO, DocumentItem, DocumentView, FolderContents, FolderView, LibraryIndex, LibraryItem } from '#generated/types.ts';
import type { ContentSection, OutgoingLibraryEvents } from '#features/library/be/types.ts';
import type { Contract, LibraryContext, LibraryInboxEvent } from './contract.ts';
import { tagStorage } from './services/tagStorage.ts';

// The library surface over its views. The canvas holds a `folder` view for the folder shown and for each one expanded
// in the tree, the `document` view for the document open, and the `index` view, and hands each result here
// (`FOLDER.READ`, `DOCUMENT.READ`, `INDEX.READ`). What is on disk under a symlinked folder no view can see, so a
// result saying so (`onDisk`) is fetched instead (`GET_FOLDER_CONTENTS`, `GET_DOCUMENT`), and fetched again when the
// system says a folder on disk changed (`FOLDER_CHANGED`). Every answer lands in the slot its folder or document
// names, so a late answer for a folder left behind writes nothing that is shown.
//
// A document is fetched by the `edit.fetching` state that shows it. Everything else this window asks — a folder's
// contents, whether its symlinks are broken, each write — is declared under `calls`, so several run at once and how
// each ended is handled for what it was.

export const id = 'library' as const;

type LibraryAsks = PackNet['systems']['library']['asks'];

function documentItemToDTO(item: Read<DocumentItem>): DocumentDTO {
  return {
    id: item.id,
    name: item.name,
    content: item.content as ContentSection[],
    shortCode: item.shortCode,
    tags: item.tags ? [...item.tags] : [],
    collectionId: item.parentId || undefined,
    collectionPath: [], // Not available in DocumentItem
    displayOrder: item.displayOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function parseSymlinkId(itemId: string): { rootId: string; relPath: string } | null {
  if (!itemId.startsWith('symlink:')) return null;
  const rest = itemId.slice('symlink:'.length);
  const slashIdx = rest.indexOf('/');
  return slashIdx === -1
    ? { rootId: rest, relPath: '' }
    : { rootId: rest.slice(0, slashIdx), relPath: rest.slice(slashIdx + 1) };
}

function findItemById(
  items: readonly Read<LibraryItem>[],
  expandedFolderChildren: Read<Record<EARS.EntityId, LibraryItem[]>>,
  itemId: string,
): Read<LibraryItem> | undefined {
  const top = items.find(i => i.id === itemId);
  if (top) return top;
  for (const children of Object.values(expandedFolderChildren)) {
    const found = children.find(i => i.id === itemId);
    if (found) return found;
  }
  return undefined;
}

/** The folders this window shows: the one open, and each one expanded in the tree */
function shownFolders(data: Read<LibraryData>): (EARS.EntityId | null)[] {
  return [data.currentFolderId, ...data.expandedFolderIds.filter(each => each !== data.currentFolderId)];
}

/**
 * The selection once a folder's contents changed under it: the folder this window just made, once it is shown, or
 * what was selected and is still there — a commit elsewhere re-runs the view, and must not drop what the user picked
 */
function selectionAfter(
  items: readonly Read<LibraryItem>[],
  expandedFolderChildren: Read<Record<EARS.EntityId, LibraryItem[]>>,
  newItemId: EARS.EntityId | null | undefined,
  currentSelected: readonly EARS.EntityId[],
): Pick<LibraryContext, 'selectedItems' | 'selectedDocument'> {
  const selectedItems = newItemId && findItemById(items, expandedFolderChildren, newItemId)
    ? [newItemId]
    : currentSelected.filter(each => findItemById(items, expandedFolderChildren, each));
  const only = selectedItems.length === 1 ? findItemById(items, expandedFolderChildren, selectedItems[0]) : undefined;
  return { selectedItems, selectedDocument: only?.type === 'document' ? documentItemToDTO(only) : null };
}

/**
 * A folder's contents arrived, from its view or fetched from disk: the context with them in the slot their folder
 * names — the folder open, or one expanded in the tree — and nothing changed for a folder this window no longer shows
 */
function folderShown(context: Read<LibraryData>, data: Read<FolderContents>): Partial<LibraryData> {
  const items = (data.items || []) as LibraryItem[];
  const folderId = data.currentFolderId || null;
  const shown: Partial<LibraryData> = {};
  let expandedFolderChildren = context.expandedFolderChildren as Record<EARS.EntityId, LibraryItem[]>;

  if (folderId && context.expandedFolderIds.includes(folderId)) {
    expandedFolderChildren = { ...expandedFolderChildren, [folderId]: items };
    shown.expandedFolderChildren = expandedFolderChildren;
    shown.loadingFolderIds = context.loadingFolderIds.filter(each => each !== folderId);
  }
  if (folderId !== context.currentFolderId) return shown;

  const documents = items
    .filter((item): item is DocumentItem => item.type === 'document')
    .map(documentItemToDTO);
  tagStorage.updateTagsFromDocuments(documents);

  const isBroken = data.isBroken ?? false;
  const lastKnownPath = data.lastKnownPath ?? null;
  const hasSymlinkedItems = items.some(item => (item as any).isSymlinked);
  const isInSymlinkContext = isBroken || hasSymlinkedItems || (folderId?.startsWith('symlink:') ?? false);

  let currentSymlinkRootId: string | null = null;
  if (isInSymlinkContext && folderId) {
    const parsed = parseSymlinkId(folderId);
    currentSymlinkRootId = parsed ? parsed.rootId : folderId;
  }

  let symlinkBasePath: string | null = null;
  if (isInSymlinkContext && items.length > 0) {
    const symlinkItem = items.find(i => (i as any).isSymlinked);
    if (symlinkItem) {
      const fullPath = (symlinkItem as any).symlinkPath || (symlinkItem as any).filePath;
      if (fullPath && symlinkItem.name) {
        const parsed = parseSymlinkId(symlinkItem.id);
        if (parsed) {
          if (parsed.relPath) {
            const idx = fullPath.lastIndexOf(parsed.relPath);
            if (idx > 0) symlinkBasePath = fullPath.slice(0, idx - 1);
          } else {
            symlinkBasePath = fullPath.slice(0, fullPath.length - symlinkItem.name.length - 1);
          }
        }
      }
    }
  }

  return {
    ...shown,
    items,
    currentFolderId: folderId,
    currentPath: data.currentPath ? [...data.currentPath] : [],
    breadcrumbs: data.breadcrumbs ? [...data.breadcrumbs] : [],
    searchIndices: data.searchIndices ? [...data.searchIndices] : [],
    isInSymlinkContext,
    currentSymlinkRootId,
    symlinkBasePath,
    isBroken,
    lastKnownPath,
    ...selectionAfter(items, expandedFolderChildren, context.newItemId, context.selectedItems),
  };
}

/** The symlinked folders among a folder's contents: whether each still reaches its folder on disk no view can see, so it is asked */
const symlinksIn = (data: Read<FolderContents>): EARS.EntityId[] =>
  (data.items || []).filter(item => item.type === 'folder' && item.isSymlink).map(item => item.id);

/** The key a fetch of a folder on disk is made under: its folder */
const contentsKey = (folderId: EARS.EntityId | null): string => `${folderId}`;

export type LibraryEvents =
  | OpenEntity
  | TrailClickEvent
  | { type: 'VIEW_BROWSER' }
  // Document events
  | { type: 'CREATE_DOCUMENT' }
  | LibraryInboxEvent
  | { type: 'DELETE_DOCUMENT'; documentId: EARS.EntityId }
  | { type: 'SAVE_DOCUMENT'; name: string; content: ContentSection[]; tags: string[]; collectionId?: EARS.EntityId }
  | { type: 'CANCEL_EDIT' }
  // Tree view events
  | { type: 'EXPAND_FOLDER'; folderId: EARS.EntityId }
  | { type: 'COLLAPSE_FOLDER'; folderId: EARS.EntityId }
  // File browser events
  | { type: 'DOUBLE_CLICK_ITEM'; item: LibraryItem }
  | { type: 'SELECT_ITEMS'; itemIds: EARS.EntityId[] }
  | { type: 'RENAME_ITEM'; itemId: EARS.EntityId; name: string }
  | { type: 'DELETE_SELECTED_ITEMS' }
  | { type: 'CREATE_FOLDER'; name: string }
  | { type: 'SORT_BY'; column: 'name' | 'modified' | 'size' | 'kind' }
  | { type: 'MOVE_ITEMS'; itemIds: EARS.EntityId[]; targetFolderId: EARS.EntityId | null }
  | { type: 'BREADCRUMB_CLICK'; folderId: EARS.EntityId | null }
  | { type: 'CLEAR_ITEM_TO_EDIT' }
  // Symlink events
  | { type: 'CREATE_SYMLINK'; symlinkPath: string }
  | { type: 'REFRESH_FOLDER'; folderId: EARS.EntityId }
  | { type: 'RELINK_SYMLINK'; collectionId: EARS.EntityId; newPath: string }
  | { type: 'REMOVE_BROKEN_SYMLINK'; collectionId: EARS.EntityId }
  // View results, from the canvas
  | { type: 'FOLDER.READ'; folderId: EARS.EntityId | null; folder: FolderView }
  | { type: 'DOCUMENT.READ'; documentId: EARS.EntityId; document: DocumentView }
  | { type: 'INDEX.READ'; index: LibraryIndex }
  | { type: 'CLEAR_WRITE_ERROR' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' }
  // The settings form's import and export, and the result of each no longer shown
  | { type: 'IMPORT'; directory: string }
  | { type: 'FORGET_IMPORT' }
  | { type: 'EXPORT'; directory: string; format: 'markdown' | 'json' }
  | { type: 'FORGET_EXPORT' }
  | OutgoingLibraryEvents;

type LibraryData = Omit<
  LibraryContext,
  'editingDocument' | 'editingDocumentId' | 'editingItem' | 'itemToEdit' | 'newItemId' | 'editingIndexId' | 'editingIndex' | 'testingIndexId' | 'testingIndex'
> & {
  editingDocument: DocumentDTO | undefined;
  editingDocumentId: EARS.EntityId | undefined;
  editingItem: LibraryItem | undefined;
  itemToEdit: EARS.EntityId | null;
  newItemId: EARS.EntityId | null;
  editingIndexId: string | undefined;
  editingIndex: LibraryContext['editingIndex'];
  testingIndexId: string | undefined;
  testingIndex: LibraryContext['testingIndex'];
  /** How the last import ended, until another folder is picked */
  imported: OutcomeOf<LibraryAsks['IMPORT_LIBRARY']> | undefined;
  /** How the last export ended, until another is made */
  exported: OutcomeOf<LibraryAsks['EXPORT_LIBRARY']> | undefined;
};

type LibraryShape = {
  data: LibraryData;
  calls: {
    contents: { readonly each: LibraryAsks['GET_FOLDER_CONTENTS']['args'] };
    symlinks: { readonly many: LibraryAsks['CHECK_SYMLINKS']['args'] };
    createDocument: { readonly many: LibraryAsks['CREATE_DOCUMENT']['args'] };
    updateDocument: { readonly many: LibraryAsks['UPDATE_DOCUMENT']['args'] };
    createCollection: { readonly many: LibraryAsks['CREATE_COLLECTION']['args'] };
    createSymlinkCollection: { readonly many: LibraryAsks['CREATE_SYMLINK_COLLECTION']['args'] };
    renameItem: { readonly many: LibraryAsks['RENAME_ITEM']['args'] };
    deleteItems: { readonly many: LibraryAsks['DELETE_ITEMS']['args'] };
    moveItems: { readonly many: LibraryAsks['MOVE_ITEMS']['args'] };
    updateSymlinkPath: { readonly many: LibraryAsks['UPDATE_SYMLINK_PATH']['args'] };
    importLibrary: { readonly one: LibraryAsks['IMPORT_LIBRARY']['args'] };
    exportLibrary: { readonly one: LibraryAsks['EXPORT_LIBRARY']['args'] };
  };
  states: {
    browser: {};
    create: {};
    edit: {
      states: {
        ready: {};
        fetching: {};
      };
    };
  };
};

function navigateData(data: Read<LibraryData>, folderId: EARS.EntityId | null): Partial<LibraryData> {
  if (folderId === data.currentFolderId) {
    return { newItemId: null, selectedItems: [], selectedDocument: null };
  }
  return {
    currentFolderId: folderId,
    newItemId: null,
    navHistory: pushNavHistory(data.navHistory as NavHistory<EARS.EntityId | null>, folderId),
    selectedItems: [],
    selectedDocument: null,
  };
}

function editingDocumentData(data: Read<LibraryData>, documentId: EARS.EntityId): Partial<LibraryData> {
  const item = findItemById(data.items, data.expandedFolderChildren, documentId);
  // A symlinked document's tree item has no content: the backend reads it from the filesystem
  const symlinked = documentId.startsWith('symlink:') || (item?.type === 'document' && (item as Read<DocumentItem>).isSymlinked);
  return {
    currentView: 'edit' as const,
    editingDocumentId: documentId,
    editingDocument: item?.type === 'document' && !symlinked ? documentItemToDTO(item) : undefined,
    selectedItems: [],
    selectedDocument: null,
  };
}

export const libraryChrome: SurfaceChrome<Value<LibraryShape>> = {
  default: { label: 'Library', target: 'browser' },
  states: {
    browser: {
      breadcrumb: { label: 'Library', target: 'browser' },
    },
    create: {
      breadcrumb: { label: 'New Document', target: 'create' },
    },
    edit: {
      breadcrumb: ({ data }) => ({
        label: `${data.editingDocument?.name || 'Document'}`,
        target: 'edit',
      }),
      menu: ({ data }) => {
        if (!data.editingDocument) return [];
        return [
          {
            label: 'Delete Document',
            icon: Trash2,
            event: { type: 'DELETE_DOCUMENT' as const, documentId: data.editingDocument.id },
            iconColor: 'text-red-400',
            confirm: `Are you sure you want to delete "${data.editingDocument.name || 'this document'}"?`,
          },
        ];
      },
    },
  },
};

export const librarySystem = state<LibraryShape, LibraryEvents>()({
  initial: 'browser',
  data: {
    currentView: 'browser',
    editingDocument: undefined,
    editingDocumentId: undefined,
    items: [],
    currentFolderId: null,
    currentPath: [],
    selectedItems: [],
    selectedDocument: null,
    sortBy: 'name',
    sortDirection: 'asc',
    breadcrumbs: [],
    editingItem: undefined,
    itemToEdit: null,
    newItemId: null,
    expandedFolderIds: [],
    expandedFolderChildren: {},
    loadingFolderIds: [],
    diskFolderIds: [],
    searchIndices: [],
    editingIndexId: undefined,
    editingIndex: undefined,
    testingIndexId: undefined,
    testingIndex: undefined,
    testQuery: '',
    testResults: [],
    isSearching: false,
    isInSymlinkContext: false,
    currentSymlinkRootId: null,
    symlinkBasePath: null,
    isBroken: false,
    lastKnownPath: null,
    writeError: null,
    imported: undefined,
    exported: undefined,
    navHistory: createNavHistory<EARS.EntityId | null>(null),
  },
  calls: ({ one, each, many }) => ({
    contents: each('library', 'GET_FOLDER_CONTENTS', {
      args: (_key, input) => input,
      done: (outcome, { key, data, call }) => {
        if (!outcome.ok) {
          return {
            data: {
              loadingFolderIds: data.loadingFolderIds.filter(eachId => eachId !== key),
              writeError: outcome.failure.message,
            },
          };
        }
        const contents = outcome.value;
        const symlinks = symlinksIn(contents);
        if (symlinks.length > 0) call('symlinks', { ids: symlinks });
        return { data: folderShown(data, contents) };
      },
    }),
    symlinks: many('library', 'CHECK_SYMLINKS', {
      done: (outcome, { data }) => {
        if (!outcome.ok) return { data: { writeError: outcome.failure.message } };
        const { ids, broken } = outcome.value;
        const mark = (items: readonly Read<LibraryItem>[]): LibraryItem[] =>
          items.map(item =>
            item.type === 'folder' && ids.includes(item.id)
              ? { ...(item as LibraryItem & { type: 'folder' }), isBroken: broken.includes(item.id) }
              : (item as LibraryItem),
          );
        return {
          data: {
            items: mark(data.items),
            expandedFolderChildren: Object.fromEntries(
              Object.entries(data.expandedFolderChildren).map(([folderId, items]) => [folderId, mark(items)]),
            ),
          },
        };
      },
    }),
    createDocument: many('library', 'CREATE_DOCUMENT', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    updateDocument: many('library', 'UPDATE_DOCUMENT', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    createCollection: many('library', 'CREATE_COLLECTION', {
      done: (outcome) => {
        if (!outcome.ok) return { data: { writeError: outcome.failure.message } };
        const collection = outcome.value.collection;
        return collection ? { data: { itemToEdit: collection.id, newItemId: collection.id } } : undefined;
      },
    }),
    createSymlinkCollection: many('library', 'CREATE_SYMLINK_COLLECTION', {
      done: (outcome) => {
        if (!outcome.ok) return { data: { writeError: outcome.failure.message } };
        const collection = outcome.value.collection;
        return collection ? { data: { itemToEdit: collection.id, newItemId: collection.id } } : undefined;
      },
    }),
    renameItem: many('library', 'RENAME_ITEM', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    deleteItems: many('library', 'DELETE_ITEMS', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    moveItems: many('library', 'MOVE_ITEMS', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    updateSymlinkPath: many('library', 'UPDATE_SYMLINK_PATH', {
      done: (outcome) => (outcome.ok ? undefined : { data: { writeError: outcome.failure.message } }),
    }),
    importLibrary: one('library', 'IMPORT_LIBRARY', {
      done: (outcome) => ({ data: { imported: outcome } }),
    }),
    exportLibrary: one('library', 'EXPORT_LIBRARY', {
      done: (outcome) => ({ data: { exported: outcome } }),
    }),
  }),
  on: {
    OPEN_ENTITY: (event, { data }) => {
      if (entityIs<Contract['opens']>({ event }, { entity: 'Document' })) {
        return { at: 'edit', data: editingDocumentData(data, event.id as EARS.EntityId) };
      }
      if (entityIs<Contract['opens']>({ event }, { entity: 'Collection' })) {
        return {
          at: 'browser',
          data: {
            currentView: 'browser',
            editingDocumentId: undefined,
            ...navigateData(data, event.id as EARS.EntityId),
          },
        };
      }
    },
    EDIT_DOCUMENT: (event, { data }) => ({
      at: 'edit',
      data: editingDocumentData(data, event.documentId),
    }),
    'FOLDER.READ': (event, { data, call, cancel }) => {
      const { folderId, folder } = event;
      if (folder.onDisk) {
        const key = contentsKey(folderId);
        cancel('contents', key);
        call('contents', key, { folderId });
        if (!data.diskFolderIds.includes(folderId)) {
          return { data: { diskFolderIds: [...data.diskFolderIds, folderId] } };
        }
        return;
      }
      const symlinks = symlinksIn(folder.contents);
      if (symlinks.length > 0) call('symlinks', { ids: symlinks });
      return {
        data: {
          ...(data.diskFolderIds.includes(folderId)
            ? { diskFolderIds: data.diskFolderIds.filter(each => each !== folderId) }
            : {}),
          ...folderShown(data, folder.contents),
        },
      };
    },
    'INDEX.READ': (event) => {
      tagStorage.updateTagsFromDocuments(event.index.documents);
    },
    FOLDER_CHANGED: (event, { data, call, cancel }) => {
      for (const folderId of shownFolders(data)) {
        if (!data.diskFolderIds.includes(folderId)) continue;
        if (event.folderId === null || event.folderId === folderId) {
          const key = contentsKey(folderId);
          cancel('contents', key);
          call('contents', key, { folderId });
        }
      }
    },
    IMPORT: (event, { call, cancel }) => {
      cancel('importLibrary');
      call('importLibrary', { directory: event.directory });
      return { data: { imported: undefined } };
    },
    FORGET_IMPORT: () => ({ data: { imported: undefined } }),
    EXPORT: (event, { call, cancel }) => {
      cancel('exportLibrary');
      call('exportLibrary', { directory: event.directory, format: event.format });
      return { data: { exported: undefined } };
    },
    FORGET_EXPORT: () => ({ data: { exported: undefined } }),
    VIEW_BROWSER: () => ({ at: 'browser', data: { currentView: 'browser', editingDocumentId: undefined } }),
    NAVIGATE_TO_FOLDER: (event, { data }) => ({
      at: 'browser',
      data: {
        currentView: 'browser',
        editingDocumentId: undefined,
        ...navigateData(data, event.folderId),
      },
    }),
    BREADCRUMB_CLICK: (event, { data }) => ({ data: navigateData(data, event.folderId) }),
    NAVIGATE_BACK: (_event, { data }) => {
      const nav = data.navHistory as NavHistory<EARS.EntityId | null>;
      if (!canGoBack(nav)) return;
      const result = goBack(nav)!;
      return {
        data: {
          navHistory: result.history,
          currentFolderId: result.entry,
          selectedItems: [],
          selectedDocument: null,
        },
      };
    },
    NAVIGATE_FORWARD: (_event, { data }) => {
      const nav = data.navHistory as NavHistory<EARS.EntityId | null>;
      if (!canGoForward(nav)) return;
      const result = goForward(nav)!;
      return {
        data: {
          navHistory: result.history,
          currentFolderId: result.entry,
          selectedItems: [],
          selectedDocument: null,
        },
      };
    },
    DOUBLE_CLICK_ITEM: (event, { data }) => {
      if (event.item.type === 'folder') {
        return {
          at: 'browser',
          data: {
            currentView: 'browser',
            editingDocumentId: undefined,
            ...navigateData(data, event.item.id),
          },
        };
      }
      if (event.item.type === 'document') {
        return {
          at: 'edit',
          data: {
            ...editingDocumentData(data, event.item.id),
            newItemId: null,
          },
        };
      }
      return { data: { selectedItems: [], selectedDocument: null, newItemId: null } };
    },
    SELECT_ITEMS: (event, { data }) => {
      const selectedItems = event.itemIds || [];
      let selectedDocument: DocumentDTO | null = null;
      if (selectedItems.length === 1) {
        const item = findItemById(data.items, data.expandedFolderChildren, selectedItems[0]);
        selectedDocument = item?.type === 'document' ? documentItemToDTO(item) : null;
      }
      return { data: { selectedItems, selectedDocument, newItemId: null } };
    },
    SORT_BY: (event, { data }) => ({
      data: {
        sortBy: event.column,
        sortDirection: data.sortBy === event.column && data.sortDirection === 'asc' ? 'desc' as const : 'asc' as const,
      },
    }),
    DELETE_SELECTED_ITEMS: (_event, { data, call }) => {
      if (data.selectedItems.length > 0) call('deleteItems', { ids: [...data.selectedItems] });
    },
    RENAME_ITEM: (event, { data, call }) => {
      const itemType = findItemById(data.items, data.expandedFolderChildren, event.itemId)?.type === 'folder' ? 'folder' : 'document';
      call('renameItem', { id: event.itemId, name: event.name, itemType });
    },
    CREATE_FOLDER: (event, { data, call }) => {
      call('createCollection', { name: event.name, parentId: data.currentFolderId || undefined });
    },
    MOVE_ITEMS: (event, { call }) => {
      call('moveItems', { ids: event.itemIds, targetFolderId: event.targetFolderId });
    },
    CLEAR_ITEM_TO_EDIT: () => ({ data: { itemToEdit: null } }),
    EXPAND_FOLDER: (event, { data }) => {
      const { folderId } = event;
      if (data.expandedFolderIds.includes(folderId)) return;
      const isCached = folderId in data.expandedFolderChildren;
      return {
        data: {
          expandedFolderIds: [...data.expandedFolderIds, folderId],
          loadingFolderIds: isCached ? data.loadingFolderIds : [...data.loadingFolderIds, folderId],
        },
      };
    },
    COLLAPSE_FOLDER: (event, { data }) => ({
      data: {
        expandedFolderIds: data.expandedFolderIds.filter(each => each !== event.folderId),
        loadingFolderIds: data.loadingFolderIds.filter(each => each !== event.folderId),
      },
    }),
    CREATE_SYMLINK: (event, { data, call }) => {
      const pathParts = event.symlinkPath.split(/[/\\]/).filter(Boolean);
      call('createSymlinkCollection', {
        name: pathParts[pathParts.length - 1] || 'Symlink',
        symlinkPath: event.symlinkPath,
        parentId: data.currentFolderId || undefined,
      });
    },
    REFRESH_FOLDER: (event, { call, cancel }) => {
      const key = contentsKey(event.folderId);
      cancel('contents', key);
      call('contents', key, { folderId: event.folderId });
    },
    RELINK_SYMLINK: (event, { call }) => {
      call('updateSymlinkPath', { collectionId: event.collectionId, newPath: event.newPath });
    },
    REMOVE_BROKEN_SYMLINK: (event, { call }) => {
      call('deleteItems', { ids: [event.collectionId] });
      return { data: { isBroken: false, lastKnownPath: null } };
    },
    CLEAR_WRITE_ERROR: () => ({ data: { writeError: null } }),
    TRAIL_CLICK: (event) => {
      if (event.target === 'browser') return { at: 'browser', data: { currentView: 'browser', editingDocumentId: undefined } };
      if (event.target === 'create') return { at: 'create', data: { currentView: 'create', editingDocumentId: undefined } };
      if (event.target === 'edit') return { at: 'edit', data: { currentView: 'edit' } };
    },
  },
  states: {
    browser: {
      on: {
        CREATE_DOCUMENT: (_event, { data, call }) => {
          if (data.isInSymlinkContext) {
            if (data.currentFolderId) {
              call('createDocument', {
                name: 'New Document.txt',
                content: [],
                tags: [],
                collectionId: data.currentFolderId,
              });
            }
            return;
          }
          return { at: 'create', data: { currentView: 'create', editingDocumentId: undefined } };
        },
      },
    },
    create: {
      on: {
        SAVE_DOCUMENT: (event, { data, call }) => {
          if (event.tags?.length) tagStorage.addTags(event.tags);
          call('createDocument', {
            name: event.name,
            content: event.content,
            tags: event.tags,
            collectionId: event.collectionId || data.currentFolderId || undefined,
          });
          return { at: 'browser', data: { currentView: 'browser', editingDocumentId: undefined } };
        },
        CANCEL_EDIT: () => ({ at: 'browser', data: { currentView: 'browser', editingDocumentId: undefined } }),
      },
    },
    edit: {
      initial: 'ready',
      states: {
        ready: {},
        fetching: {
          run: async ({ data, ask }) => {
            const outcome = await ask('library', 'GET_DOCUMENT', { id: data.editingDocumentId! });
            if (outcome.ok) {
              return { at: 'edit.ready', data: { editingDocument: outcome.value.document } };
            }
            if (outcome.failure.kind === 'not-found') {
              // Nothing to edit: back to where it was opened from, saying why
              return {
                at: 'browser',
                data: {
                  currentView: 'browser',
                  editingDocument: undefined,
                  editingDocumentId: undefined,
                  writeError: outcome.failure.message,
                },
              };
            }
            return { at: 'edit.ready', data: { writeError: outcome.failure.message } };
          },
          failed: (error) => ({
            at: 'edit.ready',
            data: { writeError: error instanceof Error ? error.message : String(error) },
          }),
        },
      },
      on: {
        'DOCUMENT.READ': (event, { data }) => {
          if (event.documentId !== data.editingDocumentId) return;
          if (!event.document.onDisk && event.document.document === null) {
            return {
              at: 'browser',
              data: { currentView: 'browser', editingDocument: undefined, editingDocumentId: undefined },
            };
          }
          if (event.document.onDisk && !data.editingDocument) {
            return { at: 'edit.fetching' };
          }
          if (!event.document.onDisk && event.document.document) {
            return { data: { editingDocument: event.document.document } };
          }
        },
        SAVE_DOCUMENT: (event, { data, call }) => {
          if (data.editingDocument) {
            const oldTags = data.editingDocument.tags || [];
            const newTags = event.tags || [];
            const removed = oldTags.filter(tag => !newTags.includes(tag));
            const added = newTags.filter(tag => !oldTags.includes(tag));
            if (removed.length) tagStorage.removeTags(removed);
            if (added.length) tagStorage.addTags(added);

            call('updateDocument', {
              id: data.editingDocument.id,
              name: event.name,
              content: event.content,
              tags: event.tags,
            });
          }
          return {
            at: 'browser',
            data: { currentView: 'browser', editingDocument: undefined, editingDocumentId: undefined },
          };
        },
        CANCEL_EDIT: () => ({
          at: 'browser',
          data: { currentView: 'browser', editingDocument: undefined, editingDocumentId: undefined },
        }),
        DELETE_DOCUMENT: (event, { call }) => {
          call('deleteItems', { ids: [event.documentId] });
          return {
            at: 'browser',
            data: { currentView: 'browser', editingDocument: undefined, editingDocumentId: undefined },
          };
        },
      },
    },
  },
});

export default librarySystem;
