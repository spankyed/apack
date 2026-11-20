// [SEARCH_INDEX_FF] The search index is dormant: ./search-index/README.md lists its call sites and how to turn it on
import type { Contract } from './contract.ts';

import { setup } from 'xstate'
import { defineSystem } from '@apackdev/sdk/framework'
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
import type { OutgoingLibraryEvents } from './types.ts';
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
 * made or read, or why it could not be done. The surface holds its views behind its own unanswered writes and shows
 * nothing for a fetch until it is answered, which the table holds whichever way a handler ends. An error from the disk
 * under a symlinked folder is answered as the kind it is (`not-found`, `no-access`) where the ask declares it.
 */
export const answers = librarySpec.answers({
  CREATE_DOCUMENT: async ({ ask }) => {
    await libraryService.create({
      name: ask.name,
      content: ask.content,
      tags: ask.tags,
      parentId: ask.collectionId,
      documentType: ask.documentType,
    })
    if (ask.collectionId && repository.libraryQueries.isDiskFolder(ask.collectionId)) diskChanged(ask.collectionId)
  },
  UPDATE_DOCUMENT: async ({ ask }) => {
    await libraryService.update({ id: ask.id, name: ask.name, content: ask.content, tags: ask.tags })
    if (repository.libraryQueries.isDiskDocument(ask.id)) diskChanged(diskParentOf(ask.id))
  },
  DELETE_DOCUMENT: ({ ask }) => { repository.libraryCommands.deleteDocument(ask.id) },
  GET_DOCUMENT: async ({ ask, failure }) => {
    const document = await libraryService.find(ask.id)
    if (!document) throw failure('not-found', 'Document not found')
    return { document }
  },
  CREATE_COLLECTION: async ({ ask }) => {
    if (ask.parentId && repository.libraryQueries.isDiskFolder(ask.parentId)) {
      await libraryService.createFolder({ name: ask.name, parentId: ask.parentId })
      diskChanged(ask.parentId)
      return {}
    }
    // Only the window that asked names it; every window's folder shows it through the folder view
    return { collection: repository.libraryCommands.createCollection(ask.name, ask.description, ask.parentId) }
  },
  UPDATE_COLLECTION: ({ ask }) => { repository.libraryCommands.updateCollection(ask.id, ask.name, ask.description) },
  DELETE_COLLECTION: ({ ask }) => { repository.libraryCommands.deleteCollection(ask.id) },
  MOVE_DOCUMENT: ({ ask }) => { repository.libraryCommands.moveDocument(ask.documentId, ask.collectionId) },
  // File browser
  GET_FOLDER_CONTENTS: ({ ask }) => repository.libraryQueries.getFolderContents(ask.folderId),
  CHECK_SYMLINKS: async ({ ask }) => ({ ids: ask.ids, broken: await repository.libraryQueries.brokenSymlinks(ask.ids) }),
  RENAME_ITEM: async ({ ask }) => {
    if (symlink.isSymlinkId(ask.id)) {
      // Worked out before the rename, while the path still resolves
      const parent = diskParentOf(ask.id)
      await libraryService.rename(ask.id, ask.name)
      diskChanged(parent)
      return
    }
    repository.libraryCommands.renameItem(ask.id, ask.name, ask.itemType)
  },
  DELETE_ITEMS: async ({ ask }) => {
    await libraryService.remove(ask.ids)
    if (ask.ids.some(symlink.isSymlinkId)) diskChanged(null)
  },
  MOVE_ITEMS: async ({ ask }) => {
    await libraryService.move(ask.ids, ask.targetFolderId)
    if (ask.ids.some(symlink.isSymlinkId) || repository.libraryQueries.isDiskFolder(ask.targetFolderId)) diskChanged(null)
  },
  // Symlinked folders
  CREATE_SYMLINK_COLLECTION: ({ ask }) => ({
    collection: repository.libraryCommands.createSymlinkCollection(ask.name, resolveHomePath(ask.symlinkPath), ask.parentId),
  }),
  UPDATE_SYMLINK_PATH: async ({ ask, failure }) => {
    const resolvedPath = resolveHomePath(ask.newPath)
    // A folder to link has to be one: missing, or a file, is refused
    let isDirectory = false
    try {
      isDirectory = (await fs.stat(resolvedPath)).isDirectory()
    } catch {
      // Missing: refused below
    }
    if (!isDirectory) throw failure('not-found', `Path does not exist: ${resolvedPath}`)
    repository.libraryCommands.updateSymlinkPath(ask.collectionId, resolvedPath)
    diskChanged(ask.collectionId)
  },
})

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