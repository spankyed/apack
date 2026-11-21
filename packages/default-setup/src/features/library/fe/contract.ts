// The library surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears` — which is what lets
// codegen read the contract without resolving the machine, whose imports cycle back through `#generated/events`.
// `apack.json` names it at `features[].surface.contract`.
import type { NavHistory, SurfaceInbox } from '@apackdev/sdk/fe'
import type { BreadcrumbItem, DocumentDTO, LibraryItem, SearchIndex } from '#generated/types.ts'
import type { EARS } from '#generated/ears.ts'

export interface LibraryContext {
  // Core view state
  currentView: 'browser' | 'create' | 'edit' | 'create-index' | 'edit-index' | 'test-index'
  editingDocument?: DocumentDTO
  editingDocumentId?: EARS.EntityId

  // File browser fields
  items: LibraryItem[]
  currentFolderId: EARS.EntityId | null
  currentPath: string[]
  selectedItems: EARS.EntityId[]
  selectedDocument: DocumentDTO | null
  sortBy: 'name' | 'modified' | 'size' | 'kind'
  sortDirection: 'asc' | 'desc'
  breadcrumbs: BreadcrumbItem[]
  editingItem?: LibraryItem
  itemToEdit?: EARS.EntityId | null
  newItemId?: EARS.EntityId | null

  // Tree view fields
  expandedFolderIds: EARS.EntityId[]
  expandedFolderChildren: Record<EARS.EntityId, LibraryItem[]>
  loadingFolderIds: EARS.EntityId[]

  // The folders shown whose contents are on disk, which are fetched rather than watched
  diskFolderIds: (EARS.EntityId | null)[]

  // Search index fields
  searchIndices: SearchIndex[]
  editingIndexId?: string
  editingIndex?: SearchIndex

  // Search test fields
  testingIndexId?: string
  testingIndex?: SearchIndex
  testQuery: string
  testResults: any[]
  isSearching: boolean

  // Symlink context
  isInSymlinkContext: boolean
  currentSymlinkRootId: string | null
  symlinkBasePath: string | null
  isBroken: boolean
  lastKnownPath: string | null

  // Why the last of this window's writes or fetches was not done, until the user dismisses it
  writeError: string | null

  navHistory: NavHistory<EARS.EntityId | null>
}

/** Where an editor link into the library lands */
export type LibraryInboxEvent =
  | { type: 'EDIT_DOCUMENT'; documentId: EARS.EntityId }
  | { type: 'NAVIGATE_TO_FOLDER'; folderId: EARS.EntityId | null }

export type Contract = {
  opens: 'Document' | 'Collection'
  state: LibraryContext
  inbox: SurfaceInbox<{ pack: LibraryInboxEvent }>
}
