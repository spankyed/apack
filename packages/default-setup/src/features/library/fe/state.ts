import { entityIs } from '@apackdev/sdk/fe'
import { answerOf, isAnswered, type AnswersOf, type OpenEntity } from '@apackdev/sdk/events'
import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate'
import type { DocumentDTO, DocumentView, FolderContents, FolderView, LibraryIndex, LibraryItem, DocumentItem } from '#generated/types.ts'
import type { Contract, LibraryContext, LibraryInboxEvent } from './contract.ts'
import type { OutgoingLibraryEvents } from '#features/library/be/types.ts'
import type { SearchIndexFormData } from './types/search-index.ts'
import { fromAsk, sendToSystem } from '#generated/events.ts'
import type { EARS } from '#generated/ears.ts'
import { onOutcome, outcomeOf } from '@apackdev/sdk/helpers'
import type { Contract as LibrarySystemContract } from '#features/library/be/contract.ts'
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

/** Asks whether the symlinked folders among a folder's contents still reach their folder on disk, which no view can see */
function checkSymlinks(data: FolderContents): void {
  const ids = (data.items || []).filter(item => item.type === 'folder' && item.isSymlink).map(item => item.id)
  if (ids.length > 0) sendToSystem(id, { type: 'CHECK_SYMLINKS', ids })
}
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
  // Import/Export events
  | { type: 'LIBRARY.IMPORT'; directory: string }
  | { type: 'LIBRARY.RESET_IMPORT_STATUS' }
  | { type: 'LIBRARY.EXPORT'; directory: string; format: 'markdown' | 'json' }
  | { type: 'LIBRARY.RESET_EXPORT_STATUS' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' }
  | OutgoingLibraryEvents
  // The answers to what this window asks the library, which it goes on from: its writes, its fetches of folders, and
  // its imports and exports
  | AnswersOf<LibrarySystemContract>

/** How a fetch of the document open on disk ended */
type DocumentFetched = Awaited<ReturnType<typeof import('#generated/events.ts').ask<'library', 'GET_DOCUMENT'>>>

export const librarySystem = setup({
  types: {
    context: {} as LibraryContext,
    events: {} as LibraryEvents,
  },
  actors: {
    // A document on disk is read when it is opened, which no view can do for it
    getDocument: fromAsk('library', 'GET_DOCUMENT'),
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
        enqueue(() => sendToSystem(id, { type: 'GET_FOLDER_CONTENTS', folderId }))
        return
      }
      if (context.diskFolderIds.includes(folderId)) enqueue.assign({ diskFolderIds: context.diskFolderIds.filter(each => each !== folderId) })
      enqueue.assign(({ context }) => folderShown(context, folder.contents))
      enqueue(() => checkSymlinks(folder.contents))
    }),
    folderFetched: enqueueActions(({ event, enqueue }) => {
      if (event.type !== 'ASK_ANSWERED' || event.asked !== 'GET_FOLDER_CONTENTS') return
      const contents = event.answer
      enqueue.assign(({ context }) => folderShown(context, contents))
      enqueue(() => checkSymlinks(contents))
    }),
    fetchChangedFolders: ({ context, event }) => {
      if (event.type !== 'FOLDER_CHANGED') return
      for (const folderId of shownFolders(context)) {
        if (!context.diskFolderIds.includes(folderId)) continue
        if (event.folderId === null || event.folderId === folderId) sendToSystem(id, { type: 'GET_FOLDER_CONTENTS', folderId })
      }
    },
    markBrokenSymlinks: assign(({ context, event }) => {
      if (event.type !== 'ASK_ANSWERED' || event.asked !== 'CHECK_SYMLINKS') return {}
      const { ids, broken } = event.answer
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
    createDocument: ({ context, event }) => {
      if (event.type === 'SAVE_DOCUMENT') {
        const targetCollectionId = event.collectionId || context.currentFolderId || undefined

        if (event.tags?.length) tagStorage.addTags(event.tags)

        sendToSystem(id, {
          type: 'CREATE_DOCUMENT',
          name: event.name,
          content: event.content,
          tags: event.tags,
          collectionId: targetCollectionId,
        })
      }
    },
    createFolder: ({ context, event }) => {
      if (event.type === 'CREATE_FOLDER') {
        sendToSystem(id, {
          type: 'CREATE_COLLECTION',
          name: event.name,
          parentId: context.currentFolderId || undefined,
        })
      }
    },
    deleteSelectedItems: ({ context }) => {
      if (context.selectedItems.length > 0) {
        sendToSystem(id, {
          type: 'DELETE_ITEMS',
          ids: context.selectedItems,
        })
      }
    },
    moveItems: ({ event }) => {
      if (event.type === 'MOVE_ITEMS') {
        sendToSystem(id, {
          type: 'MOVE_ITEMS',
          ids: event.itemIds,
          targetFolderId: event.targetFolderId,
        })
      }
    },
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

    renameItem: ({ context, event }) => {
      if (event.type === 'RENAME_ITEM') {
        const item = findItemById(context, event.itemId)
        const itemType = item?.type === 'folder' ? 'folder' : 'document'

        sendToSystem(id, {
          type: 'RENAME_ITEM',
          id: event.itemId,
          name: event.name,
          itemType: itemType,
        })
      }
    },

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
      sortBy: ({ event }) => (event as any).column || 'name',
      sortDirection: ({ context, event }) => {
        const column = (event as any).column
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
    updateDocument: ({ context, event }) => {
      if (event.type === 'SAVE_DOCUMENT' && context.editingDocument) {
        // Update tags in this surface's storage
        const oldTags = context.editingDocument.tags || []
        const newTags = event.tags || []

        const removed = oldTags.filter(tag => !newTags.includes(tag))
        const added = newTags.filter(tag => !oldTags.includes(tag))

        if (removed.length) tagStorage.removeTags(removed)
        if (added.length) tagStorage.addTags(added)

        sendToSystem(id, {
          type: 'UPDATE_DOCUMENT',
          id: context.editingDocument.id,
          name: event.name,
          content: event.content,
          tags: event.tags,
        })
      }
    },

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
    takeFailure: assign(({ event }) => (event.type === 'ASK_FAILED' ? { writeError: event.failure.message } : {})),
    // The folder this window made opens for naming here, and nowhere else; one made on disk is shown by fetching it
    nameCreatedFolder: assign(({ event }) => {
      if (event.type !== 'ASK_ANSWERED' || (event.asked !== 'CREATE_COLLECTION' && event.asked !== 'CREATE_SYMLINK_COLLECTION')) return {}
      const collection = event.answer.collection
      return collection ? { itemToEdit: collection.id, newItemId: collection.id } : {}
    }),
    sendDeleteDocument: ({ event }) => {
      if (event.type !== 'DELETE_DOCUMENT') return
      sendToSystem(id, { type: 'DELETE_ITEMS', ids: [event.documentId] })
    },
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
    refreshFolder: ({ event }) => {
      if (event.type === 'REFRESH_FOLDER') sendToSystem(id, { type: 'GET_FOLDER_CONTENTS', folderId: event.folderId })
    },

    // Symlink actions
    createSymlink: ({ context, event }) => {
      if (event.type === 'CREATE_SYMLINK') {
        const pathParts = event.symlinkPath.split(/[/\\]/).filter(Boolean)
        const folderName = pathParts[pathParts.length - 1] || 'Symlink'
        sendToSystem(id, {
          type: 'CREATE_SYMLINK_COLLECTION',
          name: folderName,
          symlinkPath: event.symlinkPath,
          parentId: context.currentFolderId || undefined,
        })
      }
    },
    relinkSymlink: ({ event }) => {
      if (event.type === 'RELINK_SYMLINK') {
        sendToSystem(id, {
          type: 'UPDATE_SYMLINK_PATH',
          collectionId: event.collectionId,
          newPath: event.newPath,
        })
      }
    },
    removeBrokenSymlink: ({ event }) => {
      if (event.type === 'REMOVE_BROKEN_SYMLINK') {
        sendToSystem(id, {
          type: 'DELETE_ITEMS',
          ids: [event.collectionId],
        })
      }
    },
    /* ── Library Import actions ────────────────────────────── */
    setImportingLibrary: assign(({ context }) => ({
      libraryImport: {
        ...context.libraryImport,
        status: 'importing' as const,
      },
    })),

    sendImportLibrary: ({ event }) => {
      if (event.type === 'LIBRARY.IMPORT') {
        sendToSystem(id, {
          type: 'IMPORT_LIBRARY',
          directory: event.directory,
        })
      }
    },

    handleLibraryImported: assign(({ event }) => {
      const { count, errors } = answerOf(event, 'IMPORT_LIBRARY')
      return { libraryImport: { status: 'success' as const, errors: errors || [], importedCount: count } }
    }),

    handleLibraryImportFailed: assign(({ event }) => {
      if (event.type !== 'ASK_FAILED') return {}
      return { libraryImport: { status: 'error' as const, errors: event.failure.message.split('\n'), importedCount: 0 } }
    }),

    resetImportLibraryStatus: assign({
      libraryImport: { status: 'idle' as const, errors: [] as string[], importedCount: 0 },
    }),

    /* ── Library Export actions ────────────────────────────── */
    setExportingLibrary: assign(({ context }) => ({
      libraryExport: {
        ...context.libraryExport,
        status: 'exporting' as const,
      },
    })),

    sendExportLibrary: ({ event }) => {
      if (event.type === 'LIBRARY.EXPORT') {
        sendToSystem(id, {
          type: 'EXPORT_LIBRARY',
          directory: event.directory,
          format: event.format,
        })
      }
    },

    handleLibraryExported: assign(({ event }) => {
      const { filePath, itemCount } = answerOf(event, 'EXPORT_LIBRARY')
      return { libraryExport: { status: 'success' as const, errors: [] as string[], filePath, itemCount } }
    }),

    handleLibraryExportFailed: assign(({ event }) => {
      if (event.type !== 'ASK_FAILED') return {}
      return { libraryExport: { status: 'error' as const, errors: [event.failure.message], filePath: '', itemCount: 0 } }
    }),

    resetExportLibraryStatus: assign({
      libraryExport: { status: 'idle' as const, errors: [] as string[], filePath: '', itemCount: 0 },
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

    // Import/Export
    libraryImport: { status: 'idle' as const, errors: [], importedCount: 0 },
    libraryExport: { status: 'idle' as const, errors: [], filePath: '', itemCount: 0 },
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
    // The answers to this window's fetches of what is on disk, to the writes that make a folder it names, and to its
    // imports and exports
    ASK_ANSWERED: [
      { guard: ({ event }) => isAnswered(event, 'IMPORT_LIBRARY'), actions: 'handleLibraryImported' },
      { guard: ({ event }) => isAnswered(event, 'EXPORT_LIBRARY'), actions: 'handleLibraryExported' },
      { guard: ({ event }) => event.asked === 'GET_FOLDER_CONTENTS', actions: 'folderFetched' },
      { guard: ({ event }) => event.asked === 'CHECK_SYMLINKS', actions: 'markBrokenSymlinks' },
      { guard: ({ event }) => event.asked === 'CREATE_COLLECTION' || event.asked === 'CREATE_SYMLINK_COLLECTION', actions: 'nameCreatedFolder' },
    ],
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

    // Import/Export events
    'LIBRARY.IMPORT': {
      actions: ['setImportingLibrary', 'sendImportLibrary'],
    },
    'LIBRARY.RESET_IMPORT_STATUS': {
      actions: 'resetImportLibraryStatus',
    },
    'LIBRARY.EXPORT': {
      actions: ['setExportingLibrary', 'sendExportLibrary'],
    },
    'LIBRARY.RESET_EXPORT_STATUS': {
      actions: 'resetExportLibraryStatus',
    },

    // An import or an export that failed is its status. A write or a fetch this window asked for and did not get is
    // shown, whichever it was; what a write changed reaches every window through the views
    ASK_FAILED: [
      { guard: ({ event }) => event.asked === 'IMPORT_LIBRARY', actions: 'handleLibraryImportFailed' },
      { guard: ({ event }) => event.asked === 'EXPORT_LIBRARY', actions: 'handleLibraryExportFailed' },
      { actions: 'takeFailure' },
    ],
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
            // Stay in browser, create file inline via unified event
            actions: ({ context }) => {
              if (context.currentFolderId) {
                sendToSystem(id, {
                  type: 'CREATE_DOCUMENT',
                  name: 'New Document.txt',
                  content: [],
                  tags: [],
                  collectionId: context.currentFolderId,
                })
              }
            },
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
