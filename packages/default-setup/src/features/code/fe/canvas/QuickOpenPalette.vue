<template>
  <Teleport to="body">
  <Transition name="quick-open">
    <div
      v-if="code.data.isQuickOpenVisible"
      class="fixed inset-0 z-[9999] flex items-start justify-center pt-12"
      :style="overlayStyle"
      @click.self="handleClose"
    >
      <!-- Palette -->
      <div class="relative w-full max-w-2xl mx-4">
        <div class="overflow-hidden border rounded-lg shadow-2xl bg-neutral-900 border-neutral-800">
          <!-- Search Input -->
          <div class="flex items-center px-4 py-3 border-b border-neutral-800">
            <Search class="flex-shrink-0 w-4 h-4 mr-3 text-neutral-500" />
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="text"
              placeholder="Search files by name..."
              class="flex-1 text-sm bg-transparent outline-none text-neutral-100 placeholder-neutral-500"
              @input="handleSearch"
              @keydown="handleKeydown"
            />
            <kbd class="px-2 py-1 ml-3 text-xs rounded bg-neutral-800 text-neutral-400">
              ESC
            </kbd>
          </div>
          
          <!-- Results -->
          <div
            v-if="code.data.quickOpenLoading"
            class="px-4 py-8 text-sm text-center text-neutral-500"
          >
            Loading files...
          </div>
          
          <div
            v-else-if="filteredResults.length === 0 && searchQuery"
            class="px-4 py-8 text-sm text-center text-neutral-500"
          >
            No files found matching "{{ searchQuery }}"
          </div>
          
          <div
            v-else-if="filteredResults.length > 0"
            ref="resultsContainer"
            class="overflow-y-auto max-h-96"
          >
            <div
              v-for="(result, index) in filteredResults"
              :key="result.item.path"
              :ref="el => setResultRef(el, index)"
              class="flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer"
              :class="{
                'bg-neutral-800': index === code.data.quickOpenSelectedIndex,
                'bg-neutral-700/50': index === hoveredIndex && index !== code.data.quickOpenSelectedIndex,
              }"
              @click="handleSelect(index)"
              @mouseenter="handleMouseEnter(index)"
              @mouseleave="handleMouseLeave"
              @mousemove="handleMouseMove"
            >
              <!-- File Icon -->
              <component
                :is="getFileIcon(result.item)"
                class="flex-shrink-0 w-4 h-4 text-neutral-500"
              />
              
              <!-- File Info -->
              <div class="flex-1 min-w-0 flex items-center gap-2">
                <div class="flex-1 min-w-0 flex items-baseline gap-2">
                  <!-- File Name with Highlighting -->
                  <span
                    class="text-sm truncate text-neutral-100"
                    v-html="highlightedName(result)"
                  />
                  
                  <!-- File Path -->
                  <span class="text-xs truncate text-neutral-500">
                    {{ getDirectory(result.item.relativePath) }}
                  </span>
                </div>
                
                <!-- Recent/Open Indicators -->
                <div class="flex items-center gap-1 flex-shrink-0">
                  <span
                    v-if="result.isOpen"
                    class="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded"
                  >
                    open
                  </span>
                  <span
                    v-else-if="result.isRecent"
                    class="px-1.5 py-0.5 text-xs bg-neutral-700 text-neutral-400 rounded flex items-center gap-1"
                  >
                    <Clock class="w-3 h-3" />
                    recent
                  </span>
                </div>
              </div>
              
              <!-- Score (for debugging, remove in production) -->
              <!-- <span class="text-xs text-neutral-600">
                {{ result.score.toFixed(2) }}
              </span> -->
            </div>
          </div>
          
          <div
            v-else
            class="px-4 py-8 text-sm text-center text-neutral-500"
          >
            Start typing to search files...
          </div>
          
          <!-- Footer -->
          <div class="flex items-center justify-between px-4 py-2 text-xs border-t border-neutral-800 text-neutral-500">
            <div class="flex items-center gap-4">
              <span class="flex items-center gap-1">
                <kbd class="px-1.5 py-0.5 bg-neutral-800 rounded">↑</kbd>
                <kbd class="px-1.5 py-0.5 bg-neutral-800 rounded">↓</kbd>
                Navigate
              </span>
              <span class="flex items-center gap-1">
                <kbd class="px-1.5 py-0.5 bg-neutral-800 rounded">↵</kbd>
                Open
              </span>
            </div>
            <span v-if="filteredResults.length > 0">
              {{ filteredResults.length }} results
            </span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useState, useSurface, useShell } from '@apackdev/sdk/fe'
import type { CodeState, QuickOpenResult } from '#features/code/fe/state.ts'
import { fuzzySearch, highlightMatches } from '#features/code/fe/utils/fuzzy-search.ts'
import { getRecencyScore } from '#features/code/fe/utils/recent-files.ts'
import { 
  Search, FileCode, FileText, FileJson, Image, 
  Video, FileArchive, FileType, Folder, Clock 
} from 'lucide-vue-next'

// Type for enhanced search results
interface EnhancedSearchResult {
  item: QuickOpenResult
  score: number
  positions: number[]
  matchRanges: Array<[number, number]>
  isRecent?: boolean
  isOpen?: boolean
}

// Get state
const shell = useShell()
const codeActor: CodeState = useSurface()

const { state: code, send } = useState(codeActor)
const panelSizes = shell.panelSizes

// Local state
const searchInput = ref<HTMLInputElement>()
const resultsContainer = ref<HTMLDivElement>()
const searchQuery = ref('')
const resultRefs = ref<(HTMLElement | null)[]>([])
const isKeyboardNavigation = ref(false)

const overlayStyle = computed(() => ({
  paddingLeft: '4.5rem', // toolbar width (--toolbar-width)
  paddingRight: `${panelSizes.value.inspectionWidth}px`,
}))
const hoveredIndex = ref(-1)

// Computed filtered results
const filteredResults = computed<EnhancedSearchResult[]>(() => {
  if (!searchQuery.value.trim()) {
    // When no query, show recent files first
    const openFilePaths = code.value.data.openFiles.map(f => f.path)
    
    // First, add currently open files ordered by recency
    const openFileResults: EnhancedSearchResult[] = []
    
    // Order open files by their position in recentlyOpenedFiles
    for (const recentPath of code.value.data.recentlyOpenedFiles) {
      if (openFilePaths.includes(recentPath)) {
        const fileItem = code.value.data.quickOpenResults.find(item => item.path === recentPath)
        if (fileItem) {
          openFileResults.push({
            item: fileItem,
            score: 20000 - openFileResults.length * 100, // Higher score for more recently opened
            positions: [],
            matchRanges: [],
            isOpen: true
          })
        }
      }
    }
    
    // Add any open files that aren't in recent files (shouldn't happen, but just in case)
    for (const openPath of openFilePaths) {
      if (!openFileResults.some(result => result.item.path === openPath)) {
        const fileItem = code.value.data.quickOpenResults.find(item => item.path === openPath)
        if (fileItem) {
          openFileResults.push({
            item: fileItem,
            score: 19000, // Lower score for open files not in recent list
            positions: [],
            matchRanges: [],
            isOpen: true
          })
        }
      }
    }
    
    // Then add recent files (excluding already open ones)
    const recentFileResults: EnhancedSearchResult[] = []
    let recentCount = 0
    
    // Go through recent files in order (they're already sorted by recency)
    for (const recentPath of code.value.data.recentlyOpenedFiles) {
      if (recentCount >= 10) break // Show max 10 recent files
      if (openFilePaths.includes(recentPath)) continue // Skip if already open
      
      const fileItem = code.value.data.quickOpenResults.find(item => item.path === recentPath)
      if (fileItem) {
        recentFileResults.push({
          item: fileItem,
          score: 10000 - recentCount * 100, // Higher score for more recent
          positions: [],
          matchRanges: [],
          isRecent: true
        })
        recentCount++
      }
    }
    
    // Finally, add other files
    const shownPaths = [...openFilePaths, ...code.value.data.recentlyOpenedFiles]
    const otherFileResults: EnhancedSearchResult[] = code.value.data.quickOpenResults
      .filter(item => !shownPaths.includes(item.path))
      .slice(0, 20)
      .map(item => ({
        item,
        score: 0,
        positions: [],
        matchRanges: []
      }))
    
    return [...openFileResults, ...recentFileResults, ...otherFileResults]
  }
  
  // Search with both full path and filename for better results
  const searchResults = fuzzySearch(
    searchQuery.value,
    code.value.data.quickOpenResults,
    (item) => item.relativePath,
    100, // Get more results initially
    (item) => item.name // Pass filename for exact match detection
  )
  
  // If we have exact filename matches, prioritize them heavily
  const query = searchQuery.value.toLowerCase()
  return searchResults
    .map(result => {
      let score = result.score
      
      // Extra boost for exact filename match
      if (result.item.name.toLowerCase() === query) {
        score += 10000
      }
      // Boost for filename starting with query
      else if (result.item.name.toLowerCase().startsWith(query)) {
        score += 5000
      }
      
      // Add recency score
      const recencyScore = getRecencyScore(code.value.data.recentlyOpenedFiles, result.item.path)
      score += recencyScore
      
      // Mark if it's a recent file
      const isRecent = code.value.data.recentlyOpenedFiles.includes(result.item.path)
      const isOpen = code.value.data.openFiles.some(f => f.path === result.item.path)
      
      return { 
        ...result, 
        score,
        isRecent,
        isOpen
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 50) // Return top 50
})

// Methods
const handleClose = () => {
  send({ type: 'HIDE_QUICK_OPEN' })
}

const handleSearch = () => {
  send({ 
    type: 'UPDATE_QUICK_OPEN_QUERY', 
    query: searchQuery.value 
  })
}

const handleSelect = (index: number) => {
  send({ type: 'SELECT_QUICK_OPEN_RESULT', index })
  const result = filteredResults.value[index]
  if (result && result.item.type === 'file') {
    send({ type: 'OPEN_QUICK_OPEN_RESULT', path: result.item.path })
  }
}

const handleKeydown = (e: KeyboardEvent) => {
  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      handleClose()
      break
      
    case 'ArrowDown':
      e.preventDefault()
      isKeyboardNavigation.value = true
      hoveredIndex.value = -1
      if (filteredResults.value.length > 0) {
        const newIndex = Math.min(code.value.data.quickOpenSelectedIndex + 1, filteredResults.value.length - 1)
        send({ type: 'SELECT_QUICK_OPEN_RESULT', index: newIndex })
        scrollToSelected(newIndex)
      }
      break
      
    case 'ArrowUp':
      e.preventDefault()
      isKeyboardNavigation.value = true
      hoveredIndex.value = -1
      if (filteredResults.value.length > 0) {
        const newIndex = Math.max(code.value.data.quickOpenSelectedIndex - 1, 0)
        send({ type: 'SELECT_QUICK_OPEN_RESULT', index: newIndex })
        scrollToSelected(newIndex)
      }
      break
      
    case 'Enter':
      e.preventDefault()
      if (filteredResults.value.length > 0) {
        handleSelect(code.value.data.quickOpenSelectedIndex)
      }
      break
  }
}

const scrollToSelected = (index: number) => {
  requestAnimationFrame(() => {
    const element = resultRefs.value[index]
    if (element && resultsContainer.value) {
      const container = resultsContainer.value
      const elementTop = element.offsetTop
      const elementBottom = elementTop + element.offsetHeight
      const containerTop = container.scrollTop
      const containerBottom = containerTop + container.clientHeight
      
      // If selecting first item, always scroll to top
      if (index === 0) {
        container.scrollTo({ top: 0, behavior: 'auto' })
      } else if (elementTop < containerTop) {
        // Scroll up to show the element at the top of the viewport
        container.scrollTo({ top: elementTop, behavior: 'auto' })
      } else if (elementBottom > containerBottom) {
        // Scroll down to show the element at the bottom of the viewport
        container.scrollTo({ top: elementBottom - container.clientHeight, behavior: 'auto' })
      }
    }
  })
}

const setResultRef = (el: any, index: number) => {
  resultRefs.value[index] = el
}

const getFileIcon = (file: QuickOpenResult) => {
  if (file.type === 'directory') return Folder
  
  const ext = file.extension?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'vue':
      return FileCode
    case 'json':
    case 'jsonc':
      return FileJson
    case 'md':
    case 'txt':
      return FileText
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return Image
    case 'mp4':
    case 'avi':
    case 'mov':
      return Video
    case 'zip':
    case 'tar':
    case 'gz':
      return FileArchive
    default:
      return FileType
  }
}

const getDirectory = (relativePath: string) => {
  const lastSlash = relativePath.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return relativePath.substring(0, lastSlash)
}

const handleMouseEnter = (index: number) => {
  hoveredIndex.value = index
  if (isKeyboardNavigation.value) {
    isKeyboardNavigation.value = false
  }
}

const handleMouseLeave = () => {
  hoveredIndex.value = -1
}

const handleMouseMove = () => {
  if (isKeyboardNavigation.value) {
    isKeyboardNavigation.value = false
  }
}

const highlightedName = (result: any) => {
  // Adjust match ranges to be relative to the filename, not the full path
  const pathPrefixLength = result.item.relativePath.length - result.item.name.length
  const adjustedRanges = result.matchRanges
    .map(([start, end]: [number, number]) => [
      Math.max(0, start - pathPrefixLength),
      Math.max(0, end - pathPrefixLength)
    ])
    .filter(([start, end]: [number, number]) => start < result.item.name.length)
    .map(([start, end]: [number, number]) => [
      start,
      Math.min(end, result.item.name.length)
    ])
  
  return highlightMatches(
    result.item.name,
    adjustedRanges,
    'text-blue-400 font-semibold'
  )
}

// Focus input when visible
watch(() => code.value.data.isQuickOpenVisible, (visible) => {
  if (visible) {
    searchQuery.value = ''
    hoveredIndex.value = -1
    isKeyboardNavigation.value = false
    nextTick(() => {
      searchInput.value?.focus()
    })
  }
})

// Reset selected index when results change
watch(filteredResults, () => {
  send({ type: 'SELECT_QUICK_OPEN_RESULT', index: 0 })
  resultRefs.value = []
  hoveredIndex.value = -1
})

// Global escape key handler
const handleGlobalKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && code.value.data.isQuickOpenVisible) {
    e.preventDefault()
    handleClose()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<style scoped>
/* Transition for smooth appearance */
.quick-open-enter-active,
.quick-open-leave-active {
  transition: opacity 0.15s ease;
}

.quick-open-enter-from,
.quick-open-leave-to {
  opacity: 0;
}

/* Custom scrollbar for results */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #525252;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #737373;
}
</style>