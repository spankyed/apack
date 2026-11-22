// The app's real library system (packages/default-setup/src/features/library/be/system.ts), ported to the
// prototype handler for handler. Everything it calls is the real thing by name; the declarations in the first
// section stand in for those imports so this file typechecks on its own. It is not run.

import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { reaching } from './state.mts'

const state = reaching()

// ── stand-ins for the real imports ──────────────────────────────────────────────────────────────────────────────────

type EntityId = string & { readonly __entity?: true }
interface Document { id: EntityId; name: string; tags: string[] }
interface Collection { id: EntityId; name: string }
interface FolderContents { folders: Collection[]; documents: Document[] }
interface TagChanges { renames: Array<[string, string]>; removed: Array<{ name: string }> }

/** ./services/library.ts */
declare const libraryService: {
  create(input: { name: string; content: unknown[]; tags: string[]; parentId?: string; documentType?: string }): Promise<void>
  update(input: { id: string; name: string; content: unknown[]; tags: string[] }): Promise<void>
  find(id: EntityId): Promise<Document | undefined>
  createFolder(input: { name: string; parentId: string }): Promise<void>
  rename(id: string, name: string): Promise<void>
  remove(ids: string[]): Promise<void>
  move(ids: string[], targetFolderId: string | null): Promise<void>
}
/** #generated/repository.ts */
declare const repository: {
  libraryQueries: {
    isDiskFolder(id: string | null): boolean
    isDiskDocument(id: string): boolean
    getFolderContents(folderId: EntityId | null): Promise<FolderContents>
    brokenSymlinks(ids: string[]): Promise<string[]>
    getAllDocuments(): Document[]
  }
  libraryCommands: {
    deleteDocument(id: EntityId): void
    createCollection(name: string, description?: string, parentId?: EntityId): Collection
    updateCollection(id: EntityId, name: string, description?: string): void
    deleteCollection(id: EntityId): void
    moveDocument(documentId: EntityId, collectionId?: EntityId): void
    renameItem(id: EntityId, name: string, itemType: 'document' | 'folder'): void
    createSymlinkCollection(name: string, symlinkPath: string, parentId?: EntityId): Collection
    updateSymlinkPath(collectionId: EntityId, newPath: string): void
    updateDocumentTags(id: EntityId, tags: string[]): void
  }
}
/** ./repository/symlink.ts */
declare const symlink: {
  isSymlinkId(id: string): boolean
  parseSymlinkId(id: string): { collectionId: string } | undefined
  resolveSymlinkPath(id: string): { absolutePath: string } | undefined
  getSymlinkCollectionPath(collectionId: string): string | undefined
  buildSymlinkId(collectionId: string, relativePath: string): string
}
/** #generated/events.ts */
declare function broadcastToSurface(surface: 'library', event: { type: 'FOLDER_CHANGED'; folderId: string | null }): void
/** ./import-library.ts and ./export-library.ts */
declare function importLibrary(directory: string): { created: number; errors: string[] }
declare function exportLibrary(directory: string, format: 'markdown' | 'json'): { filePath: string; itemCount: number }
/** @apackdev/sdk/utils */
declare function toMap<K, V>(pairs: Array<[K, V]>): Map<K, V>
declare function toIdentifierSet<T>(items: T[], identify: (item: T) => string): Set<string>
declare function mapArray(tags: string[], renames: Map<string, string>, removed: Set<string>): { next: string[]; changed: boolean }

// ── what the library takes ──────────────────────────────────────────────────────────────────────────────────────────

/** The one thing it is told that nobody waits on. */
type LibraryEvent =
  | { type: 'FEATURE_SETTINGS_UPDATED'; changes?: { tags?: TagChanges } }

/** Everything a window asks of it. Each is answered exactly once: with its answer, a refusal, or a failure. */
type LibraryAsks = {
  // documents
  CREATE_DOCUMENT:   { args: { name: string; content: unknown[]; tags: string[]; collectionId?: string; documentType?: string }; answer: void }
  UPDATE_DOCUMENT:   { args: { id: string; name: string; content: unknown[]; tags: string[] }; answer: void }
  DELETE_DOCUMENT:   { args: { id: string }; answer: void }
  MOVE_DOCUMENT:     { args: { documentId: string; collectionId?: string }; answer: void }
  GET_DOCUMENT:      { args: { id: string }; answer: { document: Document }; refuses: 'not-found' }

  // folders
  CREATE_COLLECTION: { args: { name: string; description?: string; parentId?: string }; answer: { collection: Collection | null } }
  UPDATE_COLLECTION: { args: { id: string; name: string; description?: string }; answer: void }
  DELETE_COLLECTION: { args: { id: string }; answer: void }

  // the file browser
  GET_FOLDER_CONTENTS: { args: { folderId: string | null }; answer: FolderContents }
  CHECK_SYMLINKS:      { args: { ids: string[] }; answer: { broken: string[] } }
  RENAME_ITEM:         { args: { id: string; name: string; itemType: 'document' | 'folder' }; answer: void }
  DELETE_ITEMS:        { args: { ids: string[] }; answer: void }
  MOVE_ITEMS:          { args: { ids: string[]; targetFolderId: string | null }; answer: void }

  // folders linked from disk
  CREATE_SYMLINK_COLLECTION: { args: { name: string; symlinkPath: string; parentId?: string }; answer: { collection: Collection } }
  UPDATE_SYMLINK_PATH:       { args: { collectionId: string; newPath: string }; answer: void; refuses: 'not-a-folder' }

  // import and export
  IMPORT_LIBRARY: { args: { directory: string }; answer: { count: number; errors: string[] }; refuses: 'nothing-imported' }
  EXPORT_LIBRARY: { args: { directory: string; format: 'markdown' | 'json' }; answer: { filePath: string; itemCount: number } }
}

// ── helpers, unchanged from the real file ───────────────────────────────────────────────────────────────────────────

/**
 * Tells every window that something on disk under a symlinked folder changed, which no view can see: `folderId`'s
 * contents, or with `null`, a symlinked folder's not known. A notification: whoever is showing one fetches it again.
 */
const diskChanged = (folderId: string | null): void => broadcastToSurface('library', { type: 'FOLDER_CHANGED', folderId })

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

// ── the system ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const librarySystem = state<{}, LibraryEvent, LibraryAsks>()({
  asks: {
    // ── documents ───────────────────────────────────────────────────────────────────────────────────────────────────

    async CREATE_DOCUMENT({ name, content, tags, collectionId, documentType }) {
      await libraryService.create({ name, content, tags, parentId: collectionId, documentType })
      if (collectionId && repository.libraryQueries.isDiskFolder(collectionId)) diskChanged(collectionId)
    },

    async UPDATE_DOCUMENT({ id, name, content, tags }) {
      await libraryService.update({ id, name, content, tags })
      if (repository.libraryQueries.isDiskDocument(id)) diskChanged(diskParentOf(id))
    },

    DELETE_DOCUMENT: ({ id }) => {
      repository.libraryCommands.deleteDocument(id)
    },

    MOVE_DOCUMENT: ({ documentId, collectionId }) => {
      repository.libraryCommands.moveDocument(documentId, collectionId)
    },

    async GET_DOCUMENT({ id }, { refuse }) {
      const document = await libraryService.find(id)
      if (!document) throw refuse('not-found', 'Document not found')
      return { document }
    },

    // ── folders ─────────────────────────────────────────────────────────────────────────────────────────────────────

    async CREATE_COLLECTION({ name, description, parentId }) {
      if (parentId && repository.libraryQueries.isDiskFolder(parentId)) {
        await libraryService.createFolder({ name, parentId })
        diskChanged(parentId)
        return { collection: null }
      }
      // Only the window that asked names it; every window's folder shows it through the folder view
      return { collection: repository.libraryCommands.createCollection(name, description, parentId) }
    },

    UPDATE_COLLECTION: ({ id, name, description }) => {
      repository.libraryCommands.updateCollection(id, name, description)
    },

    DELETE_COLLECTION: ({ id }) => {
      repository.libraryCommands.deleteCollection(id)
    },

    // ── the file browser ────────────────────────────────────────────────────────────────────────────────────────────

    GET_FOLDER_CONTENTS: ({ folderId }) => repository.libraryQueries.getFolderContents(folderId),

    async CHECK_SYMLINKS({ ids }) {
      return { broken: await repository.libraryQueries.brokenSymlinks(ids) }
    },

    async RENAME_ITEM({ id, name, itemType }) {
      if (!symlink.isSymlinkId(id)) { repository.libraryCommands.renameItem(id, name, itemType); return }
      // Worked out before the rename, while the path still resolves
      const parent = diskParentOf(id)
      await libraryService.rename(id, name)
      diskChanged(parent)
    },

    async DELETE_ITEMS({ ids }) {
      await libraryService.remove(ids)
      if (ids.some(symlink.isSymlinkId)) diskChanged(null)
    },

    async MOVE_ITEMS({ ids, targetFolderId }) {
      await libraryService.move(ids, targetFolderId)
      if (ids.some(symlink.isSymlinkId) || repository.libraryQueries.isDiskFolder(targetFolderId)) diskChanged(null)
    },

    // ── folders linked from disk ────────────────────────────────────────────────────────────────────────────────────

    CREATE_SYMLINK_COLLECTION: ({ name, symlinkPath, parentId }) => ({
      collection: repository.libraryCommands.createSymlinkCollection(name, resolveHomePath(symlinkPath), parentId),
    }),

    async UPDATE_SYMLINK_PATH({ collectionId, newPath }, { refuse }) {
      const resolved = resolveHomePath(newPath)
      const isDirectory = await fs.stat(resolved).then((found) => found.isDirectory(), () => false)
      if (!isDirectory) throw refuse('not-a-folder', `Path does not exist: ${resolved}`)
      repository.libraryCommands.updateSymlinkPath(collectionId, resolved)
      diskChanged(collectionId)
    },

    // ── import and export ───────────────────────────────────────────────────────────────────────────────────────────

    IMPORT_LIBRARY: ({ directory }, { refuse }) => {
      const result = importLibrary(directory)
      // An import can fail part way, after creating documents: that is an answer with errors, not a refusal
      if (result.created === 0 && result.errors.length > 0) throw refuse('nothing-imported', result.errors.join('\n'))
      return { count: result.created, errors: result.errors }
    },

    EXPORT_LIBRARY: ({ directory, format }) => {
      const { filePath, itemCount } = exportLibrary(directory, format)
      return { filePath, itemCount }
    },
  },

  on: {
    FEATURE_SETTINGS_UPDATED: ({ changes }) => {
      const tagChanges = changes?.tags
      if (!tagChanges) return

      const renames = toMap(tagChanges.renames)
      const removed = toIdentifierSet(tagChanges.removed, (item) => item.name)
      if (!renames.size && !removed.size) return

      // Update all documents that have renamed or removed tags
      for (const doc of repository.libraryQueries.getAllDocuments()) {
        const { next, changed } = mapArray(doc.tags, renames, removed)
        if (changed) repository.libraryCommands.updateDocumentTags(doc.id, next)
      }
    },
  },
})
