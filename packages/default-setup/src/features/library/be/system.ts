// [SEARCH_INDEX_FF] The search index is dormant: ./search-index/README.md lists its call sites and how to turn it on
import type { Contract } from './contract.ts';

import { setup } from 'xstate'
import { defineSystem } from '@apackdev/sdk/framework'
import type { EARS } from '#generated/ears.ts'
// [SEARCH_INDEX_FF] import type { SearchIndex } from './search-index/types/search-index'
import { broadcastToSurface } from '#generated/events.ts'
import { repository } from '#generated/repository.ts';
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { libraryService } from './services/library.ts'
import * as symlink from './repository/symlink.ts'
// [SEARCH_INDEX_FF] import { DEFAULT_EMBEDDING_MODEL } from '#features/library/embedding-models.ts'
import { toMap, toIdentifierSet, mapArray } from '@apackdev/sdk/utils'
import { exportLibrary } from './export-library.ts'
import { importLibrary } from './import-library.ts'
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingLibraryEvents } from './types.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. What
 * the import stored reaches every window through the library's views.
 */
const answer = (reply: Reply<OutgoingLibraryEvents> | undefined, event: OutgoingLibraryEvents): void =>
  (reply ? reply(event) : broadcastToSurface('library', event));

export const librarySpec = defineSystem<Contract>();

/**
 * One of a window's writes to the library, answered to whoever asked: with the folder it made, or that it landed, or
 * why it was refused. The write runs whether or not anybody asked — an applier's or a migration's has no `reply`.
 */
async function answerWrite(reply: Reply<OutgoingLibraryEvents> | undefined, label: string, write: () => Promise<OutgoingLibraryEvents | void> | OutgoingLibraryEvents | void): Promise<void> {
  let answer: OutgoingLibraryEvents
  try {
    answer = (await write()) ?? { type: 'LIBRARY_WRITTEN' }
  } catch (error) {
    reply?.({ type: 'LIBRARY_WRITE_FAILED', error: errorMessage(error) || `${label} failed` })
    return
  }
  reply?.(answer)
}

/**
 * Tells every window that something on disk under a symlinked folder changed, which no view can see: `folderId`'s
 * contents, or with `null`, a symlinked folder's not known. A notification — whoever is showing one fetches it again.
 */
const diskChanged = (folderId: string | null) => broadcastToSurface('library', { type: 'FOLDER_CHANGED', folderId })

/** The folder on disk an item on disk sits in, or `null` when that can't be worked out */
function diskParentOf(id: string): string | null {
  const parsed = symlink.parseSymlinkId(id)
  if (!parsed) return null
  const resolved = symlink.resolveSymlinkPath(id)
  const basePath = symlink.getSymlinkCollectionPath(parsed.collectionId)
  if (!resolved || !basePath) return parsed.collectionId
  const parentRelPath = path.dirname(path.relative(basePath, resolved.absolutePath))
  return parentRelPath && parentRelPath !== '.' ? symlink.buildSymlinkId(parsed.collectionId, parentRelPath) : parsed.collectionId
}

function resolveHomePath(inputPath: string): string {
  const trimmed = inputPath.trim()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  if (trimmed === '~') return os.homedir()
  return trimmed
}

export const librarySystem = setup({
  types: librarySpec.types,
  actions: librarySpec.actions({
    createDocument: async ({ event, reply }) => {
      const ev = event as { type: 'CREATE_DOCUMENT'; name: string; content: any[]; tags: string[]; collectionId?: string; documentType?: string }
      await answerWrite(reply, 'Creating a document', async () => {
        await libraryService.create({
          name: ev.name,
          content: ev.content,
          tags: ev.tags,
          parentId: ev.collectionId,
          documentType: ev.documentType,
        })
        if (ev.collectionId && repository.libraryQueries.isDiskFolder(ev.collectionId)) diskChanged(ev.collectionId)
      })
    },
    updateDocument: async ({ event, reply }) => {
      const ev = event as { type: 'UPDATE_DOCUMENT'; id: string; name: string; content: any[]; tags: string[]; collectionId?: string }
      await answerWrite(reply, 'Saving a document', async () => {
        await libraryService.update({
          id: ev.id,
          name: ev.name,
          content: ev.content,
          tags: ev.tags,
        })
        if (repository.libraryQueries.isDiskDocument(ev.id)) diskChanged(diskParentOf(ev.id))
      })
    },
    deleteDocument: async ({ event, reply }) => {
      const ev = event as { type: 'DELETE_DOCUMENT'; id: string }
      await answerWrite(reply, 'Deleting a document', () => { repository.libraryCommands.deleteDocument(ev.id as EARS.EntityId) })
    },
    getDocument: async ({ event, reply }) => {
      const ev = event as { type: 'GET_DOCUMENT'; id: string }
      const document = await libraryService.find(ev.id as EARS.EntityId)
      reply?.(document
        ? { type: 'DOCUMENT_LOADED' as const, data: { document } }
        : { type: 'LIBRARY_WRITE_FAILED' as const, error: 'Document not found' })
    },
    createCollection: async ({ event, reply }) => {
      const ev = event as { type: 'CREATE_COLLECTION'; name: string; description?: string; parentId?: string }
      await answerWrite(reply, 'Creating a folder', async () => {
        if (ev.parentId && repository.libraryQueries.isDiskFolder(ev.parentId)) {
          await libraryService.createFolder({ name: ev.name, parentId: ev.parentId })
          diskChanged(ev.parentId)
          return
        }
        const collection = repository.libraryCommands.createCollection(
          ev.name,
          ev.description,
          ev.parentId ? ev.parentId as EARS.EntityId : undefined
        )
        // Only the window that asked names it; every window's folder shows it through the folder view
        return { type: 'COLLECTION_CREATED' as const, data: { collection } }
      })
    },
    updateCollection: async ({ event, reply }) => {
      const ev = event as { type: 'UPDATE_COLLECTION'; id: string; name: string; description?: string }
      await answerWrite(reply, 'Renaming a folder', () => { repository.libraryCommands.updateCollection(ev.id as EARS.EntityId, ev.name, ev.description) })
    },
    deleteCollection: async ({ event, reply }) => {
      const ev = event as { type: 'DELETE_COLLECTION'; id: string }
      await answerWrite(reply, 'Deleting a folder', () => { repository.libraryCommands.deleteCollection(ev.id as EARS.EntityId) })
    },
    moveDocument: async ({ event, reply }) => {
      const ev = event as { type: 'MOVE_DOCUMENT'; documentId: string; collectionId?: string }
      await answerWrite(reply, 'Moving a document', () => {
        repository.libraryCommands.moveDocument(ev.documentId as EARS.EntityId, ev.collectionId ? ev.collectionId as EARS.EntityId : undefined)
      })
    },
    // File browser actions
    getFolderContents: async ({ event, reply }) => {
      const ev = event as { type: 'GET_FOLDER_CONTENTS'; folderId: string | null }
      const folderContents = await repository.libraryQueries.getFolderContents(ev.folderId ? ev.folderId as EARS.EntityId : null)
      reply?.({ type: 'FOLDER_CONTENTS_LOADED' as const, data: folderContents })
    },
    checkSymlinks: async ({ event, reply }) => {
      const ev = event as { type: 'CHECK_SYMLINKS'; ids: string[] }
      reply?.({ type: 'SYMLINKS_CHECKED' as const, ids: ev.ids, broken: await repository.libraryQueries.brokenSymlinks(ev.ids) })
    },
    renameItem: async ({ event, reply }) => {
      const ev = event as { type: 'RENAME_ITEM'; id: string; name: string; itemType: 'document' | 'folder' }
      await answerWrite(reply, 'Renaming', async () => {
        if (symlink.isSymlinkId(ev.id)) {
          // Worked out before the rename, while the path still resolves
          const parent = diskParentOf(ev.id)
          await libraryService.rename(ev.id, ev.name)
          diskChanged(parent)
          return
        }
        repository.libraryCommands.renameItem(ev.id as EARS.EntityId, ev.name, ev.itemType)
      })
    },
    deleteItems: async ({ event, reply }) => {
      const ev = event as { type: 'DELETE_ITEMS'; ids: string[] }
      await answerWrite(reply, 'Deleting', async () => {
        await libraryService.remove(ev.ids)
        if (ev.ids.some(symlink.isSymlinkId)) diskChanged(null)
      })
    },
    moveItems: async ({ event, reply }) => {
      const ev = event as { type: 'MOVE_ITEMS'; ids: string[]; targetFolderId: string | null }
      await answerWrite(reply, 'Moving', async () => {
        await libraryService.move(ev.ids, ev.targetFolderId)
        if (ev.ids.some(symlink.isSymlinkId) || repository.libraryQueries.isDiskFolder(ev.targetFolderId)) diskChanged(null)
      })
    },
    // [SEARCH_INDEX_FF] Search index actions — commented out
    // listSearchIndices: async ({ system, event }) => {
    //   const ev = event as { type: 'LIST_SEARCH_INDICES'; folderId: string | null }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const indices = await searchIndexRepo.getSearchIndicesForFolder(
    //     ev.folderId ? ev.folderId as EARS.EntityId : null
    //   )
    //   broadcastToSurface('library', { type: 'SEARCH_INDICES_LOADED', data: { indices } })
    // },
    // createSearchIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'CREATE_SEARCH_INDEX'; config: any; folderId: string | null }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const index = await searchIndexRepo.createSearchIndex(
    //     ev.config,
    //     ev.folderId ? ev.folderId as EARS.EntityId : null
    //   )
    //   broadcastToSurface('library', { type: 'SEARCH_INDEX_CREATED', data: { index } })
    // },
    // updateSearchIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'UPDATE_SEARCH_INDEX'; id: string; config: any }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const index = await searchIndexRepo.updateSearchIndex(
    //     ev.id as EARS.EntityId,
    //     ev.config
    //   )
    //   broadcastToSurface('library', { type: 'SEARCH_INDEX_UPDATED', data: { index } })
    // },
    // deleteSearchIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'DELETE_SEARCH_INDEX'; id: string }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   await searchIndexRepo.deleteSearchIndex(ev.id as EARS.EntityId)
    //   broadcastToSurface('library', { type: 'SEARCH_INDEX_DELETED', data: { indexId: ev.id } })
    // },
    // searchInIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'SEARCH_IN_INDEX'; indexId: string; query: string; limit?: number }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const results = await searchIndexRepo.searchInIndex(
    //     ev.indexId as EARS.EntityId,
    //     ev.query,
    //     ev.limit
    //   )
    //   broadcastToSurface('library', { type: 'SEARCH_RESULTS', data: { results } })
    // },
    // Symlink actions
    createSymlinkCollection: async ({ event, reply }) => {
      const ev = event as { type: 'CREATE_SYMLINK_COLLECTION'; name: string; symlinkPath: string; parentId?: string }
      await answerWrite(reply, 'Linking a folder', () => {
        const collection = repository.libraryCommands.createSymlinkCollection(
          ev.name,
          resolveHomePath(ev.symlinkPath),
          ev.parentId ? ev.parentId as EARS.EntityId : undefined
        )
        return { type: 'COLLECTION_CREATED' as const, data: { collection } }
      })
    },
    updateSymlinkPath: async ({ event, reply }) => {
      const ev = event as { type: 'UPDATE_SYMLINK_PATH'; collectionId: string; newPath: string }
      const resolvedPath = resolveHomePath(ev.newPath)
      await answerWrite(reply, 'Relinking a folder', async () => {
        // Validate the new path exists and is a directory
        let isDirectory = false
        try {
          isDirectory = (await fs.stat(resolvedPath)).isDirectory()
        } catch {
          // Missing: refused below
        }
        if (!isDirectory) throw new Error(`Path does not exist: ${resolvedPath}`)
        repository.libraryCommands.updateSymlinkPath(ev.collectionId as EARS.EntityId, resolvedPath)
        diskChanged(ev.collectionId)
      })
    },
    // Import/Export actions
    importLibraryItems: async ({ event, reply }) => {
      const ev = event as { type: 'IMPORT_LIBRARY'; directory: string }

      try {
        const result = importLibrary(ev.directory)

        if (result.created === 0 && result.errors.length > 0) {
          answer(reply, {
              type: 'LIBRARY_IMPORT_FAILED' as const,
              errors: result.errors,
            })
          return
        }

        answer(reply, {
            type: 'LIBRARY_IMPORTED' as const,
            count: result.created,
            ...(result.errors.length > 0 ? { errors: result.errors } : {}),
          })

      } catch (err) {
        const message = errorMessage(err)
        answer(reply, {
            type: 'LIBRARY_IMPORT_FAILED' as const,
            errors: [message],
          })
      }
      // An import can fail part way, after creating documents
    },
    exportLibraryToFile: async ({ event, reply }) => {
      const ev = event as { type: 'EXPORT_LIBRARY'; directory: string; format: 'markdown' | 'json' }

      try {
        const { filePath, itemCount } = exportLibrary(ev.directory, ev.format)

        answer(reply, {
            type: 'LIBRARY_EXPORTED' as const,
            filePath,
            itemCount,
          })
      } catch (err) {
        const message = errorMessage(err)
        answer(reply, {
            type: 'LIBRARY_EXPORT_FAILED' as const,
            errors: [message],
          })
      }
    },
    handleSettingsUpdate: ({ event }) => {
      const { changes } = librarySpec.typeOf('FEATURE_SETTINGS_UPDATED', event)
      const tagChanges = changes?.tags
      
      if (!tagChanges) return
      
      const renames = toMap(tagChanges.renames)
      // Tags use 'name' property as identifier
      const removed = toIdentifierSet(tagChanges.removed, (item: any) => item.name)
      
      if (!renames.size && !removed.size) return
      
      
      // Update all documents that have renamed or removed tags
      for (const doc of repository.libraryQueries.getAllDocuments()) {
        const { next: nextTags, changed } = mapArray(doc.tags, renames, removed)
        
        if (changed) repository.libraryCommands.updateDocumentTags(doc.id, nextTags)
      }
    },
  }),
}).createMachine({
  id: 'library',
  initial: 'idle',
  context: {},
  on: {
    FEATURE_SETTINGS_UPDATED: {
      actions: ['handleSettingsUpdate'],
    },
  },
  states: {
    idle: {
      on: {
        CREATE_DOCUMENT: {
          actions: ['createDocument'],
        },
        UPDATE_DOCUMENT: {
          actions: ['updateDocument'],
        },
        DELETE_DOCUMENT: {
          actions: ['deleteDocument'],
        },
        GET_DOCUMENT: {
          actions: ['getDocument'],
        },
        CREATE_COLLECTION: {
          actions: ['createCollection'],
        },
        UPDATE_COLLECTION: {
          actions: ['updateCollection'],
        },
        DELETE_COLLECTION: {
          actions: ['deleteCollection'],
        },
        MOVE_DOCUMENT: {
          actions: ['moveDocument'],
        },
        // File browser events
        GET_FOLDER_CONTENTS: {
          actions: ['getFolderContents'],
        },
        CHECK_SYMLINKS: {
          actions: ['checkSymlinks'],
        },
        RENAME_ITEM: {
          actions: ['renameItem'],
        },
        DELETE_ITEMS: {
          actions: ['deleteItems'],
        },
        MOVE_ITEMS: {
          actions: ['moveItems'],
        },
        // [SEARCH_INDEX_FF] Search index events — commented out
        // LIST_SEARCH_INDICES: { actions: ['listSearchIndices'] },
        // CREATE_SEARCH_INDEX: { actions: ['createSearchIndex'] },
        // UPDATE_SEARCH_INDEX: { actions: ['updateSearchIndex'] },
        // DELETE_SEARCH_INDEX: { actions: ['deleteSearchIndex'] },
        // SEARCH_IN_INDEX: { actions: ['searchInIndex'] },
        // Symlink events
        CREATE_SYMLINK_COLLECTION: {
          actions: ['createSymlinkCollection'],
        },
        UPDATE_SYMLINK_PATH: {
          actions: ['updateSymlinkPath'],
        },
        // Import/Export events
        IMPORT_LIBRARY: {
          actions: ['importLibraryItems'],
        },
        EXPORT_LIBRARY: {
          actions: ['exportLibraryToFile'],
        },
      },
    },
  },
})

const libraryEntry = { spec: librarySpec, machine: librarySystem };

export default libraryEntry;