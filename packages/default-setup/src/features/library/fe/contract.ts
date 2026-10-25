// The library surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears` — which is what lets
// codegen read the contract without resolving the machine, whose imports cycle back through `#generated/events`.
// `apack.json` names it at `features[].surface.contract`.
import type { NavHistory, SurfaceInbox } from '@apackdev/sdk/fe'
import type { BreadcrumbItem, DocumentDTO, LibraryItem, SearchIndex } from '#generated/types.ts'

export interface LibraryContext {
  // Core view state
  currentView: 'browser' | 'create' | 'edit' | 'create-index' | 'edit-index' | 'test-index'
  editingDocument?: DocumentDTO
  editingDocumentId?: string

  // File browser fields
  items: LibraryItem[]
  currentFolderId: string | null
  currentPath: string[]
  selectedItems: string[]
  selectedDocument: DocumentDTO | null
  sortBy: 'name' | 'modified' | 'size' | 'kind'
  sortDirection: 'asc' | 'desc'
  breadcrumbs: BreadcrumbItem[]
  editingItem?: LibraryItem
  itemToEdit?: string | null
  newItemId?: string | null

  // Tree view fields
  expandedFolderIds: string[]
  expandedFolderChildren: Record<string, LibraryItem[]>
  loadingFolderIds: string[]

  // The folders shown whose contents are on disk, which are fetched rather than watched
  diskFolderIds: (string | null)[]

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

  // Why the last of this window's writes was refused, until the user dismisses it
  writeError: string | null

  // Import/Export
  libraryImport: { status: 'idle' | 'importing' | 'success' | 'error'; errors: string[]; importedCount: number }
  libraryExport: { status: 'idle' | 'exporting' | 'success' | 'error'; errors: string[]; filePath: string; itemCount: number }

  navHistory: NavHistory<string | null>
}

/** Where an editor link into the library lands */
export type LibraryInboxEvent =
  | { type: 'EDIT_DOCUMENT'; documentId: string }
  | { type: 'NAVIGATE_TO_FOLDER'; folderId: string | null }

export type Contract = {
  opens: 'Document' | 'Collection'
  state: LibraryContext
  inbox: SurfaceInbox<{ pack: LibraryInboxEvent }>
}
