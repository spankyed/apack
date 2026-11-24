<template>
  <div class="@container flex items-center justify-between gap-4 px-3 py-3 sm:px-6 border-b border-neutral-800">
    <!-- Left section: Title and subtitle -->
    <div class="hidden @4xl:flex items-center gap-6">
      <div class="flex items-center gap-2">
        <component :is="threads.data.showArchived ? Archive : History" class="w-4 h-4 text-neutral-500" />
        <p class="text-sm text-neutral-400">{{ threads.data.showArchived ? 'Viewing archived threads' : 'Manage agent threads' }}</p>
      </div>
    </div>

    <!-- Right section: Search and New Thread button -->
    <div class="flex items-center gap-2 @lg:gap-3 flex-1 min-w-0 justify-end">
      <!-- View toggle buttons -->
      <div class="flex gap-1 pr-2 @lg:pr-3 border-r border-neutral-700 flex-shrink-0">
        <button
          @click="send({ type: 'VIEW_LIST' })"
          class="p-1.5 rounded-md transition-colors"
          :class="isListView
            ? 'bg-neutral-700 text-neutral-100'
            : 'text-neutral-400 hover:text-neutral-200'"
          title="List View"
        >
          <List :size="16" />
        </button>
        <button
          @click="send({ type: 'VIEW_KANBAN' })"
          class="p-1.5 rounded-md transition-colors"
          :class="isKanbanView
            ? 'bg-neutral-700 text-neutral-100'
            : 'text-neutral-400 hover:text-neutral-200'"
          title="Kanban Board"
        >
          <Columns3 :size="16" />
        </button>
        <button
          @click="send({ type: 'VIEW_DASHBOARD' })"
          class="p-1.5 rounded-md transition-colors"
          :class="isDashboardView
            ? 'bg-neutral-700 text-neutral-100'
            : 'text-neutral-400 hover:text-neutral-200'"
          title="Dashboard"
        >
          <PanelLeft :size="16" />
        </button>
      </div>
      <!-- Filter buttons -->
      <div class="flex shrink-0 gap-1 whitespace-nowrap @md:gap-2">
        <FilterPopover
          :statuses="statuses"
          :tags="allTags"
          :chat-state-configs="chatStateConfigs"
          :selected-statuses="threads.data.filters.statuses"
          :selected-tags="threads.data.filters.tags"
          :selected-chat-states="threads.data.filters.chatStates"
          :show-root-only="threads.data.filters.showRootOnly"
          :show-archived="threads.data.showArchived"
          @toggle-status="(s) => send({ type: 'TOGGLE_FILTER_STATUS', status: s })"
          @toggle-tag="(t) => send({ type: 'TOGGLE_FILTER_TAG', tag: t })"
          @toggle-chat-state="(s) => send({ type: 'TOGGLE_FILTER_CHAT_STATE', chatState: s })"
          @toggle-root-only="send({ type: 'TOGGLE_ROOT_ONLY_FILTER' })"
          @toggle-view-archive="send({ type: 'TOGGLE_VIEW_ARCHIVE' })"
        >
          <Button
            type="button"
            variant="transparent"
            aria-label="Filter"
            title="Filter"
            class="!text-sm !px-2 !py-1.5 @md:!px-3"
          >
            <Filter :size="14" aria-hidden="true" />
            <span class="hidden @md:inline">Filter</span>
          </Button>
        </FilterPopover>
        <Button
          v-if="activeFilterCount > 0"
          type="button"
          variant="transparent"
          aria-label="Clear filters"
          :title="`Clear filters (${activeFilterCount})`"
          class="!gap-1 !text-sm !px-2 !py-1.5 @2xl:!px-3"
          @click="send({ type: 'CLEAR_FILTERS' })"
        >
          <FilterX :size="14" aria-hidden="true" class="@2xl:hidden" />
          <span class="hidden @2xl:inline">Clear filters</span>
          <span class="text-neutral-400" aria-hidden="true">{{ activeFilterCount }}</span>
        </Button>
      </div>
      <!-- Search input -->
      <div class="relative min-w-0 w-32 @3xl:w-64">
        <Search aria-hidden="true" class="pointer-events-none absolute w-4 h-4 -translate-y-1/2 left-2.5 top-1/2 text-neutral-500" />
        <input
          ref="searchInput"
          v-model="searchKeyword"
          type="text"
          aria-label="Search threads"
          placeholder="Search threads..."
          class="w-full min-w-0 pl-8 pr-7 py-1.5 text-sm transition-all duration-200 border rounded-md bg-neutral-800 border-neutral-700 placeholder-neutral-600 text-neutral-100 focus:outline-none focus:border-neutral-600 focus:bg-neutral-800"
        />
        <button
          v-if="searchKeyword"
          @click="searchKeyword = ''"
          class="absolute -translate-y-1/2 right-2.5 top-1/2 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <X :size="14" />
        </button>
      </div>

      <Button
        @click="send({ type: 'SHOW_CREATE_FORM' })"
        type="button"
        variant="primary"
        class="shrink-0 whitespace-nowrap !px-2 @md:!px-4"
        aria-label="New Thread"
        title="New Thread"
        data-onboarding-id="thread-create-button"
      >
        <Plus :size="16" aria-hidden="true" class="@md:hidden" />
        <span class="hidden @md:inline">New Thread</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref, computed, watch } from 'vue'
import { Search, Filter, FilterX, List, Columns3, PanelLeft, History, Archive, Plus, X } from 'lucide-vue-next'
import Button from '@apackdev/ui/design/button'
import FilterPopover from './FilterPopover.vue'
import { type ThreadsState } from '#features/threads/fe/state.ts'
import type { ThreadTagOption } from '#generated/types.ts'

const actor: ThreadsState = useSurface()
const { state: threads, send } = useState(actor)
const isDashboardView = computed(() => threads.value.at === 'dashboard')
const isListView = computed(() => threads.value.at === 'list')
const isKanbanView = computed(() => threads.value.at === 'kanban')

const statuses = computed(() => threads.value.data.settings?.statuses || [])
const chatStateConfigs = computed(() => threads.value.data.settings?.chatStates || [])

const allTags = computed<readonly ThreadTagOption[]>(() => {
  const settingsTags = threads.value.data.availableTags || []
  const settingsTagNames = new Set(settingsTags.map(t => t.name))
  const adHocNames = new Set<string>()
  for (const thread of Object.values(threads.value.data.threadMap)) {
    if (thread.tags) {
      for (const tag of thread.tags) {
        if (!settingsTagNames.has(tag)) adHocNames.add(tag)
      }
    }
  }
  if (adHocNames.size === 0) return settingsTags
  return [...settingsTags, ...[...adHocNames].sort().map(name => ({ name }))]
})

const activeFilterCount = computed(() =>
  threads.value.data.filters.statuses.length + threads.value.data.filters.tags.length + threads.value.data.filters.chatStates.length
)

const searchInput = ref<HTMLInputElement | null>(null)
const searchKeyword = ref(threads.value.data.filters.search ?? '')

function clearSearch() {
  searchKeyword.value = ''
  searchInput.value?.focus()
}
let searchTimeout: ReturnType<typeof setTimeout> | undefined
watch(searchKeyword, (val) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    send({ type: 'SET_SEARCH', keyword: val })
  }, 200)
})

// Sync search input when filters are cleared externally
watch(() => threads.value.data.filters.search, (val) => {
  if (val === '' && searchKeyword.value !== '') {
    searchKeyword.value = ''
  }
})
</script>
