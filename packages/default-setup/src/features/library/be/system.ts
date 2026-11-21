// [SEARCH_INDEX_FF] The search index is dormant: ./search-index/README.md lists its call sites and how to turn it on
import type { Contract } from './contract.ts';

import { setup } from 'xstate'
import { defineSystem } from '@apackdev/sdk/framework'
// [SEARCH_INDEX_FF] import type { SearchIndex } from './search-index/types/search-index'
import { broadcast } from '#generated/events.ts'
import { repository } from '#generated/repository.ts';
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { libraryService } from './services/library.ts'
import * as symlink from './repository/symlink.ts'
import { toMap, toIdentifierSet, mapArray } from '@apackdev/sdk/utils'
import { exportLibrary } from './export-library.ts'
import { importLibrary } from './import-library.ts'

export const librarySpec = defineSystem<Contract>();

/**
 * Tells every window that something on disk under a symlinked folder changed, which no view can see: `folderId`'s
 * contents, or with `null`, a symlinked folder's not known. A notification — whoever is showing one fetches it again.
 */
const diskChanged = (folderId: string | null) => broadcast('library', { type: 'FOLDER_CHANGED', folderId })

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
 * A window's writes to the library, its fetches of what is on disk and its imports and exports, each answered to
 * whoever asked: with what it made, read, imported or exported, or why it could not be done. The surface holds its views behind its own unanswered writes and shows
 * nothing for a fetch until it is answered, which the table holds whichever way a handler ends. An error from the disk
 * under a symlinked folder is answered as the kind it is (`not-found`, `no-access`) where the ask declares it.
 */
export const answers = librarySpec.answers({
  CREATE_DOCUMENT: async ({ args }) => {
    await libraryService.create({
      name: args.name,
      content: args.content,
      tags: args.tags,
      parentId: args.collectionId,
      documentType: args.documentType,
    })
    if (args.collectionId && repository.libraryQueries.isDiskFolder(args.collectionId)) diskChanged(args.collectionId)
  },
  UPDATE_DOCUMENT: async ({ args }) => {
    await libraryService.update({ id: args.id, name: args.name, content: args.content, tags: args.tags })
    if (repository.libraryQueries.isDiskDocument(args.id)) diskChanged(diskParentOf(args.id))
  },
  DELETE_DOCUMENT: ({ args }) => { repository.libraryCommands.deleteDocument(args.id) },
  GET_DOCUMENT: async ({ args, refuse }) => {
    const document = await libraryService.find(args.id)
    if (!document) throw refuse('not-found', 'Document not found')
    return { document }
  },
  CREATE_COLLECTION: async ({ args }) => {
    if (args.parentId && repository.libraryQueries.isDiskFolder(args.parentId)) {
      await libraryService.createFolder({ name: args.name, parentId: args.parentId })
      diskChanged(args.parentId)
      return {}
    }
    // Only the window that asked names it; every window's folder shows it through the folder view
    return { collection: repository.libraryCommands.createCollection(args.name, args.description, args.parentId) }
  },
  UPDATE_COLLECTION: ({ args }) => { repository.libraryCommands.updateCollection(args.id, args.name, args.description) },
  DELETE_COLLECTION: ({ args }) => { repository.libraryCommands.deleteCollection(args.id) },
  MOVE_DOCUMENT: ({ args }) => { repository.libraryCommands.moveDocument(args.documentId, args.collectionId) },
  // File browser
  GET_FOLDER_CONTENTS: ({ args }) => repository.libraryQueries.getFolderContents(args.folderId),
  CHECK_SYMLINKS: async ({ args }) => ({ ids: args.ids, broken: await repository.libraryQueries.brokenSymlinks(args.ids) }),
  RENAME_ITEM: async ({ args }) => {
    if (symlink.isSymlinkId(args.id)) {
      // Worked out before the rename, while the path still resolves
      const parent = diskParentOf(args.id)
      await libraryService.rename(args.id, args.name)
      diskChanged(parent)
      return
    }
    repository.libraryCommands.renameItem(args.id, args.name, args.itemType)
  },
  DELETE_ITEMS: async ({ args }) => {
    await libraryService.remove(args.ids)
    if (args.ids.some(symlink.isSymlinkId)) diskChanged(null)
  },
  MOVE_ITEMS: async ({ args }) => {
    await libraryService.move(args.ids, args.targetFolderId)
    if (args.ids.some(symlink.isSymlinkId) || repository.libraryQueries.isDiskFolder(args.targetFolderId)) diskChanged(null)
  },
  // Symlinked folders
  CREATE_SYMLINK_COLLECTION: ({ args }) => ({
    collection: repository.libraryCommands.createSymlinkCollection(args.name, resolveHomePath(args.symlinkPath), args.parentId),
  }),
  UPDATE_SYMLINK_PATH: async ({ args, refuse }) => {
    const resolvedPath = resolveHomePath(args.newPath)
    // A folder to link has to be one: missing, or a file, is refused
    let isDirectory = false
    try {
      isDirectory = (await fs.stat(resolvedPath)).isDirectory()
    } catch {
      // Missing: refused below
    }
    if (!isDirectory) throw refuse('not-found', `Path does not exist: ${resolvedPath}`)
    repository.libraryCommands.updateSymlinkPath(args.collectionId, resolvedPath)
    diskChanged(args.collectionId)
  },
  EXPORT_LIBRARY: ({ args: { directory, format } }) => exportLibrary(directory, format),
  // What an import stored reaches every window through the library's views, a part way import's included
  IMPORT_LIBRARY: ({ args: { directory } }) => {
    const result = importLibrary(directory)
    if (result.created === 0 && result.errors.length > 0) throw new Error(result.errors.join('\n'))
    return { count: result.created, ...(result.errors.length > 0 ? { errors: result.errors } : {}) }
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
    //   broadcast('library', { type: 'SEARCH_INDICES_LOADED', data: { indices } })
    // },
    // createSearchIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'CREATE_SEARCH_INDEX'; config: any; folderId: string | null }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const index = await searchIndexRepo.createSearchIndex(
    //     ev.config,
    //     ev.folderId ? ev.folderId as EARS.EntityId : null
    //   )
    //   broadcast('library', { type: 'SEARCH_INDEX_CREATED', data: { index } })
    //   await searchIndexRepo.embedIndexedDocs()
    // },
    // updateSearchIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'UPDATE_SEARCH_INDEX'; id: string; config: any }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const index = await searchIndexRepo.updateSearchIndex(
    //     ev.id as EARS.EntityId,
    //     ev.config
    //   )
    //   broadcast('library', { type: 'SEARCH_INDEX_UPDATED', data: { index } })
    //   await searchIndexRepo.embedIndexedDocs()
    // },
    // deleteSearchIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'DELETE_SEARCH_INDEX'; id: string }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   await searchIndexRepo.deleteSearchIndex(ev.id as EARS.EntityId)
    //   broadcast('library', { type: 'SEARCH_INDEX_DELETED', data: { indexId: ev.id } })
    // },
    // searchInIndex: async ({ system, event }) => {
    //   const ev = event as { type: 'SEARCH_IN_INDEX'; indexId: string; query: string; limit?: number }
    //   const searchIndexRepo = await import('./search-index/repository')
    //   const results = await searchIndexRepo.searchInIndex(
    //     ev.indexId as EARS.EntityId,
    //     ev.query,
    //     ev.limit
    //   )
    //   broadcast('library', { type: 'SEARCH_RESULTS', data: { results } })
    // },
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
      },
    },
  },
})

const libraryEntry = { spec: librarySpec, machine: librarySystem };

export default libraryEntry;