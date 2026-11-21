import { askId, endedAsk, entityIs } from '@apackdev/sdk/fe'
import type { OpenEntity, UntypedAskOutcome } from '@apackdev/sdk/events'
import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate'
import type { DocumentDTO, DocumentView, FolderContents, FolderView, LibraryIndex, LibraryItem, DocumentItem } from '#generated/types.ts'
import type { Contract, LibraryContext, LibraryInboxEvent } from './contract.ts'
import type { OutgoingLibraryEvents } from '#features/library/be/types.ts'
import type { SearchIndexFormData } from './types/search-index.ts'
import { fromAsk, type ask } from '#generated/events.ts'
import type { EARS } from '#generated/ears.ts'
import { onOutcome, outcomeOf } from '@apackdev/sdk/helpers'
import { Trash2 } from 'lucide-vue-next'
import { contextMenuFn } from '@apackdev/sdk/fe'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe'
import { targetIs, TRAIL_CLICK } from '@apackdev/sdk/fe'
import { tagStorage } from './services/tagStorage.ts'
import { createNavHistory, pushNavHistory, goBack, goForward, canGoBack, canGoForward } from '@apackdev/sdk/fe'

// The library surface over its views. The canvas holds a `folder` view for the folder shown and for each one expanded
// in the tree, the `document` view for the document open, and the `index` view, and hands each result here
// (`FOLDER.READ`, `DOCUMENT.READ`, `INDEX.READ`). What is on disk under a symlinked folder no view can see, so a
// result saying so (`onDisk`) is fetched instead (`GET_FOLDER_CONTENTS`, `GET_DOCUMENT`), and fetched again when the
// system says a folder on disk changed (`FOLDER_CHANGED`). Every answer lands in the slot its folder or document
// names, so a late answer for a folder left behind writes nothing that is shown.
//
// A document is fetched by the state that shows it. Everything else this window asks — a folder's contents, whether
// its symlinks are broken, each write — is an ask spawned under a name that says which kind it is, so several run at
// once and each one's done event is handled for what it was.

// Helper function to convert DocumentItem to DocumentDTO
function documentItemToDTO(item: DocumentItem): DocumentDTO {
  return {
    id: item.id,
    name: item.name,
    content: item.content,
    shortCode: item.shortCode,
    tags: item.tags || [],
    collectionId: item.parentId || undefined,
    collectionPath: [], // Not available in DocumentItem
    displayOrder: item.displayOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}

function parseSymlinkId(id: string): { rootId: string; relPath: string } | null {
  if (!id.startsWith('symlink:')) return null
  const rest = id.slice('symlink:'.length)
  const slashIdx = rest.indexOf('/')
  return slashIdx === -1
    ? { rootId: rest, relPath: '' }
    : { rootId: rest.slice(0, slashIdx), relPath: rest.slice(slashIdx + 1) }
}

function findItemById(context: LibraryContext, id: string): LibraryItem | undefined {
  const top = context.items.find(i => i.id === id)
  if (top) return top
  for (const children of Object.values(context.expandedFolderChildren)) {
    const found = children.find(i => i.id === id)
    if (found) return found
  }
  return undefined
}

export const id = 'library' as const;

/** The folders this window shows: the one open, and each one expanded in the tree */
function shownFolders(context: LibraryContext): (EARS.EntityId | null)[] {
  return [context.currentFolderId, ...context.expandedFolderIds.filter(each => each !== context.currentFolderId)]
}

/**
 * A folder's contents arrived, from its view or fetched from disk: the context with them in the slot their folder
 * names — the folder open, or one expanded in the tree — and nothing changed for a folder this window no longer shows
 */
function folderShown(context: LibraryContext, data: FolderContents): Partial<LibraryContext> {
  const items = data.items || []
  const folderId = data.currentFolderId || null
  const shown: Partial<LibraryContext> = {}

  if (folderId && context.expandedFolderIds.includes(folderId)) {
    shown.expandedFolderChildren = { ...context.expandedFolderChildren, [folderId]: items }
    shown.loadingFolderIds = context.loadingFolderIds.filter(each => each !== folderId)
  }
  if (folderId !== context.currentFolderId) return shown

  const documents = items
    .filter((item): item is DocumentItem => item.type === 'document')
    .map(documentItemToDTO)
  tagStorage.updateTagsFromDocuments(documents)

  // Detect broken symlink state
  const isBroken = data.isBroken ?? false
  const lastKnownPath = data.lastKnownPath ?? null

  // Detect symlink context
  const hasSymlinkedItems = items.some(item => (item as any).isSymlinked)
  const isInSymlinkContext = isBroken || hasSymlinkedItems || (folderId?.startsWith('symlink:') ?? false)

  // Find the symlink root ID
  let currentSymlinkRootId: string | null = null
  if (isInSymlinkContext && folderId) {
    const parsed = parseSymlinkId(folderId)
    currentSymlinkRootId = parsed ? parsed.rootId : folderId
  }

  // Derive symlinkBasePath from symlinked items
  let symlinkBasePath: string | null = null
  if (isInSymlinkContext && items.length > 0) {
    const symlinkItem = items.find(i => (i as any).isSymlinked)
    if (symlinkItem) {
      const fullPath = (symlinkItem as any).symlinkPath || (symlinkItem as any).filePath
      if (fullPath && symlinkItem.name) {
        const parsed = parseSymlinkId(symlinkItem.id)
        if (parsed) {
          if (parsed.relPath) {
            const idx = fullPath.lastIndexOf(parsed.relPath)
            if (idx > 0) symlinkBasePath = fullPath.slice(0, idx - 1)
          } else {
            symlinkBasePath = fullPath.slice(0, fullPath.length - symlinkItem.name.length - 1)
          }
        }
      }
    }
  }

  return {
    ...shown,
    items,
    currentFolderId: folderId,
    currentPath: data.currentPath || [],
    breadcrumbs: data.breadcrumbs || [],
    searchIndices: data.searchIndices || [],
    isInSymlinkContext,
    currentSymlinkRootId,
    symlinkBasePath,
    isBroken,
    lastKnownPath,
    ...selectionAfter({ ...context, ...shown, items }),
  }
}

/**
 * The selection once a folder's contents changed under it: the folder this window just made, once it is shown, or
 * what was selected and is still there — a commit elsewhere re-runs the view, and must not drop what the user picked
 */
function selectionAfter(context: LibraryContext): Pick<LibraryContext, 'selectedItems' | 'selectedDocument'> {
  const selectedItems = context.newItemId && findItemById(context, context.newItemId)
    ? [context.newItemId]
    : context.selectedItems.filter(each => findItemById(context, each))
  const only = selectedItems.length === 1 ? findItemById(context, selectedItems[0]) : undefined
  return { selectedItems, selectedDocument: only?.type === 'document' ? documentItemToDTO(only) : null }
}

/** The symlinked folders among a folder's contents: whether each still reaches its folder on disk no view can see, so it is asked */
const symlinksIn = (data: FolderContents): EARS.EntityId[] =>
  (data.items || []).filter(item => item.type === 'folder' && item.isSymlink).map(item => item.id)
import type { ContentSection } from '#features/library/be/types.ts';

/** The library surface's actor, as its own components reach it with `useSurface<LibraryActor>()` */
export type LibraryActor = ActorRefFrom<typeof librarySystem>

export type LibraryEvents =
  | OpenEntity
  | { type: 'SURFACE_ACTIVATED' }
  | { type: 'TRAIL_CLICK'; trail: string[] }
  | { type: 'VIEW_BROWSER' }

  // Document events
  | { type: 'CREATE_DOCUMENT' }
  | LibraryInboxEvent
  | { type: 'DELETE_DOCUMENT'; documentId: EARS.EntityId }
  | { type: 'SAVE_DOCUMENT'; name: string; content: ContentSection[]; tags: string[]; collectionId?: EARS.EntityId }
  | { type: 'CANCEL_EDIT' }

  // Search Index events
  | { type: 'CREATE_SEARCH_INDEX' }
  | { type: 'SAVE_SEARCH_INDEX'; config: SearchIndexFormData }
  | { type: 'CANCEL_CREATE_INDEX' }
  | { type: 'LIST_SEARCH_INDICES' }
  | { type: 'EDIT_SEARCH_INDEX'; indexId: string }
  | { type: 'UPDATE_SEARCH_INDEX'; indexId: string; config: SearchIndexFormData }
  | { type: 'DELETE_SEARCH_INDEX'; indexId: string }
  | { type: 'CANCEL_EDIT_INDEX' }

  // Search test events
  | { type: 'TEST_SEARCH_INDEX'; indexId: string }
  | { type: 'UPDATE_TEST_QUERY'; query: string }
  | { type: 'EXECUTE_TEST_SEARCH' }
  | { type: 'CANCEL_TEST_SEARCH' }

  // Collection events
  | { type: 'CREATE_COLLECTION'; name: string; description?: string; parentId?: EARS.EntityId }

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
  | { type: 'SEARCH'; query: string }
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
  | OutgoingLibraryEvents
  | AskEnded<'contents', Asked<'GET_FOLDER_CONTENTS'>>
  | AskEnded<'symlinks', Asked<'CHECK_SYMLINKS'>>
  | AskEnded<'folder', Asked<'CREATE_COLLECTION'> | Asked<'CREATE_SYMLINK_COLLECTION'>>
  | AskEnded<'write', UntypedAskOutcome>

/** How an ask of the library ended */
type Asked<K extends 'GET_DOCUMENT' | 'GET_FOLDER_CONTENTS' | 'CHECK_SYMLINKS' | 'CREATE_COLLECTION' | 'CREATE_SYMLINK_COLLECTION'> = Awaited<ReturnType<typeof ask<'library', K>>>

/**
 * The kinds of ask this machine spawns: a fetch of a folder's `contents`, a check of `symlinks`, a write that makes a
 * `folder` this window then names, and every other `write`
 */
type AskKind = 'contents' | 'symlinks' | 'folder' | 'write'

/** The done event of an ask spawned as `Kind`: how it ended, and the name it was spawned under */
type AskEnded<Kind extends AskKind, O> = { type: `xstate.done.actor.${Kind}.${string}`; output: O; actorId: string }

/** The id a fetch of a folder on disk is spawned under: one per folder, so its end names the folder it was for */
const CONTENTS = 'contents.'
const contentsAsk = (folderId: EARS.EntityId | null): string => `${CONTENTS}${folderId}`

/** Fetches a folder on disk, in place of a fetch of the same folder under way */
function fetchContents(
  enqueue: { stopChild(id: string): void; spawnChild(src: 'getFolderContents', options: { id: string; input: { folderId: EARS.EntityId | null } }): void },
  folderId: EARS.EntityId | null,
): void {
  enqueue.stopChild(contentsAsk(folderId))
  enqueue.spawnChild('getFolderContents', { id: contentsAsk(folderId), input: { folderId } })
}

/** Whether an event is the done event of an ask spawned as `kind` */
const isEnded = <Kind extends AskKind>(kind: Kind, event: LibraryEvents): event is Extract<LibraryEvents, { type: `xstate.done.actor.${Kind}.${string}` }> =>
  event.type.startsWith(`xstate.done.actor.${kind}.`)

/** Every done event of an ask this machine spawned, as a transition names them */
const ENDED = { contents: 'xstate.done.actor.contents.*', symlinks: 'xstate.done.actor.symlinks.*', folder: 'xstate.done.actor.folder.*', write: 'xstate.done.actor.write.*' } as const

/** How a fetch of the document open on disk ended */
type DocumentFetched = Asked<'GET_DOCUMENT'>

export const librarySystem = setup({
  types: {
    context: {} as LibraryContext,
    events: {} as LibraryEvents,
  },
  actors: {
    // A document on disk is read when it is opened, which no view can do for it
    getDocument: fromAsk('library', 'GET_DOCUMENT'),
    // What is on disk under a symlinked folder, which no view can see
    getFolderContents: fromAsk('library', 'GET_FOLDER_CONTENTS'),
    checkSymlinks: fromAsk('library', 'CHECK_SYMLINKS'),
    // This window's writes. What one changed reaches every window through the views; one refused is shown here
    createDocument: fromAsk('library', 'CREATE_DOCUMENT'),
    updateDocument: fromAsk('library', 'UPDATE_DOCUMENT'),
    createCollection: fromAsk('library', 'CREATE_COLLECTION'),
    createSymlinkCollection: fromAsk('library', 'CREATE_SYMLINK_COLLECTION'),
    renameItem: fromAsk('library', 'RENAME_ITEM'),
    deleteItems: fromAsk('library', 'DELETE_ITEMS'),
    moveItems: fromAsk('library', 'MOVE_ITEMS'),
    updateSymlinkPath: fromAsk('library', 'UPDATE_SYMLINK_PATH'),
  },
  actions: {
    // File browser actions
    navigate: assign(({ context, event }) => {
      if (event.type !== 'OPEN_ENTITY' && event.type !== 'NAVIGATE_TO_FOLDER' && event.type !== 'BREADCRUMB_CLICK' && event.type !== 'DOUBLE_CLICK_ITEM') return {}
      const folderId = event.type === 'OPEN_ENTITY' ? event.id : event.type === 'DOUBLE_CLICK_ITEM' ? event.item.id : event.folderId
      if (folderId === context.currentFolderId) return { newItemId: null }
      return { currentFolderId: folderId, newItemId: null, navHistory: pushNavHistory(context.navHistory, folderId) }
    }),
    readFolder: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'FOLDER.READ') return
      const { folderId, folder } = event
      if (folder.onDisk) {
        if (!context.diskFolderIds.includes(folderId)) enqueue.assign({ diskFolderIds: [...context.diskFolderIds, folderId] })
        fetchContents(enqueue, folderId)
        return
      }
      if (context.diskFolderIds.includes(folderId)) enqueue.assign({ diskFolderIds: context.diskFolderIds.filter(each => each !== folderId) })
      enqueue.assign(({ context }) => folderShown(context, folder.contents))
      const symlinks = symlinksIn(folder.contents)
      if (symlinks.length > 0) enqueue.spawnChild('checkSymlinks', { id: askId('symlinks'), input: { ids: symlinks } })
    }),
    folderFetched: enqueueActions(({ event, enqueue }) => {
      if (!isEnded('contents', event)) return
      if (!event.output.ok) {
        // A folder that could not be fetched is not being loaded any more; `askEnded` says why
        const folderId = event.actorId.slice(CONTENTS.length)
        enqueue.assign(({ context }) => ({ loadingFolderIds: context.loadingFolderIds.filter(each => each !== folderId) }))
        return
      }
      const contents = event.output.value
      enqueue.assign(({ context }) => folderShown(context, contents))
      const symlinks = symlinksIn(contents)
      if (symlinks.length > 0) enqueue.spawnChild('checkSymlinks', { id: askId('symlinks'), input: { ids: symlinks } })
    }),
    fetchChangedFolders: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'FOLDER_CHANGED') return
      for (const folderId of shownFolders(context)) {
        if (!context.diskFolderIds.includes(folderId)) continue
        if (event.folderId === null || event.folderId === folderId) fetchContents(enqueue, folderId)
      }
    }),
    markBrokenSymlinks: assign(({ context, event }) => {
      if (!isEnded('symlinks', event) || !event.output.ok) return {}
      const { ids, broken } = event.output.value
      const mark = (items: LibraryItem[]) => items.map(item => (item.type === 'folder' && ids.includes(item.id)
        ? { ...item, isBroken: broken.includes(item.id) }
        : item))
      return {
        items: mark(context.items),
        expandedFolderChildren: Object.fromEntries(Object.entries(context.expandedFolderChildren).map(([folderId, items]) => [folderId, mark(items)])),
      }
    }),
    openDocument: ({ event, self }) => {
      if (event.type === 'DOUBLE_CLICK_ITEM') {
        if (event.item.type === 'document') {
          // A symlinked document's content is on disk, which its view says and the editor then fetches
          self.send({ type: 'EDIT_DOCUMENT', documentId: event.item.id })
        }
      }
    },
    createDocument: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'SAVE_DOCUMENT') return
      if (event.tags?.length) tagStorage.addTags(event.tags)
      enqueue.spawnChild('createDocument', { id: askId('write'), input: {
        name: event.name,
        content: event.content,
        tags: event.tags,
        collectionId: event.collectionId || context.currentFolderId || undefined,
      } })
    }),
    // A file made in the folder on disk that is open, which the browser then names in place
    createDocumentOnDisk: enqueueActions(({ context, enqueue }) => {
      if (!context.currentFolderId) return
      enqueue.spawnChild('createDocument', { id: askId('write'), input: { name: 'New Document.txt', content: [], tags: [], collectionId: context.currentFolderId } })
    }),
    createFolder: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'CREATE_FOLDER') return
      enqueue.spawnChild('createCollection', { id: askId('folder'), input: { name: event.name, parentId: context.currentFolderId || undefined } })
    }),
    deleteSelectedItems: enqueueActions(({ context, enqueue }) => {
      if (context.selectedItems.length > 0) enqueue.spawnChild('deleteItems', { id: askId('write'), input: { ids: context.selectedItems } })
    }),
    moveItems: enqueueActions(({ event, enqueue }) => {
      if (event.type !== 'MOVE_ITEMS') return
      enqueue.spawnChild('moveItems', { id: askId('write'), input: { ids: event.itemIds, targetFolderId: event.targetFolderId } })
    }),
    // Tree view actions
    expandFolder: assign(({ context, event }) => {
      if (event.type !== 'EXPAND_FOLDER') return {}
      const { folderId } = event
      const alreadyExpanded = context.expandedFolderIds.includes(folderId)
      if (alreadyExpanded) return {}
      const isCached = folderId in context.expandedFolderChildren
      return {
        expandedFolderIds: [...context.expandedFolderIds, folderId],
        loadingFolderIds: isCached
          ? context.loadingFolderIds
          : [...context.loadingFolderIds, folderId],
      }
    }),
    collapseFolder: assign(({ context, event }) => {
      if (event.type !== 'COLLAPSE_FOLDER') return {}
      const { folderId } = event
      return {
        expandedFolderIds: context.expandedFolderIds.filter(id => id !== folderId),
        loadingFolderIds: context.loadingFolderIds.filter(id => id !== folderId),
      }
    }),

    renameItem: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'RENAME_ITEM') return
      const itemType = findItemById(context, event.itemId)?.type === 'folder' ? 'folder' : 'document'
      enqueue.spawnChild('renameItem', { id: askId('write'), input: { id: event.itemId, name: event.name, itemType } })
    }),

    // State update actions
    selectItems: assign({
      selectedItems: ({ event }) => event.type === 'SELECT_ITEMS' ? event.itemIds || [] : [],
      selectedDocument: ({ event, context }) => {
        if (event.type === 'SELECT_ITEMS' && event.itemIds?.length === 1) {
          const item = findItemById(context, event.itemIds[0])
          return item?.type === 'document' ? documentItemToDTO(item as DocumentItem) : null
        }
        return null
      }
    }),
    setSortOrder: assign({
      sortBy: ({ context, event }) => (event.type === 'SORT_BY' ? event.column : context.sortBy),
      sortDirection: ({ context, event }) => {
        const column = event.type === 'SORT_BY' ? event.column : context.sortBy
        // Toggle direction if same column, otherwise default to 'asc'
        return context.sortBy === column && context.sortDirection === 'asc' ? 'desc' : 'asc'
      },
    }),
    clearSelection: assign({
      selectedItems: [],
      selectedDocument: null,
    }),
    readDocument: assign(({ context, event }) => {
      if (event.type !== 'DOCUMENT.READ' || event.documentId !== context.editingDocumentId) return {}
      const { document } = event
      return !document.onDisk && document.document ? { editingDocument: document.document } : {}
    }),
    takeFetchedDocument: assign(({ event }) => {
      const outcome = outcomeOf<DocumentFetched>(event)
      return outcome.ok ? { editingDocument: outcome.value.document } : {}
    }),
    takeFetchFailure: assign(({ event }) => {
      const outcome = outcomeOf<DocumentFetched>(event)
      return outcome.ok ? {} : { writeError: outcome.failure.message }
    }),
    takeIndex: ({ event }) => {
      if (event.type === 'INDEX.READ') tagStorage.updateTagsFromDocuments(event.index.documents)
    },
    updateDocument: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'SAVE_DOCUMENT' || !context.editingDocument) return
      // Update tags in this surface's storage
      const oldTags = context.editingDocument.tags || []
      const newTags = event.tags || []

      const removed = oldTags.filter(tag => !newTags.includes(tag))
      const added = newTags.filter(tag => !oldTags.includes(tag))

      if (removed.length) tagStorage.removeTags(removed)
      if (added.length) tagStorage.addTags(added)

      enqueue.spawnChild('updateDocument', { id: askId('write'), input: {
        id: context.editingDocument.id,
        name: event.name,
        content: event.content,
        tags: event.tags,
      } })
    }),

    setEditingDocument: assign(({ context, event }) => {
      if (event.type !== 'EDIT_DOCUMENT' && event.type !== 'OPEN_ENTITY') return {};
      const documentId = event.type === 'OPEN_ENTITY' ? event.id : event.documentId;
      const item = findItemById(context, documentId);
      // A symlinked document's tree item has no content: the backend reads it from the filesystem
      const symlinked = documentId.startsWith('symlink:') || (item?.type === 'document' && (item as DocumentItem).isSymlinked);
      return { editingDocumentId: documentId,
        editingDocument: item?.type === 'document' && !symlinked ? documentItemToDTO(item) : undefined };
    }),
    clearEditingDocument: assign({
      editingDocument: undefined,
    }),
    /** An ask this machine spawned ended: one that was not done is shown, whichever it was, and none is kept */
    askEnded: enqueueActions(({ event, enqueue }) => {
      const outcome = outcomeOf<UntypedAskOutcome>(event)
      if (!outcome.ok) enqueue.assign({ writeError: outcome.failure.message })
      enqueue.stopChild(endedAsk(event))
    }),
    // The folder this window made opens for naming here, and nowhere else; one made on disk is shown by fetching it
    nameCreatedFolder: assign(({ event }) => {
      if (!isEnded('folder', event) || !event.output.ok) return {}
      const collection = event.output.value.collection
      return collection ? { itemToEdit: collection.id, newItemId: collection.id } : {}
    }),
    sendDeleteDocument: enqueueActions(({ event, enqueue }) => {
      if (event.type !== 'DELETE_DOCUMENT') return
      enqueue.spawnChild('deleteItems', { id: askId('write'), input: { ids: [event.documentId] } })
    }),
    // [SEARCH_INDEX_FF] Search index actions — commented out
    // requestSearchIndices: ({ context }) => {
    //   sendToSystem(id, {
    //     type: 'LIST_SEARCH_INDICES',
    //     folderId: context.currentFolderId,
    //   })
    // },
    // setSearchIndices: assign({
    //   searchIndices: ({ event }) => {
    //     if (event.type === 'SEARCH_INDICES_LOADED') {
    //       return event.data.indices
    //     }
    //     return []
    //   },
    // }),
    // saveSearchIndex: ({ context, event }) => {
    //   if (event.type === 'SAVE_SEARCH_INDEX') {
    //     sendToSystem(id, {
    //       type: 'CREATE_SEARCH_INDEX',
    //       config: event.config,
    //       folderId: context.currentFolderId,
    //     })
    //   }
    // },
    // updateSearchIndex: ({ event }) => {
    //   if (event.type === 'UPDATE_SEARCH_INDEX') {
    //     sendToSystem(id, {
    //       type: 'UPDATE_SEARCH_INDEX',
    //       id: event.indexId,
    //       config: event.config,
    //     })
    //   }
    // },
    // deleteSearchIndex: ({ event }) => {
    //   if (event.type === 'DELETE_SEARCH_INDEX') {
    //     sendToSystem(id, {
    //       type: 'DELETE_SEARCH_INDEX',
    //       id: event.indexId,
    //     })
    //   }
    // },
    // setEditingIndex: assign({
    //   editingIndexId: ({ event }) => {
    //     if (event.type === 'EDIT_SEARCH_INDEX') {
    //       return event.indexId
    //     }
    //     return undefined
    //   },
    //   editingIndex: ({ context, event }) => {
    //     if (event.type === 'EDIT_SEARCH_INDEX') {
    //       return context.searchIndices.find(idx => idx.id === event.indexId)
    //     }
    //     return undefined
    //   },
    // }),
    // clearEditingIndex: assign({
    //   editingIndexId: undefined,
    //   editingIndex: undefined,
    // }),
    //
    // // Search test actions
    // setTestingIndex: assign({
    //   testingIndexId: ({ event }) => {
    //     if (event.type === 'TEST_SEARCH_INDEX') {
    //       return event.indexId
    //     }
    //     return undefined
    //   },
    //   testingIndex: ({ context, event }) => {
    //     if (event.type === 'TEST_SEARCH_INDEX') {
    //       return context.searchIndices.find(idx => idx.id === event.indexId)
    //     }
    //     return undefined
    //   },
    //   testQuery: '',
    //   testResults: [],
    //   isSearching: false,
    // }),
    // updateTestQuery: assign({
    //   testQuery: ({ event }) => {
    //     if (event.type === 'UPDATE_TEST_QUERY') {
    //       return event.query
    //     }
    //     return ''
    //   },
    // }),
    // executeTestSearch: ({ context }) => {
    //   if (context.testingIndexId && context.testQuery) {
    //     sendToSystem(id, {
    //       type: 'SEARCH_IN_INDEX',
    //       indexId: context.testingIndexId,
    //       query: context.testQuery,
    //       limit: 10,
    //     })
    //   }
    // },
    // setSearching: assign({
    //   isSearching: true,
    // }),
    // setSearchResults: assign({
    //   testResults: ({ event }) => {
    //     if (event.type === 'SEARCH_RESULTS') {
    //       return event.data.results
    //     }
    //     return []
    //   },
    //   isSearching: false,
    // }),
    // clearTestSearch: assign({
    //   testingIndexId: undefined,
    //   testingIndex: undefined,
    //   testQuery: '',
    //   testResults: [],
    //   isSearching: false,
    // }),
    // A folder on disk, fetched again at the user's ask; a stored one is a view, and already current
    refreshFolder: enqueueActions(({ event, enqueue }) => {
      if (event.type === 'REFRESH_FOLDER') fetchContents(enqueue, event.folderId)
    }),

    // Symlink actions
    createSymlink: enqueueActions(({ context, event, enqueue }) => {
      if (event.type !== 'CREATE_SYMLINK') return
      const pathParts = event.symlinkPath.split(/[/\\]/).filter(Boolean)
      enqueue.spawnChild('createSymlinkCollection', { id: askId('folder'), input: {
        name: pathParts[pathParts.length - 1] || 'Symlink',
        symlinkPath: event.symlinkPath,
        parentId: context.currentFolderId || undefined,
      } })
    }),
    relinkSymlink: enqueueActions(({ event, enqueue }) => {
      if (event.type !== 'RELINK_SYMLINK') return
      enqueue.spawnChild('updateSymlinkPath', { id: askId('write'), input: { collectionId: event.collectionId, newPath: event.newPath } })
    }),
    removeBrokenSymlink: enqueueActions(({ event, enqueue }) => {
      if (event.type !== 'REMOVE_BROKEN_SYMLINK') return
      enqueue.spawnChild('deleteItems', { id: askId('write'), input: { ids: [event.collectionId] } })
    }),
  },
  guards: { entityIs: entityIs<Contract['opens']>,
    targetIs,
    /** The document open is gone: deleted here or in another window */
    documentGone: ({ context, event }) => event.type === 'DOCUMENT.READ' && event.documentId === context.editingDocumentId
      && !event.document.onDisk && event.document.document === null,
    /** The document open is a file on disk, not yet read: it is fetched, which no view can do for it */
    documentToFetch: ({ context, event }) => event.type === 'DOCUMENT.READ' && event.documentId === context.editingDocumentId
      && event.document.onDisk && !context.editingDocument,
  },
}).createMachine({
  id: 'library',
  initial: 'browser',
  context: {
    // Core view state
    currentView: 'browser',
    editingDocument: undefined,

    // File browser fields
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

    // Tree view fields
    expandedFolderIds: [],
    expandedFolderChildren: {},
    loadingFolderIds: [],

    diskFolderIds: [],

    // Search index fields
    searchIndices: [],
    editingIndexId: undefined,
    editingIndex: undefined,

    // Search test fields
    testingIndexId: undefined,
    testingIndex: undefined,
    testQuery: '',
    testResults: [],
    isSearching: false,

    // Symlink context
    isInSymlinkContext: false,
    currentSymlinkRootId: null,
    symlinkBasePath: null,
    isBroken: false,
    lastKnownPath: null,

    writeError: null,

    navHistory: createNavHistory<EARS.EntityId | null>(null),
  },
  on: {
    OPEN_ENTITY: [
      { guard: { type: 'entityIs', params: { entity: 'Document' } }, target: '.edit', actions: ['setEditingDocument', 'clearSelection'] },
      { guard: { type: 'entityIs', params: { entity: 'Collection' } }, target: '.browser', actions: ['navigate', 'clearSelection'] },
    ],
    EDIT_DOCUMENT: { target: '.edit', actions: ['setEditingDocument', 'clearSelection'] },
    'FOLDER.READ': {
      actions: 'readFolder',
    },
    'INDEX.READ': {
      actions: 'takeIndex',
    },
    FOLDER_CHANGED: {
      actions: 'fetchChangedFolders',
    },
    // What this window asked for ended: a folder on disk fetched, its symlinks checked, a folder made for it to name.
    // One that was not done is shown, whichever it was; what a write changed reaches every window through the views
    [ENDED.contents]: { actions: ['folderFetched', 'askEnded'] },
    [ENDED.symlinks]: { actions: ['markBrokenSymlinks', 'askEnded'] },
    [ENDED.folder]: { actions: ['nameCreatedFolder', 'askEnded'] },
    [ENDED.write]: { actions: 'askEnded' },
    VIEW_BROWSER: {
      target: '.browser',
    },

    // File browser events
    NAVIGATE_TO_FOLDER: {
      target: '.browser',
      actions: ['navigate', 'clearSelection'],
    },
    BREADCRUMB_CLICK: {
      actions: ['navigate', 'clearSelection'],
    },
    NAVIGATE_BACK: {
      guard: ({ context }) => canGoBack(context.navHistory),
      actions: [
        assign(({ context }) => {
          const result = goBack(context.navHistory)!;
          return { navHistory: result.history, currentFolderId: result.entry };
        }),
        'clearSelection',
      ],
    },
    NAVIGATE_FORWARD: {
      guard: ({ context }) => canGoForward(context.navHistory),
      actions: [
        assign(({ context }) => {
          const result = goForward(context.navHistory)!;
          return { navHistory: result.history, currentFolderId: result.entry };
        }),
        'clearSelection',
      ],
    },
    DOUBLE_CLICK_ITEM: [
      { guard: ({ event }) => event.item.type === 'folder', target: '.browser', actions: ['navigate', 'clearSelection'] },
      { actions: ['openDocument', 'clearSelection', assign({ newItemId: null })] },
    ],
    SELECT_ITEMS: {
      actions: ['selectItems', assign({ newItemId: null })],
    },
    SORT_BY: {
      actions: 'setSortOrder',
    },
    DELETE_SELECTED_ITEMS: {
      actions: 'deleteSelectedItems',
    },
    RENAME_ITEM: {
      actions: 'renameItem',
    },
    CREATE_FOLDER: {
      actions: 'createFolder',
    },
    MOVE_ITEMS: {
      actions: 'moveItems',
    },
    CLEAR_ITEM_TO_EDIT: {
      actions: assign({
        itemToEdit: null
      })
    },

    // Tree view events
    EXPAND_FOLDER: {
      actions: 'expandFolder',
    },
    COLLAPSE_FOLDER: {
      actions: 'collapseFolder',
    },

    CREATE_SYMLINK: {
      actions: 'createSymlink',
    },
    REFRESH_FOLDER: {
      actions: 'refreshFolder',
    },
    RELINK_SYMLINK: {
      actions: ['relinkSymlink'],
    },
    REMOVE_BROKEN_SYMLINK: {
      actions: ['removeBrokenSymlink', assign({ isBroken: false, lastKnownPath: null })],
    },

    CLEAR_WRITE_ERROR: {
      actions: assign({ writeError: null }),
    },
    // [SEARCH_INDEX_FF] Search index events — commented out
    // SEARCH_INDICES_LOADED: { actions: 'setSearchIndices' },
    // SEARCH_INDEX_CREATED: { actions: 'requestSearchIndices' },
    // SEARCH_INDEX_UPDATED: { actions: 'requestSearchIndices' },
    // SEARCH_INDEX_DELETED: { actions: 'requestSearchIndices' },
    // SEARCH_RESULTS: { actions: 'setSearchResults' },
    ...TRAIL_CLICK([
      ['.browser', 'browser'],
      ['.create', 'create'],
      ['.edit', 'edit'],
      // [SEARCH_INDEX_FF] ['.createIndex', 'createIndex'],
      // [SEARCH_INDEX_FF] ['.editIndex', 'editIndex'],
      // [SEARCH_INDEX_FF] ['.testIndex', 'testIndex'],
    ]),
  },
  states: {
    browser: {
      entry: assign({ currentView: 'browser' }),
      meta: breadcrumb('browser', 'Library', true),
      on: {
        CREATE_DOCUMENT: [
          {
            guard: ({ context }) => context.isInSymlinkContext,
            // Stay in the browser: the file is made in the folder on disk, and named there
            actions: 'createDocumentOnDisk',
          },
          { target: 'create' },
        ],
        // [SEARCH_INDEX_FF] Search index transitions — commented out
        // CREATE_SEARCH_INDEX: 'createIndex',
        // EDIT_SEARCH_INDEX: { target: 'editIndex', actions: 'setEditingIndex' },
        // TEST_SEARCH_INDEX: { target: 'testIndex', actions: 'setTestingIndex' },
      },
    },
    create: {
      entry: assign({ currentView: 'create' }),
      meta: breadcrumb('create', 'New Document'),
      on: {
        SAVE_DOCUMENT: {
          target: 'browser',
          actions: 'createDocument',
        },
        CANCEL_EDIT: 'browser',
      },
    },
    edit: {
      entry: assign({ currentView: 'edit' }),
      exit: assign({ editingDocumentId: undefined }),
      initial: 'ready',
      states: {
        ready: {},
        fetching: {
          invoke: {
            src: 'getDocument',
            input: ({ context }) => ({ id: context.editingDocumentId! }),
            onDone: onOutcome<DocumentFetched>()({
              done: { target: 'ready', actions: 'takeFetchedDocument' },
              failed: {
                // Nothing to edit: back to where it was opened from, saying why
                'not-found': { target: '#library.browser', actions: ['clearEditingDocument', 'takeFetchFailure'] },
                'no-access': { target: 'ready', actions: 'takeFetchFailure' },
                failed: { target: 'ready', actions: 'takeFetchFailure' },
                unavailable: { target: 'ready', actions: 'takeFetchFailure' },
              },
            }),
          },
        },
      },
      meta: {
        ...breadcrumbWithParams<LibraryContext>({
          target: 'edit',
          getLabel: (ctx) => `${ctx.editingDocument?.name || 'Document'}`,
        }),
        ...contextMenuFn<LibraryContext>((ctx) => {
          if (!ctx.editingDocument) return []
          return [
            { label: 'Delete Document', icon: Trash2, event: { type: 'DELETE_DOCUMENT' as const, documentId: ctx.editingDocument.id }, iconColor: 'text-red-400', confirm: `Are you sure you want to delete "${ctx.editingDocument.name || 'this document'}"?` },
          ]
        }),
      },
      on: {
        'DOCUMENT.READ': [
          { guard: 'documentGone', target: 'browser', actions: 'clearEditingDocument' },
          { guard: 'documentToFetch', target: '.fetching' },
          { actions: 'readDocument' },
        ],
        SAVE_DOCUMENT: {
          target: 'browser',
          actions: ['updateDocument', 'clearEditingDocument'],
        },
        CANCEL_EDIT: {
          target: 'browser',
          actions: 'clearEditingDocument',
        },
        DELETE_DOCUMENT: {
          target: 'browser',
          actions: ['sendDeleteDocument', 'clearEditingDocument'],
        },
      },
    },
    // [SEARCH_INDEX_FF] Search index states — commented out
    // createIndex: {
    //   entry: assign({ currentView: 'create-index' }),
    //   meta: breadcrumb('createIndex', 'Create Search Index'),
    //   on: {
    //     SAVE_SEARCH_INDEX: {
    //       target: 'browser',
    //       actions: 'saveSearchIndex',
    //     },
    //     CANCEL_CREATE_INDEX: 'browser',
    //   },
    // },
    // editIndex: {
    //   entry: assign({ currentView: 'edit-index' }),
    //   meta: breadcrumbWithParams<LibraryContext>({
    //     target: 'editIndex',
    //     getLabel: (ctx) => `${ctx.editingIndex?.name || 'Index'}`,
    //   }),
    //   on: {
    //     UPDATE_SEARCH_INDEX: {
    //       target: 'browser',
    //       actions: ['updateSearchIndex', 'clearEditingIndex'],
    //     },
    //     CANCEL_EDIT_INDEX: {
    //       target: 'browser',
    //       actions: 'clearEditingIndex',
    //     },
    //   },
    // },
    // testIndex: {
    //   entry: assign({ currentView: 'test-index' }),
    //   meta: breadcrumbWithParams<LibraryContext>({
    //     target: 'testIndex',
    //     getLabel: (ctx) => `${ctx.testingIndex?.name || 'Index'}`,
    //   }),
    //   on: {
    //     UPDATE_TEST_QUERY: {
    //       actions: 'updateTestQuery',
    //     },
    //     EXECUTE_TEST_SEARCH: {
    //       actions: ['setSearching', 'executeTestSearch'],
    //     },
    //     CANCEL_TEST_SEARCH: {
    //       target: 'browser',
    //       actions: 'clearTestSearch',
    //     },
    //   },
    // },
  },
})
