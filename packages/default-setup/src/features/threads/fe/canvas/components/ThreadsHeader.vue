<template>
  <div class="@container flex items-center justify-between gap-4 px-6 py-3 border-b border-neutral-800">
    <!-- Left section: Title and subtitle -->
    <div class="hidden @4xl:flex items-center gap-6">
      <div class="flex items-center gap-2">
        <component :is="threads.data.showArchived ? Archive : History" class="w-4 h-4 text-neutral-500" />
        <p class="text-sm text-neutral-400">{{ threads.data.showArchived ? 'Viewing archived threads' : 'Manage agent threads' }}</p>
      </div>
    </div>

    <!-- Right section: Search and New Thread button -->
    <div class="flex items-center gap-3 flex-1 min-w-0 justify-end">
      <!-- View toggle buttons -->
      <div class="flex gap-1 pr-3 border-r border-neutral-700 flex-shrink-0">
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
      <div class="flex gap-2 flex-shrink-0 whitespace-nowrap">
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
            class="!text-sm !px-3 !py-1.5"
          >
            <Filter :size="14" />
            <span>Filter</span>
          </Button>
        </FilterPopover>
        <Button
          v-if="activeFilterCount > 0"
          type="button"
          variant="transparent"
          class="!text-sm !px-3 !py-1.5"
          @click="send({ type: 'CLEAR_FILTERS' })"
        >
          <span>Clear filters</span>
          <span class="ml-1 text-neutral-500">
            ({{ activeFilterCount }})
          </span>
        </Button>
      </div>
      <!-- Search input -->
      <div class="relative">
        <Search class="absolute w-4 h-4 -translate-y-1/2 left-3 top-1/2 text-neutral-500" />
        <input
          v-model="searchKeyword"
          type="text"
          placeholder="Search threads..."
          class="w-32 @3xl:w-64 px-10 py-1.5 text-sm transition-all duration-200 border rounded-md bg-neutral-800 border-neutral-700 placeholder-neutral-600 text-neutral-100 focus:outline-none focus:border-neutral-600 focus:bg-neutral-800"
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
        class="whitespace-nowrap flex-shrink-0"
        data-onboarding-id="thread-create-button"
      >
        <span>New Thread</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref, computed, watch } from 'vue'
import { Search, Filter, List, Columns3, PanelLeft, History, Archive, X } from 'lucide-vue-next'
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

const searchKeyword = ref(threads.value.data.filters.search ?? '')
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
