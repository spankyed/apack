<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <!-- Header -->
    <div class="flex items-center justify-between gap-4 px-6 py-4 border-b border-neutral-800">
      <div>
        <h2 class="text-lg font-semibold text-neutral-100">
          Search Query
        </h2>
        <p class="text-sm text-neutral-500">Search index to see how it performs</p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          @click="cancel"
          variant="transparent"
        >
          Back
        </Button>
        <Button
          @click="executeSearch"
          :disabled="!localQuery || isSearching"
          variant="primary"
        >
          <span v-if="!isSearching">Search</span>
          <span v-else>Searching...</span>
        </Button>
      </div>
    </div>

    <!-- Search Input Section -->
    <div class="bg-neutral-850 border-b border-neutral-800">
      <div class="max-w-3xl mx-auto px-6 py-4">
        <textarea
          v-model="localQuery"
          @keydown.enter="handleEnterKey"
          placeholder="Enter your search query..."
          class="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-md text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none overflow-y-auto"
          style="field-sizing: content; max-height: 5lh;"
          :disabled="isSearching"
        />
      </div>
    </div>

    <!-- Results Section -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-4xl mx-auto p-4">
        <!-- Empty State -->
        <div v-if="testResults.length === 0 && !isSearching" class="text-center py-16 text-neutral-500">
          <Search class="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Enter a query and click search to test this index</p>
        </div>

        <!-- Loading State -->
        <div v-else-if="isSearching" class="flex items-center justify-center py-16">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>

        <!-- Results -->
        <div v-else-if="testResults.length > 0" class="space-y-4">
          <!-- Results Summary -->
          <div class="flex items-center justify-between text-sm text-neutral-400 pb-2 mb-4">
            <span>Found {{ testResults.length }} {{ testResults.length === 1 ? 'chunk' : 'chunks' }} across {{ uniqueDocumentCount }} {{ uniqueDocumentCount === 1 ? 'document' : 'documents' }}</span>
            <div class="flex items-center gap-2">
              <button
                @click="expandAll"
                class="px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
              >
                Expand All
              </button>
              <button
                @click="collapseAll"
                class="px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
              >
                Collapse All
              </button>
            </div>
          </div>

          <!-- Grouped Results by Document -->
          <div v-for="[docId, chunks] of groupedResults" :key="docId" class="mb-4 border border-neutral-700 rounded-lg overflow-hidden">
            <!-- Document Header -->
            <div
              @click="toggleDocumentExpansion(docId as string)"
              class="px-4 py-3 bg-neutral-850 border-b border-neutral-700 cursor-pointer hover:bg-neutral-800 transition-colors"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <ChevronRight
                    class="w-4 h-4 text-neutral-500 transition-transform"
                    :class="{ 'rotate-90': expandedDocuments.has(docId as string) }"
                  />
                  <FileText class="w-4 h-4 text-neutral-500" />
                  <h4 class="text-sm font-medium text-neutral-200">
                    {{ chunks[0].metadata?.name || `Document ${docId}` }}
                    <span class="text-xs text-neutral-500 ml-2">
                      {{ chunks[0].metadata?.shortCode || docId }}
                    </span>
                  </h4>
                </div>
                <div class="text-xs text-neutral-400">
                  <span v-if="chunks.length === 1 && (!chunks[0].chunkInfo || chunks[0].chunkInfo.chunkType === 'full')">
                    Document
                  </span>
                  <span v-else>
                    {{ chunks.length }} {{ chunks.length === 1 ? 'chunk' : 'chunks' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Document Chunks -->
            <div v-if="expandedDocuments.has(docId as string)" class="divide-y divide-neutral-700/50">
              <div
                v-for="(result, index) in chunks"
                :key="`${docId}-${index}`"
                class="p-4 hover:bg-neutral-850 transition-colors cursor-pointer relative"
                @click="toggleChunkExpansion(result, index)"
              >
                <!-- Copy Button at top right -->
                <button
                  @click.stop="copyText(result.text)"
                  class="absolute top-4 right-4 p-1 text-neutral-500 hover:text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors z-10"
                  title="Copy chunk text"
                >
                  <Copy class="w-3 h-3" />
                </button>

                <!-- Chunk Header -->
                <div class="flex items-center justify-between gap-2 mb-2">
                  <div class="flex items-center gap-2 pl-3">
                    <!-- Segment Info -->
                    <span v-if="result.chunkInfo" class="text-xs text-neutral-500">
                      Segment {{ result.chunkInfo.segmentIndex + 1 }}
                    </span>

                    <!-- Chunk/Document Type Badge (Clickable to copy ID) -->
                    <button
                      @click.stop="copyResultKey(result)"
                      class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded cursor-pointer hover:opacity-80 transition-opacity"
                      :class="getChunkTypeBadgeClass(result.chunkInfo)"
                      :title="getResultKeyTooltip(result)"
                    >
                      <Hash class="w-3 h-3 mr-1" />
                      {{ getItemLabel(result.chunkInfo) }}
                    </button>

                    <!-- Score Badge -->
                    <span
                      class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded"
                      :class="getScoreBadgeClass(result.score)"
                    >
                      {{ getSimilarityPercentage(result.score) }}%
                    </span>
                  </div>
                </div>

                <!-- Text Content and Footer -->
                <div
                  class="bg-neutral-900 rounded p-3 pb-0 relative"
                >
                  <div class="text-sm text-neutral-300 font-mono">
                    <div v-if="expandedChunks.has(getChunkId(result, index))">
                      <pre class="whitespace-pre-wrap break-words">{{ result.text }}</pre>
                    </div>
                    <div v-else class="relative text-sm text-neutral-300 font-mono">
                      <div class="line-clamp-3-custom" :ref="el => setTextRef(el, result, index)">
                        {{ result.text }}
                      </div>
                      <div v-if="isTruncated(result, index)" class="absolute bottom-0 right-0 flex items-center pointer-events-none">
                        <div class="w-16 h-6 bg-gradient-to-r from-transparent to-neutral-900"></div>
                        <span class="text-neutral-300 bg-neutral-900 pr-1">...more</span>
                      </div>
                    </div>
                  </div>

                  <!-- Footer with Metadata (only show when expanded) -->
                  <div v-if="expandedChunks.has(getChunkId(result, index))" class="mt-3 pt-3 border-t border-neutral-800">
                    <div class="flex items-center justify-between text-xs text-neutral-500">
                      <div class="flex items-center gap-3">
                        <span>Similarity: {{ result.score.toFixed(4) }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span>{{ result.text.length }} chars</span>
                        <span v-if="result.metadata?.indexedAt" class="flex items-center gap-2">
                          <span class="text-neutral-700">•</span>
                          <span>Indexed: {{ formatDate(result.metadata.indexedAt) }}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Copy Feedback Toast -->
    <Transition name="fade">
      <div v-if="showCopyFeedback" class="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
        {{ copyFeedbackMessage }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { ref, computed, watch, nextTick, type Ref, type ComponentPublicInstance } from 'vue'
import { useSelector } from '@xstate/vue'
import { type LibraryEvents } from '../../state.ts'
import { FileText, Search, Hash, Copy, ChevronRight } from 'lucide-vue-next'
import Button from '@apackdev/ui/design/button'
import type { IndexSearchResult } from '#generated/types.ts'
import type { LibraryActor } from '../../state.ts'

const actor = useSurface<LibraryActor>()

const testQuery = useSelector(actor, (state) => state.context.testQuery) as Ref<string>
const testResults = useSelector(actor, (state) => state.context.testResults) as Ref<IndexSearchResult[]>
const isSearching = useSelector(actor, (state) => state.context.isSearching) as Ref<boolean>

const send = (event: LibraryEvents) => actor.send(event)

const localQuery = ref('')
const expandedChunks = ref(new Set<string>())
const expandedDocuments = ref(new Set<string>())
const showCopyFeedback = ref(false)
const copyFeedbackMessage = ref('')
const truncatedTexts = ref(new Map<string, boolean>())

// Computed properties
const groupedResults = computed(() => {
  const grouped = new Map<string, IndexSearchResult[]>()

  // Group results by document
  testResults.value.forEach((result: IndexSearchResult) => {
    const chunks = grouped.get(result.documentId) || []
    chunks.push(result)
    grouped.set(result.documentId, chunks)
  })

  // Sort chunks within each document and documents by best score
  return new Map(
    Array.from(grouped.entries())
      .map(([docId, chunks]): [string, IndexSearchResult[]] =>
        [docId, chunks.sort((a, b) => a.score - b.score)])
      .sort((a, b) => a[1][0].score - b[1][0].score)
  )
})

const uniqueDocumentCount = computed(() => groupedResults.value.size)

// Sync with state machine
watch(testQuery, (newVal) => localQuery.value = newVal)
watch(localQuery, (newVal) => send({ type: 'UPDATE_TEST_QUERY', query: newVal }))

const handleEnterKey = (event: KeyboardEvent) => {
  if (!event.shiftKey) {
    event.preventDefault()
    executeSearch()
  }
}

const executeSearch = () => {
  if (localQuery.value && !isSearching.value) {
    expandedChunks.value.clear()
    expandedDocuments.value.clear()
    send({ type: 'EXECUTE_TEST_SEARCH' })
  }
}

// Auto-expand documents when results come in
watch(testResults, (newResults) => {
  if (newResults.length > 0) {
    truncatedTexts.value.clear() // Clear truncation tracking for new results
    groupedResults.value.forEach((_, docId) => expandedDocuments.value.add(docId))
  }
})

const cancel = () => send({ type: 'CANCEL_TEST_SEARCH' })

const getChunkId = (result: IndexSearchResult, index: number): string => `${result.documentId}-${index}`

const toggleExpansion = (set: Set<string>, id: string) => {
  set.has(id) ? set.delete(id) : set.add(id)
}

const toggleChunkExpansion = (result: IndexSearchResult, index: number) =>
  toggleExpansion(expandedChunks.value, getChunkId(result, index))

const toggleDocumentExpansion = (docId: string) =>
  toggleExpansion(expandedDocuments.value, docId)

const expandAll = () => {
  groupedResults.value.forEach((chunks, docId) => {
    expandedDocuments.value.add(docId)
    chunks.forEach((chunk, index) =>
      expandedChunks.value.add(getChunkId(chunk, index))
    )
  })
}

const collapseAll = () => {
  expandedChunks.value.clear()
  expandedDocuments.value.clear()
}

// A result's score is its similarity, from 0 to 1
const getSimilarityPercentage = (score: number): string => Math.max(0, Math.min(100, score * 100)).toFixed(1)

const getScoreBadgeClass = (score: number): string => {
  const percentage = parseFloat(getSimilarityPercentage(score))

  // Color gradient from red to green based on percentage, with platinum for perfect matches
  if (percentage >= 100) return 'bg-gradient-to-r from-white/40 via-slate-100/50 to-white/40 text-white font-semibold border border-white/60 ring-1 ring-white/30 shadow-lg shadow-white/25'
  if (percentage >= 90) return 'bg-green-500/20 text-green-400 border border-green-500/30'
  if (percentage >= 80) return 'bg-green-500/15 text-green-400 border border-green-500/25'
  if (percentage >= 70) return 'bg-lime-500/20 text-lime-400 border border-lime-500/30'
  if (percentage >= 60) return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
  if (percentage >= 50) return 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
  if (percentage >= 40) return 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
  if (percentage >= 30) return 'bg-orange-600/20 text-orange-500 border border-orange-600/30'
  if (percentage >= 20) return 'bg-red-500/15 text-red-400 border border-red-500/25'
  return 'bg-red-500/20 text-red-400 border border-red-500/30'
}


const getChunkTypeBadgeClass = (chunkInfo: IndexSearchResult['chunkInfo']): string => {
  if (!chunkInfo) return 'bg-neutral-700 text-neutral-400'
  return chunkInfo.chunkType === 'full'
    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
    : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
}

const getItemLabel = (chunkInfo: IndexSearchResult['chunkInfo']): string => {
  if (!chunkInfo) return 'Document'
  if (chunkInfo.chunkType === 'full') return 'Full Document'
  return chunkInfo.itemIndex !== undefined
    ? `Item ${chunkInfo.itemIndex + 1}`
    : 'Segment'
}


const formatDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

async function copyToClipboard(text: string, message: string = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text)
    showCopyFeedback.value = true
    copyFeedbackMessage.value = message
    setTimeout(() => showCopyFeedback.value = false, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

const copyText = (text: string) => copyToClipboard(text, 'Text copied to clipboard')

const copyResultKey = (result: IndexSearchResult) => {
  const key = result.chunkInfo?.chunkKey || result.documentId
  const message = result.chunkInfo ? 'Chunk key copied' : 'Document ID copied'
  copyToClipboard(key, message)
}

const getResultKeyTooltip = (result: IndexSearchResult): string => {
  if (result.chunkInfo?.chunkKey) {
    return `Copy chunk ID: ${result.chunkInfo.chunkKey}`
  }
  return `Copy document ID: ${result.documentId}`
}

// Check if text is truncated
const setTextRef = (el: Element | ComponentPublicInstance | null, result: IndexSearchResult, index: number) => {
  if (el && el instanceof HTMLElement) {
    nextTick(() => {
      // Check if the element's scroll height is greater than its client height
      const isTruncated = el.scrollHeight > el.clientHeight
      truncatedTexts.value.set(getChunkId(result, index), isTruncated)
    })
  }
}

const isTruncated = (result: IndexSearchResult, index: number): boolean => {
  return truncatedTexts.value.get(getChunkId(result, index)) || false
}
</script>

<style scoped>
.line-clamp-3-custom {
  max-height: 4.5em; /* Approximately 3 lines */
  overflow: hidden;
  word-break: break-word;
  line-height: 1.5em;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
