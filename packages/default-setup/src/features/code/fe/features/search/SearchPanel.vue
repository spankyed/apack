<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <CodePanelHeader
      :icon="Search"
      title="Search"
    >
    </CodePanelHeader>

    <!-- Show only error if no directory selected -->
    <NoDirectoryState v-if="!baseDirectory" />

    <!-- Show normal UI only when directory is selected -->
    <template v-else>
      <!-- Search Input Section -->
      <div class="p-4 border-b border-neutral-800 bg-neutral-800/50">
      <!-- Search Input with Inline Filters -->
      <div class="flex items-stretch mb-3 overflow-hidden border rounded bg-neutral-900 border-neutral-700 focus-within:border-blue-500">
        <input
          ref="searchInput"
          v-model="searchQuery"
          @keyup.enter="performSearch"
          @input="performSearch"
          type="text"
          :placeholder="searchPlaceholder"
          class="flex-1 px-3 py-1.5 text-sm bg-transparent border-none outline-none text-neutral-100 placeholder-neutral-500"
        />
        <div class="flex items-stretch">
          <button
            @click="toggleOption('caseSensitive')"
            :class="[
              'px-2 py-1.5 text-xs transition-colors border-r border-l border-neutral-700',
              searchOptions.caseSensitive
                ? 'bg-blue-600 text-white'
                : 'text-neutral-400 hover:bg-neutral-700'
            ]"
            title="Match Case"
          >
            Aa
          </button>
          <button
            @click="toggleOption('wholeWord')"
            :class="[
              'px-2 py-1.5 text-xs transition-colors border-r border-neutral-700',
              searchOptions.wholeWord
                ? 'bg-blue-600 text-white'
                : 'text-neutral-400 hover:bg-neutral-700'
            ]"
            title="Match Whole Word"
          >
            ab
          </button>
          <button
            @click="toggleOption('useRegex')"
            :class="[
              'px-2 py-1.5 text-xs transition-colors',
              searchOptions.useRegex
                ? 'bg-blue-600 text-white'
                : 'text-neutral-400 hover:bg-neutral-700'
            ]"
            title="Use Regular Expression"
          >
            .*
          </button>
        </div>
      </div>


      <!-- Include/Exclude Patterns -->
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <label class="w-20 text-xs text-neutral-400">Include:</label>
          <input
            v-model="includePattern"
            @change="performSearch"
            type="text"
            placeholder="e.g., *.ts, *.vue"
            class="flex-1 px-2 py-1 text-xs border rounded bg-neutral-900 border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div class="flex items-center gap-2">
          <label class="w-20 text-xs text-neutral-400">Exclude:</label>
          <input
            v-model="excludePattern"
            @change="performSearch"
            type="text"
            placeholder="e.g., node_modules, *.test.js"
            class="flex-1 px-2 py-1 text-xs border rounded bg-neutral-900 border-neutral-700 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>

    <!-- Search Results Section -->
    <div class="flex-1 overflow-auto">
      <!-- Results summary -->
      <div v-if="searchResults.length > 0" class="flex items-center justify-center px-3 py-1.5 text-xs text-neutral-500 border-b border-neutral-800 shrink-0">
        <span class="flex-1 text-center">{{ totalMatches }} results in {{ searchResults.length }} files</span>
        <button
          @click="collapseAll"
          class="p-0.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/50 transition-colors"
          title="Collapse All"
        >
          <ChevronsDownUp class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Progress -->
      <div v-if="searchProgress" class="p-4 text-sm text-neutral-400">
        <div class="mb-1">Searching... {{ searchProgress.filesSearched }} files</div>
        <div v-if="searchProgress.currentFile" class="text-xs truncate text-neutral-500">
          {{ searchProgress.currentFile }}
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="searchError" class="p-4">
        <div class="text-sm text-red-400">{{ searchError }}</div>
      </div>

      <!-- Results -->
      <div v-else-if="searchResults.length > 0" class="py-0.5">
        <div
          v-for="result in visibleResults"
          :key="result.path"
          class="mb-0.5"
        >
          <!-- File header -->
          <div
            @click="toggleResultExpanded(result.path)"
            class="flex items-center gap-1.5 px-3 py-[5px] cursor-pointer hover:bg-neutral-800/60"
          >
            <ChevronRight
              :class="[
                'w-3 h-3 shrink-0 text-neutral-500 transition-transform duration-150',
                expandedResults.has(result.path) && 'rotate-90'
              ]"
            />
            <span class="text-[13px] truncate text-neutral-200 font-medium">{{ getFileName(result.path) }}</span>
            <span class="shrink-0 text-[11px] tabular-nums text-neutral-500 bg-neutral-700/40 px-1.5 py-0.5 rounded-full leading-none">{{ result.matches.length }}</span>
            <span class="text-xs truncate text-neutral-600 ml-auto">{{ getFileDirectory(result.path) }}</span>
          </div>

          <!-- Match lines -->
          <div v-if="expandedResults.has(result.path)" class="ml-5 mr-3 mb-1 border-l-2 border-neutral-700/60">
            <div
              v-for="(match, index) in result.matches"
              :key="`${result.path}-${index}`"
              @click="openMatch(result, match)"
              class="flex items-baseline gap-0 py-[3px] pl-2.5 pr-2 cursor-pointer hover:bg-neutral-700/30 rounded-r-sm"
            >
              <span class="text-[11px] tabular-nums text-neutral-600 min-w-[3em] text-right shrink-0 select-none pr-3">{{ match.line }}</span>
              <div class="overflow-hidden font-mono text-[12px] text-neutral-400 whitespace-nowrap text-ellipsis">
                <span>{{ match.lineText.substring(0, match.matchStart) }}</span>
                <span class="text-yellow-200 bg-yellow-500/25 rounded-sm px-[2px]">{{ match.lineText.substring(match.matchStart, match.matchEnd) }}</span>
                <span>{{ match.lineText.substring(match.matchEnd) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Infinite scroll sentinel -->
        <div v-if="visibleFileCount < searchResults.length" ref="scrollSentinel" class="py-3 text-center text-[11px] text-neutral-600">
          Showing {{ visibleFileCount }} of {{ searchResults.length }} files
        </div>
      </div>

      <!-- No Results -->
      <EmptyState
        v-else-if="searchQuery && !isSearching"
        :icon="Search"
        title="No results found"
        subtitle="Try a different search term"
      />

      <!-- Initial State -->
      <EmptyState
        v-else
        :icon="Search"
        title="Search files"
        subtitle="Enter a search term to find in files"
      />
    </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useSelector } from '@xstate/vue'
import type { CodeState } from '#features/code/fe/state.ts'
import { ChevronRight, ChevronsDownUp, Search } from 'lucide-vue-next'
import CodePanelHeader from '#features/code/fe/features/CodePanelHeader.vue'
import NoDirectoryState from '#features/code/fe/features/NoDirectoryState.vue'
import EmptyState from '#features/code/fe/features/EmptyState.vue'
import { panelChild } from '../children.ts';

// Get actors
const codeActor: CodeState = useSurface()
const searchActor = panelChild(codeActor, 'search')!

// State selectors
const searchQuery = ref('')
const searchResults = useSelector(searchActor, (state) => state.context.searchResults)
const isSearching = useSelector(searchActor, (state) => state.context.isSearching)
const searchError = useSelector(searchActor, (state) => state.context.searchError)
const searchProgress = useSelector(searchActor, (state) => state.context.searchProgress)
const searchOptions = useSelector(searchActor, (state) => state.context.searchOptions)
const baseDirectory = useSelector(codeActor, (state) => state.context.baseDirectory)
const searchFocusTrigger = useSelector(codeActor, (state) => state.context.searchFocusTrigger)
const searchPrefillText = useSelector(codeActor, (state) => state.context.searchPrefillText)

const searchInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  nextTick(() => {
    if (searchPrefillText.value) {
      searchQuery.value = searchPrefillText.value
      performSearch()
    }
    searchInput.value?.focus()
    searchInput.value?.select()
  })
})

// Re-focus input (and optionally prefill) when Cmd+Shift+F is pressed while already on this panel
watch(searchFocusTrigger, () => {
  if (searchPrefillText.value) {
    searchQuery.value = searchPrefillText.value
    nextTick(() => performSearch())
  }
  nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
})

// Local state
const FILE_PAGE_SIZE = 50
const includePattern = ref(searchOptions.value.includePattern)
const excludePattern = ref(searchOptions.value.excludePattern)
const expandedResults = ref(new Set<string>())
const visibleFileCount = ref(FILE_PAGE_SIZE)
const scrollSentinel = ref<HTMLElement | null>(null)

const visibleResults = computed(() => searchResults.value.slice(0, visibleFileCount.value))

// Infinite scroll observer
let observer: IntersectionObserver | null = null

const setupObserver = () => {
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && visibleFileCount.value < searchResults.value.length) {
      visibleFileCount.value = Math.min(visibleFileCount.value + FILE_PAGE_SIZE, searchResults.value.length)
    }
  }, { threshold: 0.1 })
}

watch(scrollSentinel, (el) => {
  observer?.disconnect()
  if (el) {
    if (!observer) setupObserver()
    observer!.observe(el)
  }
})

onUnmounted(() => observer?.disconnect())

// Computed
const totalMatches = computed(() => {
  return searchResults.value.reduce((sum: number, result: any) => sum + result.matches.length, 0)
})


const searchPlaceholder = computed(() => {
  return baseDirectory.value
    ? `Search in ~/${baseDirectory.value.split('/').pop()}`
    : 'Search in project'
})

// Methods
let searchTimeout: ReturnType<typeof setTimeout> | null = null

const performSearch = () => {
  if (searchTimeout) clearTimeout(searchTimeout)

  // Always sync current pattern values to state before searching
  updateOptions()

  if (!searchQuery.value) {
    searchActor?.send({ type: 'search.CANCEL' })
    searchActor?.send({ type: 'search.CLEAR' })
    expandedResults.value.clear()
    visibleFileCount.value = FILE_PAGE_SIZE
    return
  }

  searchTimeout = setTimeout(() => {
    expandedResults.value.clear()
    visibleFileCount.value = FILE_PAGE_SIZE
    searchActor?.send({ type: 'search.START', query: searchQuery.value })
  }, 300)
}


const toggleOption = (option: 'caseSensitive' | 'wholeWord' | 'useRegex') => {
  searchActor?.send({
    type: 'search.UPDATE_OPTIONS',
    options: {
      [option]: !searchOptions.value[option]
    }
  })
  // Re-run search with updated option if there's an active query
  if (searchQuery.value) {
    nextTick(() => performSearch())
  }
}

const updateOptions = () => {
  searchActor?.send({
    type: 'search.UPDATE_OPTIONS',
    options: {
      includePattern: includePattern.value,
      excludePattern: excludePattern.value
    }
  })
}

const collapseAll = () => {
  expandedResults.value.clear()
}

const toggleResultExpanded = (path: string) => {
  if (expandedResults.value.has(path)) {
    expandedResults.value.delete(path)
  } else {
    expandedResults.value.add(path)
  }
}

const openMatch = (result: typeof searchResults.value[0], match: typeof result.matches[0]) => {
  // Open file through explorer
  const explorerActor = panelChild(codeActor, 'explorer')
  explorerActor?.send({
    type: 'explorer.OPEN_FILE',
    path: result.path
  })

  // Tell the code surface to scroll to this line once the file is active
  codeActor.send({
    type: 'UPDATE_STATE',
    updates: { pendingRevealLine: { filePath: result.path, line: match.line, column: match.column, lineText: match.lineText } }
  })
}

const getRelativePath = (path: string) => {
  if (baseDirectory.value && path.startsWith(baseDirectory.value)) {
    return path.slice(baseDirectory.value.length + 1)
  }
  return path
}

const getFileName = (path: string) => {
  const rel = getRelativePath(path)
  return rel.split('/').pop() || rel
}

const getFileDirectory = (path: string) => {
  const rel = getRelativePath(path)
  const parts = rel.split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}


// Watch for option changes from state
watch(searchOptions, (newOptions) => {
  includePattern.value = newOptions.includePattern
  excludePattern.value = newOptions.excludePattern
})

// Auto-expand newly added results
watch(searchResults, (results, oldResults) => {
  const startIdx = oldResults?.length ?? 0
  for (let i = startIdx; i < results.length; i++) {
    expandedResults.value.add(results[i].path)
  }
})
</script>


