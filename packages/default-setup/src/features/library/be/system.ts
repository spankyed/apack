import { featureSettings } from '#generated/settings.ts';
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
import { toMap, toIdentifierSet, mapArray } from '@apackdev/sdk/utils'
import { exportLibrary } from './export-library.ts'
import { importLibrary } from './import-library.ts'

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. The
 * data the import changed is separate news and stays a broadcast.
 */
const answer = (reply: Reply<OutgoingLibraryEvents> | undefined, event: OutgoingLibraryEvents): void =>
  (reply ? reply(event) : broadcastToSurface('library', event));
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingLibraryEvents } from './types.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';

export const librarySpec = defineSystem<Contract>();

function resolveHomePath(inputPath: string): string {
  const trimmed = inputPath.trim()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  if (trimmed === '~') return os.homedir()
  return trimmed
}

export const librarySystem = setup({
  types: librarySpec.types,
  actions: librarySpec.actions({
    createDocument: async ({ event }) => {
      const ev = event as { type: 'CREATE_DOCUMENT'; name: string; content: any[]; tags: string[]; collectionId?: string; documentType?: string }
      const document = await libraryService.create({
        name: ev.name,
        content: ev.content,
        tags: ev.tags,
        parentId: ev.collectionId,
        documentType: ev.documentType,
      })
      if (ev.collectionId && symlink.resolveSymlinkPath(ev.collectionId)) {
        const folderContents = await repository.libraryQueries.getFolderContents(ev.collectionId as EARS.EntityId)
        broadcastToSurface('library', { type: 'FOLDER_CONTENTS_LOADED' as const, data: folderContents })
      } else {
        broadcastToSurface('library', { type: 'DOCUMENT_CREATED' as const, data: { document } })
      }

    },
    updateDocument: async ({ event }) => {
      const ev = event as { type: 'UPDATE_DOCUMENT'; id: string; name: string; content: any[]; tags: string[]; collectionId?: string }
      const document = await libraryService.update({
        id: ev.id,
        name: ev.name,
        content: ev.content,
        tags: ev.tags,
      })
      broadcastToSurface('library', { type: 'DOCUMENT_UPDATED' as const, data: { document } })

    },
    deleteDocument: async ({ event }) => {
      const ev = event as { type: 'DELETE_DOCUMENT'; id: string }
      repository.libraryCommands.deleteDocument(ev.id as EARS.EntityId)
      broadcastToSurface('library', {
          type: 'DOCUMENT_DELETED' as const,
          data: { documentId: ev.id },
        })
    },
    getDocument: async ({ event }) => {
      const ev = event as { type: 'GET_DOCUMENT'; id: string }
      const document = await libraryService.find(ev.id as EARS.EntityId)
      if (document) {
        broadcastToSurface('library', { type: 'DOCUMENT_LOADED' as const, data: { document } })
      } else {
        broadcastToSurface('library', { type: 'LIBRARY_ERROR' as const, data: { error: 'Document not found' } })
      }
    },
    sendIndex: () => {
      broadcastToSurface('library', {
          type: 'LIBRARY_INDEX_LOADED' as const,
          data: { index: repository.libraryQueries.getIndex() },
        })
    },
    createCollection: async ({ event }) => {
      const ev = event as { type: 'CREATE_COLLECTION'; name: string; description?: string; parentId?: string }
      const isSymlink = ev.parentId ? !!symlink.resolveSymlinkPath(ev.parentId) : false
      if (isSymlink) {
        await libraryService.createFolder({
          name: ev.name,
          parentId: ev.parentId,
        })
        const folderContents = await repository.libraryQueries.getFolderContents(ev.parentId as EARS.EntityId)
        broadcastToSurface('library', { type: 'FOLDER_CONTENTS_LOADED' as const, data: folderContents })
      } else {
        const collection = repository.libraryCommands.createCollection(
          ev.name,
          ev.description,
          ev.parentId ? ev.parentId as EARS.EntityId : undefined
        )
        broadcastToSurface('library', { type: 'COLLECTION_CREATED' as const, data: { collection } })
      }
    },
    updateCollection: async ({ event }) => {
      const ev = event as { type: 'UPDATE_COLLECTION'; id: string; name: string; description?: string }
      const collection = repository.libraryCommands.updateCollection(
        ev.id as EARS.EntityId,
        ev.name,
        ev.description
      )
      broadcastToSurface('library', {
          type: 'COLLECTION_UPDATED' as const,
          data: { collection },
        })
    },
    deleteCollection: async ({ event }) => {
      const ev = event as { type: 'DELETE_COLLECTION'; id: string }
      repository.libraryCommands.deleteCollection(ev.id as EARS.EntityId)
      broadcastToSurface('library', {
          type: 'COLLECTION_DELETED' as const,
          data: { collectionId: ev.id },
        })
    },
    moveDocument: async ({ event }) => {
      const ev = event as { type: 'MOVE_DOCUMENT'; documentId: string; collectionId?: string }
      const document = repository.libraryCommands.moveDocument(
        ev.documentId as EARS.EntityId,
        ev.collectionId ? ev.collectionId as EARS.EntityId : undefined
      )
      broadcastToSurface('library', {
          type: 'DOCUMENT_UPDATED' as const,
          data: { document },
        })
    },
    sendInitialData: async () => {
      const librarySettings = featureSettings.forFeature('library').get()

      broadcastToSurface('library', {
          type: 'LIBRARY_CONNECTED' as const,
          data: {
            index: repository.libraryQueries.getIndex(),
            settings: librarySettings || null
          },
        })
    },
    // File browser actions
    getFolderContents: async ({ event }) => {
      const ev = event as { type: 'GET_FOLDER_CONTENTS'; folderId: string | null }
      const folderContents = await repository.libraryQueries.getFolderContents(ev.folderId ? ev.folderId as EARS.EntityId : null)
      broadcastToSurface('library', {
          type: 'FOLDER_CONTENTS_LOADED' as const,
          data: folderContents,
        })
    },
    navigateToFolder: async ({ event }) => {
      const ev = event as { type: 'NAVIGATE_TO_FOLDER'; folderId: string | null }
      const folderContents = await repository.libraryQueries.getFolderContents(ev.folderId ? ev.folderId as EARS.EntityId : null)
      broadcastToSurface('library', {
          type: 'FOLDER_CONTENTS_LOADED' as const,
          data: folderContents,
        })
      broadcastToSurface('library', {
          type: 'NAVIGATION_CHANGED' as const,
          data: { folderId: ev.folderId, path: folderContents.currentPath },
        })
    },
    renameItem: async ({ event }) => {
      const ev = event as { type: 'RENAME_ITEM'; id: string; name: string; itemType: 'document' | 'folder' }
      if (symlink.isSymlinkId(ev.id)) {
        await libraryService.rename(ev.id, ev.name)
        // Compute parent folder ID and refresh its contents
        const parsed = symlink.parseSymlinkId(ev.id)
        let parentFolderId: string | null = null
        if (parsed) {
          const resolved = symlink.resolveSymlinkPath(ev.id)
          const basePath = symlink.getSymlinkCollectionPath(parsed.collectionId)
          if (resolved && basePath) {
            const parentRelPath = path.dirname(path.relative(basePath, resolved.absolutePath))
            parentFolderId = parentRelPath && parentRelPath !== '.'
              ? symlink.buildSymlinkId(parsed.collectionId, parentRelPath)
              : parsed.collectionId
          } else {
            parentFolderId = parsed.collectionId
          }
        }
        const folderContents = await repository.libraryQueries.getFolderContents(
          parentFolderId ? parentFolderId as EARS.EntityId : null
        )
        broadcastToSurface('library', { type: 'FOLDER_CONTENTS_LOADED' as const, data: folderContents })
      } else {
        const item = repository.libraryCommands.renameItem(ev.id as EARS.EntityId, ev.name, ev.itemType)
        broadcastToSurface('library', { type: 'ITEM_RENAMED' as const, data: { item } })
      }
    },
    deleteItems: async ({ event }) => {
      const ev = event as { type: 'DELETE_ITEMS'; ids: string[] }
      await libraryService.remove(ev.ids)
      broadcastToSurface('library', { type: 'ITEMS_DELETED' as const, data: { ids: ev.ids } })
    },
    moveItems: async ({ event }) => {
      const ev = event as { type: 'MOVE_ITEMS'; ids: string[]; targetFolderId: string | null }
      await libraryService.move(ev.ids, ev.targetFolderId)
      broadcastToSurface('library', { type: 'ITEMS_MOVED' as const, data: { ids: ev.ids, targetFolderId: ev.targetFolderId } })
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
    //   await searchIndexRepo.embedIndexedDocs()
    // },
    // updateSearchIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'UPDATE_SEARCH_INDEX'; id: string; config: any }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const index = await searchIndexRepo.updateSearchIndex(
    //     ev.id as EARS.EntityId,
    //     ev.config
    //   )
    //   broadcastToSurface('library', { type: 'SEARCH_INDEX_UPDATED', data: { index } })
    //   await searchIndexRepo.embedIndexedDocs()
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
    createSymlinkCollection: async ({ event }) => {
      const ev = event as { type: 'CREATE_SYMLINK_COLLECTION'; name: string; symlinkPath: string; parentId?: string }
      const resolvedPath = resolveHomePath(ev.symlinkPath)
      const collection = repository.libraryCommands.createSymlinkCollection(
        ev.name,
        resolvedPath,
        ev.parentId ? ev.parentId as EARS.EntityId : undefined
      )
      broadcastToSurface('library', {
          type: 'COLLECTION_CREATED' as const,
          data: { collection },
        })

    },
    updateSymlinkPath: async ({ event }) => {
      const ev = event as { type: 'UPDATE_SYMLINK_PATH'; collectionId: string; newPath: string }
      const resolvedPath = resolveHomePath(ev.newPath)

      // Validate the new path exists and is a directory
      try {
        const stat = await fs.stat(resolvedPath)
        if (!stat.isDirectory()) throw new Error('Not a directory')
      } catch {
        broadcastToSurface('library', {
            type: 'LIBRARY_ERROR' as const,
            data: { error: `Path does not exist: ${resolvedPath}` },
          })
        return
      }

      const collection = repository.libraryCommands.updateSymlinkPath(
        ev.collectionId as EARS.EntityId,
        resolvedPath
      )

      broadcastToSurface('library', {
          type: 'SYMLINK_UPDATED' as const,
          data: { collection },
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

        // Refresh library data
        const librarySettings = featureSettings.forFeature('library').get()

        broadcastToSurface('library', {
            type: 'LIBRARY_CONNECTED' as const,
            data: {
              index: repository.libraryQueries.getIndex(),
              settings: librarySettings || null,
            },
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
        
        if (changed) {
          repository.libraryCommands.updateDocumentTags(doc.id, nextTags)
          const updated = repository.libraryQueries.findDocument(doc.id)
          if (updated) {
            broadcastToSurface('library', {
                type: 'DOCUMENT_UPDATED' as const,
                data: { document: updated },
              })
          }
        }
      }
    },
  }),
}).createMachine({
  id: 'library',
  initial: 'idle',
  context: {},
  on: {
    SEND_STATE: {
      actions: ['sendInitialData'],
    },
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
        GET_LIBRARY_INDEX: {
          actions: ['sendIndex'],
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
        NAVIGATE_TO_FOLDER: {
          actions: ['navigateToFolder'],
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