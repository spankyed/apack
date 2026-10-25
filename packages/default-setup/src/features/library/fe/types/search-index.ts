import type { EARS } from '@apackdev/sdk'

type ContentType = 'field' | 'list' | 'markdown' | 'text'


export interface SegmentRule {
  id: string
  type: ContentType
  occurrence: string // "first" | "last" | "all" | N | N-X
  key?: string // Only for 'field' type
  indexMode: 'combined' | 'separate' // For list and field types - how to index items
}

export interface SearchIndexConfig {
  // Details tab
  name: string
  description: string

  // Scope tab
  excludeAllSubfolders: boolean
  excludedFolderIds: EARS.EntityId[]
  excludedDocumentIds: EARS.EntityId[]

  // Sections tab
  enableSectionIndexing: boolean
  segmentRules: SegmentRule[]
  constructTemplate: string // e.g., "{{segment 1}}: {{segment 2}}"
}

export interface SearchIndexFormData extends SearchIndexConfig {
  id?: EARS.EntityId
  createdAt?: string
  updatedAt?: string
}