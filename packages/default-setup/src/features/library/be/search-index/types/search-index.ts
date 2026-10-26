import type { EARS } from '#generated/ears.ts'

export type Occurrence =
  | 'first'
  | 'last'
  | 'all'
  | { index: number }
  | { from: number; to: number }

export interface SegmentRule {
  id: string
  type: 'markdown' | 'text' | 'list' | 'field'  // markdown included: the library's compiler produces it
  occurrence: string // String representation of Occurrence
  key?: string // Only for 'field' type
  indexMode: 'combined' | 'separate' // For list and field types - how to index items
}

/**
 * What a search index holds and how it splits documents. Every index's chunks are embedded with the one model
 * `IndexedDoc`'s vector index names (default-setup's `apack.json`).
 */
export interface SearchIndexConfig {
  // Details
  name: string
  description: string

  // Scope
  excludeAllSubfolders: boolean
  excludedFolderIds: EARS.EntityId[]
  excludedDocumentIds: EARS.EntityId[]

  // Sections
  enableSectionIndexing: boolean
  segmentRules: SegmentRule[]
  constructTemplate: string
}

export interface SearchIndex extends SearchIndexConfig {
  id: EARS.EntityId
  folderId: EARS.EntityId | null // The folder this index belongs to
  documentCount: number // Number of indexed items (documents or chunks when using separate mode)
  createdAt: number
  updatedAt: number
}

export interface ChunkInfo {
  sourceDocId: EARS.EntityId
  segmentIndex: number  // Which segment rule this came from
  itemIndex?: number    // For separated lists/fields - which item
  chunkType: 'full' | 'segment-item' // Whether it's a full doc or segment item
  chunkKey: string      // Unique identifier for this chunk
}

export interface ChunkMetadata {
  shortCode: string
  name: string
  indexedAt: number
}

export interface IndexSearchResult {
  documentId: EARS.EntityId
  /** Similarity to the query, from 0 to 1, higher first */
  score: number
  text: string
  metadata: ChunkMetadata
  chunkInfo?: ChunkInfo // Optional chunk information for multi-indexed content
}

/** One chunk of one document in one index: an IndexedDoc row, whose `text` the vector index embeds */
export interface IndexedDocEntity {
  id: EARS.EntityId
  indexId: EARS.EntityId
  chunkKey: string
  documentId: EARS.EntityId
  text: string
  metadata: ChunkMetadata
  chunkInfo: ChunkInfo | null
}
