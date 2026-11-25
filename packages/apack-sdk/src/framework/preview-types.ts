/** One item a content key holds, as the import dialog lists it */
export interface PackContentPreviewItem {
  /** What include sets name it by: a record's first identity field, a flow's name */
  key: string;
  description?: string;
  /** Tree records: how many children it has */
  childCount?: number;
}

/** What importing a compiled content directory would write: the keys it writes and their items, from its content.json */
export interface PackContentPreview {
  directory: string;
  /** The pack that compiled the content */
  packId: string;
  /** The keys the pack's registered appliers import */
  content: Record<string, PackContentPreviewItem[]>;
  /** Keys the pack registered no applier for: an import leaves them out */
  unavailable: string[];
}
