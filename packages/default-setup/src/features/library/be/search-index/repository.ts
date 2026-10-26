// A search index is a SearchIndex row naming a folder and how its documents are split, and one IndexedDoc row per
// chunk of each document in scope. The vectors are the engine's: IndexedDoc's vector index (`embed` in apack.json)
// embeds each row's `text`, keeping a chunk whose text changed pending until `embedIndexedDocs` embeds it again, so
// indexing writes rows and nothing else, and a search ranks the index's rows by `near`.
import { query, create, write, EARS } from '#generated/ears.ts'
import { embedPending, embedSearchText, type EmbedPendingResult } from '@apackdev/sdk/services'
import type { SearchIndex, SearchIndexConfig, IndexSearchResult, ChunkInfo, IndexedDocEntity } from './types/search-index.ts'
import type { DocumentDTO } from '../types.ts'
import { processDocumentContent, processDocumentContentMultiIndex } from './chunks.ts'
import { libraryQueries } from '../repository/index.ts'

/** What one chunk of a document holds before it is filed */
interface Chunk {
  key: string
  text: string
  chunkInfo: ChunkInfo | null
}

const indexedDocs = (indexId: EARS.EntityId) => query(EARS.Entity.IndexedDoc).where('indexId', indexId)

function findIndexedDoc(indexId: EARS.EntityId, chunkKey: string): IndexedDocEntity | undefined {
  return indexedDocs(indexId).where('chunkKey', chunkKey).pickOne() as unknown as IndexedDocEntity | undefined
}

/** The chunks a document makes under an index's rules: the whole document, or one per item of a `separate` rule */
function chunksOf(doc: DocumentDTO, searchIndex: SearchIndexConfig): Chunk[] {
  const separates = searchIndex.enableSectionIndexing &&
    searchIndex.segmentRules.some(r => (r.type === 'list' || r.type === 'field') && r.indexMode === 'separate')
  if (!separates) return [{ key: doc.id, text: processDocumentContent(doc.content, searchIndex), chunkInfo: null }]
  return processDocumentContentMultiIndex(doc.content, searchIndex).map(({ text, segmentIndex, itemIndex }) => {
    const key = itemIndex !== undefined ? `${doc.id}-seg${segmentIndex}-item${itemIndex}` : `${doc.id}-seg${segmentIndex}`
    return {
      key,
      text,
      chunkInfo: {
        sourceDocId: doc.id as EARS.EntityId,
        segmentIndex,
        itemIndex,
        chunkType: itemIndex !== undefined ? 'segment-item' : 'full',
        chunkKey: key,
      },
    }
  })
}

/**
 * Files a document's chunks in an index as its rules make them now: a chunk whose text is unchanged keeps its
 * embedding, a changed or new one is pending, and one the document no longer makes is removed
 */
function fileDocument(doc: DocumentDTO, searchIndex: SearchIndex): void {
  const indexedAt = Date.now()
  const chunks = chunksOf(doc, searchIndex)
  const kept = new Set(chunks.map(({ key }) => key))
  for (const row of indexedDocs(searchIndex.id).where('documentId', doc.id).pickAll() as unknown as IndexedDocEntity[]) {
    if (!kept.has(row.chunkKey)) write(row.id).destroy()
  }
  for (const { key, text, chunkInfo } of chunks) {
    const fields = { documentId: doc.id as EARS.EntityId, text, metadata: { shortCode: doc.shortCode, name: doc.name, indexedAt }, chunkInfo }
    const existing = findIndexedDoc(searchIndex.id, key)
    if (existing) write(existing.id).setMany(fields)
    else create(EARS.Entity.IndexedDoc, { indexId: searchIndex.id, chunkKey: key, ...fields })
  }
}

function removeDocumentChunks(documentId: EARS.EntityId, indexId: EARS.EntityId): void {
  for (const id of indexedDocs(indexId).where('documentId', documentId).ids()) write(id).destroy()
}

function countChunks(indexId: EARS.EntityId): void {
  write(indexId).set('documentCount', indexedDocs(indexId).count())
}

/** Embeds every chunk the index rows hold pending, with the model IndexedDoc's vector index names */
export function embedIndexedDocs(): Promise<EmbedPendingResult> {
  return embedPending({ types: [EARS.Entity.IndexedDoc] })
}

export function createSearchIndex(config: SearchIndexConfig, folderId: EARS.EntityId | null): SearchIndex {
  const now = Date.now()
  const indexId = create(EARS.Entity.SearchIndex, { ...config, folderId, documentCount: 0, createdAt: now }).id()
  indexDocumentsInFolder(indexId, folderId)
  return findSearchIndex(indexId)!
}

export function findSearchIndex(indexId: EARS.EntityId): SearchIndex | null {
  return (query.ids(indexId).ofType(EARS.Entity.SearchIndex).pickOne() as unknown as SearchIndex | undefined) ?? null
}

export function getSearchIndicesForFolder(folderId: EARS.EntityId | null): SearchIndex[] {
  return query(EARS.Entity.SearchIndex).where('folderId', folderId).pickAll() as unknown as SearchIndex[]
}

/** Changes an index's details and rules; changed rules refile every document, keeping each chunk whose text is unchanged */
export function updateSearchIndex(indexId: EARS.EntityId, config: SearchIndexConfig): SearchIndex {
  const existing = findSearchIndex(indexId)
  if (!existing) throw new Error(`Search index ${indexId} not found`)
  write(indexId).setMany({ ...config })
  const rulesChanged = JSON.stringify(existing.segmentRules) !== JSON.stringify(config.segmentRules) ||
    existing.constructTemplate !== config.constructTemplate ||
    existing.enableSectionIndexing !== config.enableSectionIndexing
  const scopeChanged = existing.excludeAllSubfolders !== config.excludeAllSubfolders ||
    JSON.stringify(existing.excludedFolderIds) !== JSON.stringify(config.excludedFolderIds) ||
    JSON.stringify(existing.excludedDocumentIds) !== JSON.stringify(config.excludedDocumentIds)
  if (rulesChanged || scopeChanged) indexDocumentsInFolder(indexId, existing.folderId)
  return findSearchIndex(indexId)!
}

export function deleteSearchIndex(indexId: EARS.EntityId): void {
  for (const id of indexedDocs(indexId).ids()) write(id).destroy()
  write(indexId).destroy()
}

/** Files every document in the index's scope, and removes the chunks of documents no longer in it */
export function indexDocumentsInFolder(indexId: EARS.EntityId, folderId: EARS.EntityId | null): void {
  const searchIndex = findSearchIndex(indexId)
  if (!searchIndex) throw new Error(`Search index ${indexId} not found`)
  const documents = getDocumentsToIndex(folderId, searchIndex)
  const inScope = new Set(documents.map(({ id }) => id))
  const filed = new Set(indexedDocs(indexId).pickAll().map((row) => (row as unknown as IndexedDocEntity).documentId))
  for (const documentId of filed) if (!inScope.has(documentId)) removeDocumentChunks(documentId, indexId)
  for (const document of documents) fileDocument(document, searchIndex)
  countChunks(indexId)
}

export function indexDocument(documentId: EARS.EntityId, indexId: EARS.EntityId): void {
  const searchIndex = findSearchIndex(indexId)
  if (!searchIndex) throw new Error(`Search index ${indexId} not found`)
  const document = libraryQueries.findDocument(documentId)
  if (!document) throw new Error(`Document ${documentId} not found`)
  if (searchIndex.excludedDocumentIds.includes(documentId)) return
  fileDocument(document, searchIndex)
  countChunks(indexId)
}

export function removeDocumentFromIndex(documentId: EARS.EntityId, indexId: EARS.EntityId): void {
  if (!findSearchIndex(indexId)) return
  removeDocumentChunks(documentId, indexId)
  countChunks(indexId)
}

/**
 * The index's chunks nearest `text`, most similar first. A chunk still pending (`embedIndexedDocs`) isn't among them
 */
export async function searchInIndex(indexId: EARS.EntityId, text: string, limit = 10): Promise<IndexSearchResult[]> {
  if (!findSearchIndex(indexId)) throw new Error(`Search index ${indexId} not found`)
  const vector = await embedSearchText(EARS.Entity.IndexedDoc, text)
  return indexedDocs(indexId).near(vector, { k: limit }).hits({ fields: ['documentId', 'text', 'metadata', 'chunkInfo'] as never })
    .map(({ score, row }) => {
      const { documentId, text: chunkText, metadata, chunkInfo } = row as unknown as IndexedDocEntity
      return { documentId, score, text: chunkText, metadata, ...(chunkInfo && { chunkInfo }) }
    })
}

function getDocumentsToIndex(folderId: EARS.EntityId | null, searchIndex: SearchIndex): DocumentDTO[] {
  let documents: DocumentDTO[]
  if (folderId === null) {
    // Root folder - get all documents not in any collection
    documents = libraryQueries.getDocuments().filter(doc => !doc.collectionId)
  } else {
    documents = libraryQueries.getDocumentsInCollection(folderId)
    if (!searchIndex.excludeAllSubfolders) {
      for (const childId of getChildCollectionsRecursive(folderId)) {
        if (!searchIndex.excludedFolderIds.includes(childId)) {
          documents = documents.concat(libraryQueries.getDocumentsInCollection(childId))
        }
      }
    }
  }
  return documents.filter(doc => !searchIndex.excludedDocumentIds.includes(doc.id as EARS.EntityId))
}

function getChildCollectionsRecursive(collectionId: EARS.EntityId): EARS.EntityId[] {
  return query.ids(collectionId).descendants(EARS.RelKind.PARENT_OF, EARS.Entity.Collection).ids()
}

/** Whether a document is in the index's scope: its folder, or a subfolder the index doesn't exclude */
function inScope(document: DocumentDTO, searchIndex: SearchIndex): boolean {
  if (searchIndex.folderId === null) return !document.collectionId
  if (document.collectionId === searchIndex.folderId) return true
  if (searchIndex.excludeAllSubfolders || !document.collectionId) return false
  const collectionId = document.collectionId as EARS.EntityId
  return getChildCollectionsRecursive(searchIndex.folderId).includes(collectionId) && !searchIndex.excludedFolderIds.includes(collectionId)
}

/** Files a document in every index whose scope holds it */
export function autoIndexNewDocument(documentId: EARS.EntityId): void {
  const document = libraryQueries.findDocument(documentId)
  if (!document) return
  for (const searchIndex of query(EARS.Entity.SearchIndex).pickAll() as unknown as SearchIndex[]) {
    if (inScope(document, searchIndex)) indexDocument(documentId, searchIndex.id)
  }
}

/** Removes a deleted document from every index */
export function removeDocumentFromAllIndices(documentId: EARS.EntityId): void {
  for (const id of query(EARS.Entity.SearchIndex).ids()) removeDocumentFromIndex(documentId, id)
}

/** Deletes every index of a folder that was deleted */
export function deleteSearchIndicesForFolder(folderId: EARS.EntityId): void {
  for (const index of getSearchIndicesForFolder(folderId)) deleteSearchIndex(index.id)
}
