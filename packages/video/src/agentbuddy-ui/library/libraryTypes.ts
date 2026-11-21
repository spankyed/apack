export type LibraryItemType = 'document' | 'folder';

export type LibraryItemState = {
  children?: LibraryItemState[];
  expanded?: boolean;
  filePath?: string;
  id: string;
  isBroken?: boolean;
  isSymlink?: boolean;
  kind: string;
  name: string;
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
  isSymlink?: boolean;
  name: string;
  sections: LibraryContentSectionState[];
  tags: string[];
};

export type LibrarySurfaceState = {
  breadcrumbs: LibraryBreadcrumbState[];
  currentFolderId: string | null;
  items: LibraryItemState[];
  panel: LibraryPanelState;
  selectedItemIds: string[];
  sortBy: 'name' | 'modified' | 'size' | 'kind';
  sortDirection: 'asc' | 'desc';
};
