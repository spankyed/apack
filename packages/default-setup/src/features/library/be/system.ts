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
import type { Reply } from '@apackdev/sdk/events';
import type { LibraryFailureKind, OutgoingLibraryEvents } from './types.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';

/** What may fall back to every window: a command's outcome, which someone must hear, and never data a window shows */
type OutcomeType = 'LIBRARY_EXPORT_FAILED' | 'LIBRARY_EXPORTED' | 'LIBRARY_IMPORT_FAILED' | 'LIBRARY_IMPORTED'
type Outcome = Extract<OutgoingLibraryEvents, { type: OutcomeType }>

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. What
 * the import stored reaches every window through the library's views.
 */
const answer = (reply: Reply<OutgoingLibraryEvents> | undefined, event: Outcome): void =>
  (reply ? reply(event) : broadcastToSurface('library', event));

export const librarySpec = defineSystem<Contract>();

/**
 * Which of the library's kinds an error from the disk is: what is under a symlinked folder can be gone, or closed
 * to this user, while the library still lists it.
 */
function diskFailureKind(error: unknown): LibraryFailureKind | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'not-found'
  if (code === 'EACCES' || code === 'EPERM') return 'no-access'
  return undefined
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

/**
 * A window's writes to the library and its fetches of what is on disk, each answered to whoever asked: with what it
 * made or read, that it landed, or why it could not be done. The surface holds its views behind its own unanswered
 * writes and shows nothing for a fetch until it is answered, which `answers` holds whichever way a handler ends.
 * What a write changed reaches every window through the views; a write on disk, which no view can see, is told
 * (`diskChanged`).
 */
const answers = librarySpec.answers({
  CREATE_DOCUMENT: async ({ event }) => {
    await libraryService.create({
      name: event.name,
      content: event.content,
      tags: event.tags,
      parentId: event.collectionId,
      documentType: event.documentType,
    })
    if (event.collectionId && repository.libraryQueries.isDiskFolder(event.collectionId)) diskChanged(event.collectionId)
  },
  UPDATE_DOCUMENT: async ({ event }) => {
    await libraryService.update({
      id: event.id,
      name: event.name,
      content: event.content,
      tags: event.tags,
    })
    if (repository.libraryQueries.isDiskDocument(event.id)) diskChanged(diskParentOf(event.id))
  },
  DELETE_DOCUMENT: ({ event }) => { repository.libraryCommands.deleteDocument(event.id as EARS.EntityId) },
  GET_DOCUMENT: async ({ event }) => {
    const document = await libraryService.find(event.id as EARS.EntityId)
    if (!document) throw librarySpec.failure('not-found', 'Document not found')
    return { type: 'DOCUMENT_LOADED' as const, data: { document } }
  },
  CREATE_COLLECTION: async ({ event }) => {
    if (event.parentId && repository.libraryQueries.isDiskFolder(event.parentId)) {
      await libraryService.createFolder({ name: event.name, parentId: event.parentId })
      diskChanged(event.parentId)
      return
    }
    const collection = repository.libraryCommands.createCollection(
      event.name,
      event.description,
      event.parentId ? event.parentId as EARS.EntityId : undefined
    )
    // Only the window that asked names it; every window's folder shows it through the folder view
    return { type: 'COLLECTION_CREATED' as const, data: { collection } }
  },
  UPDATE_COLLECTION: ({ event }) => { repository.libraryCommands.updateCollection(event.id as EARS.EntityId, event.name, event.description) },
  DELETE_COLLECTION: ({ event }) => { repository.libraryCommands.deleteCollection(event.id as EARS.EntityId) },
  MOVE_DOCUMENT: ({ event }) => {
    repository.libraryCommands.moveDocument(event.documentId as EARS.EntityId, event.collectionId ? event.collectionId as EARS.EntityId : undefined)
  },
  // File browser
  GET_FOLDER_CONTENTS: async ({ event }) => ({
    type: 'FOLDER_CONTENTS_LOADED' as const,
    data: await repository.libraryQueries.getFolderContents(event.folderId ? event.folderId as EARS.EntityId : null),
  }),
  CHECK_SYMLINKS: async ({ event }) => ({
    type: 'SYMLINKS_CHECKED' as const, ids: event.ids, broken: await repository.libraryQueries.brokenSymlinks(event.ids),
  }),
  RENAME_ITEM: async ({ event }) => {
    if (symlink.isSymlinkId(event.id)) {
      // Worked out before the rename, while the path still resolves
      const parent = diskParentOf(event.id)
      await libraryService.rename(event.id, event.name)
      diskChanged(parent)
      return
    }
    repository.libraryCommands.renameItem(event.id as EARS.EntityId, event.name, event.itemType)
  },
  DELETE_ITEMS: async ({ event }) => {
    await libraryService.remove(event.ids)
    if (event.ids.some(symlink.isSymlinkId)) diskChanged(null)
  },
  MOVE_ITEMS: async ({ event }) => {
    await libraryService.move(event.ids, event.targetFolderId)
    if (event.ids.some(symlink.isSymlinkId) || repository.libraryQueries.isDiskFolder(event.targetFolderId)) diskChanged(null)
  },
  // Symlinked folders
  CREATE_SYMLINK_COLLECTION: ({ event }) => {
    const collection = repository.libraryCommands.createSymlinkCollection(
      event.name,
      resolveHomePath(event.symlinkPath),
      event.parentId ? event.parentId as EARS.EntityId : undefined
    )
    return { type: 'COLLECTION_CREATED' as const, data: { collection } }
  },
  UPDATE_SYMLINK_PATH: async ({ event }) => {
    const resolvedPath = resolveHomePath(event.newPath)
    // A folder to link has to be one: missing, or a file, is refused
    let isDirectory = false
    try {
      isDirectory = (await fs.stat(resolvedPath)).isDirectory()
    } catch {
      // Missing: refused below
    }
    if (!isDirectory) throw librarySpec.failure('not-found', `Path does not exist: ${resolvedPath}`)
    repository.libraryCommands.updateSymlinkPath(event.collectionId as EARS.EntityId, resolvedPath)
    diskChanged(event.collectionId)
  },
}, { landed: { type: 'LIBRARY_WRITTEN' }, source: 'library', kindOf: diskFailureKind })

export const librarySystem = setup({
  types: librarySpec.types,
  actions: { ...answers.actions, ...librarySpec.actions({
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
  }) },
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
        ...answers.on,
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