export type LibraryItemType = 'document' | 'folder';

export type LibraryItemState = {
  children?: LibraryItemState[];
  content?: LibraryContentSectionState[];
  createdAt?: string;
  expanded?: boolean;
  filePath?: string;
  id: string;
  isContextMenuOpen?: boolean;
  isEditing?: boolean;
  isBroken?: boolean;
  isSymlink?: boolean;
  isSymlinked?: boolean;
  kind: string;
  name: string;
  relinkForm?: {
    path: string;
    show: boolean;
  };
  selected?: boolean;
  shortCode?: string;
  size: string;
  tags?: string[];
  type: LibraryItemType;
  updatedAt: string;
};

export type LibraryBreadcrumbState = {
  id: string | null;
  name: string;
};

export type LibraryPanelState = {
  allTags: Array<{count: number; name: string; tone: 'blue' | 'purple' | 'green'}>;
  documentsCount: number;
  foldersCount: number;
  selectedItem?: LibraryItemState;
  selectedDocumentsCount?: number;
  selectedFoldersCount?: number;
  selectedItemsCount?: number;
  selectedItemsTags?: string[];
};

export type LibraryContentSectionState =
  | {text: string; type: 'markdown'}
  | {text: string; type: 'text'}
  | {fields: Array<{key: string; value: string}>; type: 'field'}
  | {items: string[]; type: 'list'}
  | {language?: string; text: string; type: 'code'};

export type LibraryDocumentEditorState = {
  availableTags: Array<{color?: string; name: string}>;
  collectionId?: string;
  document?: {
    id: string;
    name: string;
    shortCode: string;
  };
  shortCodeCopied?: boolean;
  isSymlink?: boolean;
  name: string;
  sections: LibraryContentSectionState[];
  tags: string[];
  tagsExpanded?: boolean;
};

export type LibrarySurfaceState = {
  breadcrumbs: LibraryBreadcrumbState[];
  currentFolderId: string | null;
  currentView?: 'browser' | 'create' | 'edit';
  documentEditor?: LibraryDocumentEditorState;
  isBroken?: boolean;
  isInSymlinkContext?: boolean;
  items: LibraryItemState[];
  lastKnownPath?: string | null;
  loadingFolderIds?: string[];
  panel: LibraryPanelState;
  selectedItemIds: string[];
  sortBy: 'name' | 'modified' | 'size' | 'kind';
  sortDirection: 'asc' | 'desc';
  symlinkInput?: {
    path: string;
    show: boolean;
  };
};
