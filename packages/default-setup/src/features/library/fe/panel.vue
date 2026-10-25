<template>
  <div class="p-6 space-y-6 bg-neutral-900 h-full">
    <div>
      <h3 class="mb-3 text-sm font-semibold text-neutral-100">Library Stats</h3>
      <div class="space-y-2 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-neutral-400">Documents:</span>
          <span class="font-medium text-neutral-200">{{ index.documents.length }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-neutral-400">Folders:</span>
          <span class="font-medium text-neutral-200">{{ totalCollections }}</span>
        </div>
      </div>
    </div>

    <!-- Selected Items Details -->
    <div class="pt-6 border-t border-neutral-800">
      <h3 class="mb-3 text-sm font-semibold text-neutral-100">
        {{ selectedItemsCount > 1 ? `Selected Items (${selectedItemsCount})` : selectedFolder ? 'Selected Folder' : 'Selected Document' }}
      </h3>

      <!-- Single Document Selected -->
      <div v-if="selectedDocument" class="space-y-3">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-neutral-400">Name:</span>
            <span class="text-sm font-medium text-neutral-200">{{ selectedDocument.name }}</span>
          </div>
          <div v-if="selectedItemFullPath" class="flex items-start justify-between">
            <span class="text-xs text-neutral-400 flex-shrink-0">Path:</span>
            <span class="text-xs text-neutral-300 text-right break-all ml-2">{{ selectedItemFullPath }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-neutral-400">Code:</span>
            <span
              class="font-mono text-xs cursor-pointer transition-colors"
              :class="codeCopied ? 'text-green-400' : 'text-blue-400 hover:text-blue-300'"
              title="Click to copy"
              @click="copyShortCode"
            >{{ codeCopied ? 'Copied!' : (selectedDocument.shortCode ?? '') }}</span>
          </div>
        </div>

        <!-- Content Preview -->
        <div class="space-y-2">
          <h4 class="text-xs font-medium text-neutral-400">Content Preview:</h4>
          <div class="space-y-1.5">
            <div
              v-for="(section, index) in selectedDocument.content"
              :key="index"
              class="px-2 py-1.5 bg-neutral-800 rounded text-xs overflow-hidden line-clamp-2 break-all"
            >
              <template v-if="section.type === 'markdown'">
                <span class="text-neutral-300">{{ truncateText((section as MarkdownContent).text, 60) }}</span>
              </template>
              <template v-else-if="section.type === 'text'">
                <span class="text-neutral-300">{{ truncateText((section as TextContent).text, 60) }}</span>
              </template>
              <template v-else-if="section.type === 'field'">
                <span class="text-neutral-500">Fields ({{ countValidFields((section as FieldContent).fields) }}):</span>
                <span class="ml-1 text-neutral-300">{{ getFieldPreview((section as FieldContent).fields) }}</span>
              </template>
              <template v-else-if="section.type === 'list'">
                <span class="text-neutral-500">List ({{ countValidItems((section as ListContent).items) }} items)</span>
              </template>
            </div>
          </div>
        </div>

        <!-- Document Tags -->
        <div v-if="selectedDocument.tags.length > 0" class="space-y-2">
          <h4 class="text-xs font-medium text-neutral-400">Tags:</h4>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="tag in selectedDocument.tags"
              :key="tag"
              class="inline-flex items-center px-2 py-0.5 text-xs rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/30"
            >
              {{ tag }}
            </span>
          </div>
        </div>

        <!-- Dates -->
        <div class="space-y-2">
          <div v-if="selectedDocument.createdAt" class="flex items-center justify-between">
            <span class="text-xs text-neutral-400">Created:</span>
            <span class="text-xs text-neutral-300">{{ formatDate(selectedDocument.createdAt) }}</span>
          </div>
          <div v-if="selectedDocument.updatedAt" class="flex items-center justify-between">
            <span class="text-xs text-neutral-400">Modified:</span>
            <span class="text-xs text-neutral-300">{{ formatDate(selectedDocument.updatedAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Single Folder Selected -->
      <div v-else-if="selectedFolder" class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-neutral-400">Name:</span>
          <span class="text-sm font-medium text-neutral-200">{{ selectedFolder.name }}</span>
        </div>
        <div v-if="selectedItemFullPath" class="flex items-start justify-between">
          <span class="text-xs text-neutral-400 flex-shrink-0">Path:</span>
          <span class="text-xs text-neutral-300 text-right break-all ml-2">{{ selectedItemFullPath }}</span>
        </div>
      </div>

      <!-- Multiple Items Selected -->
      <div v-else-if="selectedItemsCount > 1" class="space-y-3">
        <div class="space-y-2 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-neutral-400">Documents:</span>
            <span class="font-medium text-neutral-200">{{ selectedDocumentsCount }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-neutral-400">Folders:</span>
            <span class="font-medium text-neutral-200">{{ selectedFoldersCount }}</span>
          </div>
        </div>

        <!-- Combined Tags from Selected Documents -->
        <div v-if="selectedItemsTags.length > 0" class="space-y-2">
          <h4 class="text-xs font-medium text-neutral-400">Combined Tags:</h4>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="tag in selectedItemsTags"
              :key="tag"
              class="inline-flex items-center px-2 py-0.5 text-xs rounded-md bg-purple-500/20 text-purple-400 border border-purple-500/30"
            >
              {{ tag }}
            </span>
          </div>
        </div>

        <div class="pt-2 text-xs text-neutral-500">
          Use bulk actions to manage multiple items at once
        </div>
      </div>

      <!-- Nothing Selected -->
      <div v-else class="text-sm text-neutral-500">
        Select items to view details
      </div>
    </div>

    <div class="pt-6 border-t border-neutral-800">
      <h3 class="mb-3 text-sm font-semibold text-neutral-100">All Tags</h3>
      <div v-if="sortedTags.length > 0" class="flex flex-wrap gap-2">
        <span
          v-for="tag in sortedTags"
          :key="tag"
          :class="getTagClass(tagCounts[tag])"
          class="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md"
        >
          {{ tag }} ({{ tagCounts[tag] }})
        </span>
      </div>
      <div v-else class="text-sm text-neutral-500">No tags yet</div>
    </div>

    <!-- [SEARCH_INDEX_FF] Search Indices section — commented out
    <div class="pt-6 border-t border-neutral-800">
      <h3 class="text-sm font-semibold text-neutral-100 mb-3">Search Indices</h3>
      <div v-if="searchIndices.length > 0" class="space-y-2">
        <div v-for="index in searchIndices" :key="index.id" class="p-3 bg-neutral-800 rounded-md">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-neutral-200">{{ index.name }}</span>
                <span class="text-xs text-neutral-500">•</span>
                <span class="text-xs text-neutral-400">
                  {{ index.documentCount }} {{ getIndexedItemsLabel(index) }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-1 ml-2">
              <button
                @click="send({ type: 'TEST_SEARCH_INDEX', indexId: index.id })"
                class="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                title="Test Search"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button
                @click="send({ type: 'EDIT_SEARCH_INDEX', indexId: index.id })"
                class="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 rounded transition-colors"
                title="Edit Index"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                @click="handleDeleteIndex(index.id, index.name)"
                class="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                title="Delete Index"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-sm text-neutral-500">
        No indices in current folder
      </div>
    </div>

    <teleport to="body">
      <div v-if="deleteConfirm.show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div class="bg-neutral-800 rounded-lg p-6 max-w-sm w-full mx-4">
          <h3 class="text-lg font-semibold text-neutral-100 mb-2">Delete Index</h3>
          <p class="text-sm text-neutral-400 mb-4">
            Are you sure you want to delete "{{ deleteConfirm.name }}"? This will permanently remove the index and all embeddings.
          </p>
          <div class="flex justify-end gap-2">
            <button
              @click="cancelDelete"
              class="px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
            <button
              @click="confirmDelete"
              class="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-500 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </teleport>
    -->
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed, ref } from 'vue'
import { useSelector } from '@xstate/vue'
import type { FieldContent, ListContent, MarkdownContent, TextContent } from '#features/library/be/types.ts'
import type { LibraryActor } from './state.ts'
import { useView } from '#generated/fe.ts'
// [SEARCH_INDEX_FF] import { getModelConfig } from '../embedding-models'

const actor = useSurface<LibraryActor>()

// Individual selectors for each context property
const indexView = useView('library', 'index')
const index = computed(() => indexView.data ?? { documents: [], folders: [] })
const selectedDocument = useSelector(actor, (state) => state.context.selectedDocument)
// [SEARCH_INDEX_FF] const searchIndices = useSelector(actor, (state) => state.context.searchIndices)
const items = useSelector(actor, (state) => state.context.items)
const selectedItems = useSelector(actor, (state) => state.context.selectedItems)
const expandedFolderChildren = useSelector(actor, (state) => state.context.expandedFolderChildren)

const allVisibleItems = computed(() => {
  const all = [...items.value]
  for (const children of Object.values(expandedFolderChildren.value)) {
    all.push(...children)
  }
  return all
})

const selectedFolder = computed(() => {
  if (selectedItems.value?.length !== 1) return null
  const item = allVisibleItems.value.find(i => i.id === selectedItems.value[0])
  return item?.type === 'folder' ? item : null
})

const selectedItemFullPath = computed(() => {
  const item = selectedDocument.value
    ? allVisibleItems.value.find(i => i.id === selectedDocument.value!.id)
    : selectedFolder.value
  if (!item) return null
  if ((item as any).filePath) return (item as any).filePath
  if ((item as any).symlinkPath) return (item as any).symlinkPath
  return null
})


const totalCollections = computed(() => {
  // Count folders in the current view (items array)
  return items.value.filter(item => item.type === 'folder').length
})

const allTags = computed(() => {
  const tags = new Set<string>()
  index.value.documents.forEach(doc => {
    doc.tags?.forEach(tag => tags.add(tag))
  })
  return Array.from(tags).sort()
})

const tagCounts = computed(() => {
  const counts: Record<string, number> = {}
  index.value.documents.forEach(doc => {
    doc.tags.forEach(tag => {
      counts[tag] = (counts[tag] || 0) + 1
    })
  })
  return counts
})

const sortedTags = computed(() => {
  return allTags.value.sort((a, b) => {
    const countDiff = tagCounts.value[b] - tagCounts.value[a]
    return countDiff !== 0 ? countDiff : a.localeCompare(b)
  })
})

// Multi-selection computed properties
const selectedItemsCount = computed(() => selectedItems.value?.length || 0)

const selectedDocumentsCount = computed(() => {
  return allVisibleItems.value.filter(item =>
    selectedItems.value.includes(item.id) && item.type === 'document'
  ).length
})

const selectedFoldersCount = computed(() => {
  return allVisibleItems.value.filter(item =>
    selectedItems.value.includes(item.id) && item.type === 'folder'
  ).length
})

const selectedItemsTags = computed(() => {
  const tags = new Set<string>()

  allVisibleItems.value
    .filter(item => selectedItems.value.includes(item.id) && item.type === 'document')
    .forEach((item: any) => {
      if (item.tags?.length) {
        item.tags.forEach((tag: string) => tags.add(tag))
      }
    })

  return Array.from(tags).sort()
})

function getTagClass(count: number): string {
  const counts = Object.values(tagCounts.value)
  if (counts.length === 0) {
    return 'bg-neutral-800 text-neutral-400 border border-neutral-700'
  }

  const maxCount = Math.max(...counts)
  if (maxCount === 0) {
    return 'bg-neutral-800 text-neutral-400 border border-neutral-700'
  }

  const percentage = (count / maxCount) * 100

  if (percentage >= 75) {
    return 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
  } else if (percentage >= 50) {
    return 'bg-neutral-700 text-neutral-300 border border-neutral-600'
  } else {
    return 'bg-neutral-800 text-neutral-400 border border-neutral-700'
  }
}


const codeCopied = ref(false)
const copyShortCode = () => {
  const code = selectedDocument.value?.shortCode
  if (code) {
    navigator.clipboard.writeText(code)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 1200)
  }
}

const truncateText = (text: string, maxLength: number): string =>
  text?.length > maxLength ? `${text.substring(0, maxLength)}...` : text || ''

const countValidFields = (fields: Array<{ key: string; value: string }>): number =>
  fields.filter(f => f.key.trim() || f.value.trim()).length

const countValidItems = (items: string[]): number =>
  items.filter(item => item.trim()).length

const getFieldPreview = (fields: Array<{ key: string; value: string }>): string => {
  const validFields = fields.filter(f => f.key.trim())
  if (!validFields.length) return 'No fields'
  const preview = validFields.slice(0, 2).map(f => f.key).join(', ')
  return validFields.length > 2 ? `${preview}, ...` : preview
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const isToday = date.toDateString() === now.toDateString()
  if (isToday) return `Today, ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`

  return `${date.toLocaleDateString()}, ${time}`
}

// [SEARCH_INDEX_FF] Search index panel functions — commented out
// function getModelLabel(modelId: string): string {
//   const config = getModelConfig(modelId)
//   if (config) {
//     return `${config.displayName} (${config.dimensions}d)`
//   }
//   // Fallback for unknown models
//   return modelId
// }
//
// function getIndexedItemsLabel(index: any): string {
//   // Check if this index uses multi-indexing (separate mode for lists/fields)
//   const hasMultiIndexing = index.enableSectionIndexing &&
//     index.segmentRules?.some((r: any) =>
//       (r.type === 'list' || r.type === 'field') && r.indexMode === 'separate'
//     )
//
//   if (hasMultiIndexing) {
//     return index.documentCount === 1 ? 'chunk' : 'chunks'
//   }
//   return index.documentCount === 1 ? 'document' : 'documents'
// }
//
// const deleteConfirm = ref({
//   show: false,
//   indexId: '',
//   name: ''
// })
//
// function handleDeleteIndex(indexId: string, name: string) {
//   deleteConfirm.value = {
//     show: true,
//     indexId,
//     name
//   }
// }
//
// function confirmDelete() {
//   if (deleteConfirm.value.indexId) {
//     send({ type: 'DELETE_SEARCH_INDEX', indexId: deleteConfirm.value.indexId })
//   }
//   cancelDelete()
// }
//
// function cancelDelete() {
//   deleteConfirm.value = {
//     show: false,
//     indexId: '',
//     name: ''
//   }
// }
</script>
