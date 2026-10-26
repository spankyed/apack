// The dormant library search index on the engine's vector index: indexing a folder files one IndexedDoc row per chunk,
// pending until embedIndexedDocs embeds them with IndexedDoc's model; a search embeds its query with that model and
// ranks the index's chunks; an edited document's chunk is pending again until it is embedded. How the engine ranks
// is the engine's (apack-ears/tests/engine/vector.spec.ts); this holds the index to filing what its rules make.
import { describe, expect, it } from 'vitest'
import { mockInference, startApp } from '@apackdev/testing/harness'
import { boundEars } from '@apackdev/sdk/ears'
import { repository } from '#generated/repository.ts'
import type { EARS } from '#generated/ears.ts'
import {
  createSearchIndex, embedIndexedDocs, indexDocument, searchInIndex, updateSearchIndex,
} from '#features/library/be/search-index/repository.ts'
import type { SearchIndexConfig } from '#features/library/be/search-index/types/search-index.ts'

/** What IndexedDoc's vector index (its manifest entry's `embed`) embeds with */
const vectorIndex = () => boundEars().pendingEmbeddings('IndexedDoc', { limit: 0 })

/** A text's meaning: one axis per word the corpus is about, in IndexedDoc's dimensions */
const AXES = ['apple', 'boat', 'star']
function meaning(text: string): number[] {
  const vector = Array.from({ length: vectorIndex().dims }, (): number => 0)
  AXES.forEach((word, axis) => { if (text.toLowerCase().includes(word)) vector[axis] = 1 })
  if (!vector.includes(1)) vector[AXES.length] = 1
  return vector
}

const markdown = (text: string) => [{ type: 'markdown' as const, text }]

const config = (overrides: Partial<SearchIndexConfig> = {}): SearchIndexConfig => ({
  name: 'Notes', description: '',
  excludeAllSubfolders: false, excludedFolderIds: [], excludedDocumentIds: [],
  enableSectionIndexing: false, segmentRules: [], constructTemplate: '{{segment 1}}',
  ...overrides,
})

const pendingTexts = () => boundEars().pendingEmbeddings('IndexedDoc').chunks.map(({ text }) => text).sort()

async function library() {
  await startApp({ systems: [] })
  const inference = mockInference('', { embedding: meaning })
  const { libraryCommands } = repository
  const folder = libraryCommands.createCollection('Reading')
  const sub = libraryCommands.createCollection('Sub', undefined, folder.id as EARS.EntityId)
  const apples = libraryCommands.createDocument('Apples', markdown('An apple a day'), [], folder.id as EARS.EntityId)
  const boats = libraryCommands.createDocument('Boats', markdown('A boat on the sea'), [], sub.id as EARS.EntityId)
  const outside = libraryCommands.createDocument('Stars', markdown('A star at night'), [])
  return { inference, folder, sub, apples, boats, outside }
}

describe('the library search index', () => {
  it('indexes a folder\'s documents and its subfolders\', pending until embedded, then searches them', async () => {
    const { inference, folder, apples, boats } = await library()
    const index = createSearchIndex(config(), folder.id as EARS.EntityId)
    expect(index.documentCount).toBe(2)
    expect(pendingTexts()).toEqual(['A boat on the sea', 'An apple a day'])
    expect(await searchInIndex(index.id, 'apple')).toEqual([])

    expect(await embedIndexedDocs()).toEqual({ stored: 2, stale: 0 })
    // How the AI SDK batches the calls is its own; each is to the index's model
    const { model } = vectorIndex()
    const models = () => new Set(inference.calls.filter((call) => call.kind === 'embedding').map((call) => call.model))
    expect(models()).toEqual(new Set([model]))
    const found = await searchInIndex(index.id, 'an apple please', 1)
    expect(models()).toEqual(new Set([model]))
    expect(found).toEqual([{
      documentId: apples.id, score: expect.any(Number), text: 'An apple a day',
      metadata: { shortCode: apples.shortCode, name: 'Apples', indexedAt: expect.any(Number) },
    }])
    expect((await searchInIndex(index.id, 'boat')).map((result) => result.documentId)).toEqual([boats.id, apples.id])
  })

  it('leaves out excluded subfolders and documents outside the folder', async () => {
    const { folder, sub, apples } = await library()
    const index = createSearchIndex(config({ excludedFolderIds: [sub.id as EARS.EntityId] }), folder.id as EARS.EntityId)
    await embedIndexedDocs()
    expect((await searchInIndex(index.id, 'star')).map((result) => result.documentId)).toEqual([apples.id])
  })

  it('holds an edited document\'s chunk pending, and finds it by its new text once embedded', async () => {
    const { folder, apples, boats } = await library()
    const index = createSearchIndex(config(), folder.id as EARS.EntityId)
    await embedIndexedDocs()

    repository.libraryCommands.updateDocument(apples.id as EARS.EntityId, 'Apples', markdown('A star in the sky'), [])
    indexDocument(apples.id as EARS.EntityId, index.id)
    expect(pendingTexts()).toEqual(['A star in the sky'])
    expect((await searchInIndex(index.id, 'star')).map((result) => result.documentId)).toEqual([boats.id])

    expect(await embedIndexedDocs()).toEqual({ stored: 1, stale: 0 })
    expect((await searchInIndex(index.id, 'star', 1)).map((result) => result.documentId)).toEqual([apples.id])
  })

  it('splits a list into a chunk per item under a separate rule', async () => {
    const { folder, apples } = await library()
    repository.libraryCommands.updateDocument(apples.id as EARS.EntityId, 'Apples', [{ type: 'list', items: ['apple pie', 'boat trip'] }], [])
    const index = createSearchIndex(config(), folder.id as EARS.EntityId)
    await embedIndexedDocs()

    updateSearchIndex(index.id, config({
      enableSectionIndexing: true,
      segmentRules: [{ id: 'r', type: 'list', occurrence: 'all', indexMode: 'separate' }],
    }))
    // Each item is a chunk of its own; the boat document holds no list, so the rule leaves it no text to embed
    expect(pendingTexts()).toEqual(['apple pie', 'boat trip'])
    await embedIndexedDocs()
    const found = await searchInIndex(index.id, 'boat')
    expect(found.map((result) => [result.text, result.chunkInfo?.itemIndex])).toEqual([['boat trip', 1], ['apple pie', 0]])
  })
})
