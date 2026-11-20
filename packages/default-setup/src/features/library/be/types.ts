export type * from './export-types.ts';
import type { EARS } from '#generated/ears.ts'
import type { ContentSection, DocumentShortCode } from '@apackdev/sdk';

/**
 * The document model is the SDK's (`@apackdev/sdk`): the app reads documents, so the entities, their
 * shapes and the sections a document holds are declared there. Re-exported here because this pack's
 * code names them through its own types, and this feature is still their editor.
 */
export type {
  ContentSection, ContentType, DocumentShortCode, DocumentEntity, CollectionEntity,
  FieldContent, ListContent, MarkdownContent, TextContent, CodeContent,
} from '@apackdev/sdk';


export interface DocumentDTO {
  id: EARS.EntityId
  name: string
  content: ContentSection[]
  /** Its short code; absent for a file the library shows from disk (`isSymlinked`), which is no Document */
  shortCode?: DocumentShortCode
  tags: string[]
  /**
   * What this document is: `commands` marks a slash-command list, which the `commands` designation's
   * owner serves. A written document's own frontmatter `type` says so, and the format it was compiled
   * with supplies a default where a whole source is one kind; a document created in the app carries
   * whatever its creator passed. Absent, it is just a document.
   */
  documentType?: string
  collectionId?: EARS.EntityId
  collectionPath?: string[]
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export interface CollectionDTO {
  id: EARS.EntityId
  name: string
  description?: string
  parentId?: EARS.EntityId
  path: string[]
  documentCount: number
  childCollections: CollectionDTO[]
  displayOrder: number
  createdAt: string
  updatedAt: string
  symlinkPath?: string
}

// New unified file browser types
export interface FolderItem {
  type: 'folder'
  id: EARS.EntityId
  name: string
  parentId: EARS.EntityId | null
  childCount: number
  size: string // Display as "-- items" or "X items"
  kind: 'Folder'
  displayOrder: number
  createdAt: string
  updatedAt: string
  isSymlink?: boolean
  symlinkPath?: string
  isSymlinked?: boolean
  isBroken?: boolean
}

export interface DocumentItem {
  type: 'document'
  id: EARS.EntityId
  name: string
  /** Its short code; absent for a file the library shows from disk (`isSymlinked`), which is no Document */
  shortCode?: DocumentShortCode
  parentId: EARS.EntityId | null
  content: ContentSection[]
  tags: string[]
  size: string // Content length formatted (e.g., "1.2 KB")
  kind: 'Document'
  displayOrder: number
  createdAt: string
  updatedAt: string
  isSymlinked?: boolean
  filePath?: string
}

export type LibraryItem = FolderItem | DocumentItem

export interface FolderContents {
  items: LibraryItem[]
  currentPath: string[]
  currentFolderId: EARS.EntityId | null
  breadcrumbs: BreadcrumbItem[]
  searchIndices?: any[] // Will be properly typed on frontend via schema
  isBroken?: boolean
  lastKnownPath?: string
}

/** The library's `folder` view: a folder's contents as stored, or that they are on disk and fetched instead */
export type FolderView = { onDisk: true } | { onDisk: false; contents: FolderContents }

/** The library's `document` view: a document as stored, `null` once it's gone, or that it is a file on disk */
export type DocumentView = { onDisk: true } | { onDisk: false; document: DocumentDTO | null }

/**
 * Every document and folder in the library, by name: what the reference picker offers and the
 * panel counts. The file browser reads one folder at a time through `FolderContents` instead.
 */
export interface LibraryIndex {
  documents: Array<{ id: EARS.EntityId; name: string; shortCode: DocumentShortCode; tags: string[] }>
  folders: Array<{ id: EARS.EntityId; name: string }>
}

export interface BreadcrumbItem {
  id: EARS.EntityId | null
  name: string
  path: string[]
}

/** The library keeps nothing of its own: each view reads the repository when it is asked */
export interface LibrarySystemContext {}

// Library-internal re-exports from search-index subsystem
export type {
  Occurrence,
  SegmentRule,
  SearchIndexConfig,
  SearchIndex,
  IndexSearchResult,
} from './search-index/types/search-index.ts'

/**
 * What a write or a fetch under a symlinked folder may find on disk, beside the standard two: what it named is gone,
 * or is closed to this user. The disk's own errors are these kinds wherever an ask declares them.
 */
type OnDisk = { 'not-found': {}; 'no-access': {} }

/**
 * What a window asks the library, each answered once: a write with what it made or that it landed, a fetch of what is
 * on disk (which no view can watch) with what it read, an import or an export with what it did. What a write changed
 * in the library itself reaches every window through the views; a write on disk, which no view sees, is told
 * (`FOLDER_CHANGED`).
 */
export type LibraryAsks = {
  CREATE_DOCUMENT: { ask: { name: string; content: ContentSection[]; tags: string[]; collectionId?: EARS.EntityId; documentType?: string }; fails: OnDisk }
  UPDATE_DOCUMENT: { ask: { id: EARS.EntityId; name: string; content: ContentSection[]; tags: string[] }; fails: OnDisk }
  DELETE_DOCUMENT: { ask: { id: EARS.EntityId } }
  /** A document, read from disk when it is a file under a symlinked folder */
  GET_DOCUMENT: { ask: { id: EARS.EntityId }; answer: { document: DocumentDTO }; fails: OnDisk }
  /** Answered with the folder it made in the library, for the window that asked to name; one on disk is only made */
  CREATE_COLLECTION: { ask: { name: string; description?: string; parentId?: EARS.EntityId }; answer: { collection?: CollectionDTO }; fails: OnDisk }
  UPDATE_COLLECTION: { ask: { id: EARS.EntityId; name: string; description?: string } }
  DELETE_COLLECTION: { ask: { id: EARS.EntityId } }
  MOVE_DOCUMENT: { ask: { documentId: EARS.EntityId; collectionId?: EARS.EntityId } }
  /** A folder's contents, read from disk when it is a symlinked folder or one inside one */
  GET_FOLDER_CONTENTS: { ask: { folderId: EARS.EntityId | null }; answer: FolderContents; fails: OnDisk }
  /** Which of these symlinked collections no longer reach their folder on disk */
  CHECK_SYMLINKS: { ask: { ids: EARS.EntityId[] }; answer: { ids: EARS.EntityId[]; broken: EARS.EntityId[] } }
  RENAME_ITEM: { ask: { id: EARS.EntityId; name: string; itemType: 'document' | 'folder' }; fails: OnDisk }
  DELETE_ITEMS: { ask: { ids: EARS.EntityId[] }; fails: OnDisk }
  MOVE_ITEMS: { ask: { ids: EARS.EntityId[]; targetFolderId: EARS.EntityId | null }; fails: OnDisk }
  CREATE_SYMLINK_COLLECTION: { ask: { name: string; symlinkPath: string; parentId?: EARS.EntityId }; answer: { collection: CollectionDTO } }
  /** Refused as `not-found` for a path that is no folder */
  UPDATE_SYMLINK_PATH: { ask: { collectionId: EARS.EntityId; newPath: string }; fails: { 'not-found': {} } }
  EXPORT_LIBRARY: { ask: { directory: string; format: 'markdown' | 'json' }; answer: { filePath: string; itemCount: number } }
  /** Imported with what could not be, unless nothing could, which fails */
  IMPORT_LIBRARY: { ask: { directory: string }; answer: { count: number; errors?: string[] } }
}

/**
 * What the library system sends beside its answers: the one notification there is, a folder on disk having changed. What the library stores is its views; what is on disk is fetched.
 */
export type OutgoingLibraryEvents =
  /**
   * Something on disk under a symlinked folder changed — `folderId`'s contents, or, with `null`, which is not known —
   * for every window showing such a folder to fetch it again. A notification: no window asked for it.
   */
  | { type: 'FOLDER_CHANGED'; folderId: string | null }
  // [SEARCH_INDEX_FF] Search index events — commented out
  // | { type: 'SEARCH_INDICES_LOADED'; data: { indices: SearchIndex[] } }
  // | { type: 'SEARCH_INDEX_CREATED'; data: { index: SearchIndex } }
  // | { type: 'SEARCH_INDEX_UPDATED'; data: { index: SearchIndex } }
  // | { type: 'SEARCH_INDEX_DELETED'; data: { indexId: string } }
  // | { type: 'SEARCH_RESULTS'; data: { results: any[] } }
  // | { type: 'INDEXING_PROGRESS'; data: { indexId: string; progress: number; total: number } }
