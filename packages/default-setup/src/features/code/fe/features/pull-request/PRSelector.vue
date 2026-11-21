<template>
  <div ref="dropdownContainer" class="relative flex-1 min-w-0">
    <button
      @click="toggle"
      class="flex items-center w-full gap-1.5 pl-2 pr-2.5 py-1.5 text-xs rounded border border-neutral-700 text-neutral-300 bg-neutral-900 hover:bg-neutral-800 transition-colors"
    >
      <GitPullRequest :size="12" :class="[prStatusColor(selectedPR), 'shrink-0']" />
      <span class="truncate min-w-0 text-left">
        {{ selectedPR ? `#${selectedPR.number} ${selectedPR.title}` : 'Select a pull request...' }}
      </span>
      <StateBadge :pr="selectedPR" />
    </button>

    <!-- Dropdown: the list GitHub has, filtered, searched and read a page at a time -->
    <div
      v-if="isDropdownOpen"
      class="absolute z-50 w-full mt-1 rounded border border-neutral-700 bg-neutral-800 shadow-lg"
    >
      <div class="flex items-center gap-1 px-2 pt-2" role="tablist">
        <button
          v-for="state in PR_LIST_STATES"
          :key="state"
          role="tab"
          :aria-selected="list.state === state"
          :data-testid="`pr-list-state-${state}`"
          @click="emit('set-state', state)"
          class="px-1.5 py-0.5 text-[11px] rounded transition-colors"
          :class="list.state === state ? 'bg-neutral-600 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'"
        >{{ STATE_LABELS[state] }}</button>
      </div>
      <div class="px-2 py-1.5">
        <input
          v-model="query"
          data-testid="pr-list-search"
          type="search"
          placeholder="Search, or #number"
          class="w-full px-2 py-1 text-xs rounded border border-neutral-700 bg-neutral-900 text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
          @keydown.enter="searchNow"
        />
      </div>
      <div class="max-h-60 overflow-y-auto" data-testid="pr-list">
        <button
          v-for="pr in list.prs"
          :key="pr.number"
          @click="selectPR(pr.number)"
          class="flex items-center w-full gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-neutral-700"
          :class="selectedPR?.number === pr.number ? 'text-blue-400' : 'text-neutral-300'"
        >
          <GitPullRequest :size="11" :class="[prStatusColor(pr), 'shrink-0']" />
          <span class="truncate">#{{ pr.number }} {{ pr.title }}</span>
          <StateBadge :pr="pr" />
        </button>
        <div v-if="reading === 'first'" class="flex items-center gap-1.5 px-3 py-2 text-xs text-neutral-500">
          <Loader2 :size="11" class="animate-spin" /> Loading…
        </div>
        <div v-else-if="list.read && list.prs.length === 0" class="px-3 py-2 text-xs text-neutral-500" data-testid="pr-list-empty">
          {{ list.query.trim() ? 'No pull requests match' : `No ${STATE_LABELS[list.state].toLowerCase()} pull requests` }}
        </div>
        <button
          v-if="list.next && reading !== 'first'"
          data-testid="pr-list-more"
          :disabled="reading !== null"
          @click="emit('load-more')"
          class="flex items-center justify-center w-full gap-1.5 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 disabled:opacity-60 transition-colors"
        >
          <Loader2 v-if="reading === 'more'" :size="11" class="animate-spin" />
          <span>{{ reading === 'more' ? 'Loading…' : 'Load more' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h, ref, useTemplateRef, watch } from 'vue'
import { GitPullRequest, Loader2 } from 'lucide-vue-next'
import { useClickOutside } from '@apackdev/ui/composables/useClickOutside'
import { useDebounce } from '@apackdev/ui/composables/useDebounce'
import type { GhPullRequest } from '#generated/types.ts'
import type { PRListState } from '#features/code/be/services/github-api.ts'
import type { PRList } from './state.ts'

const props = defineProps<{
  list: PRList
  /** The page of the list being read: its first, the one after those read, or none */
  reading: 'first' | 'more' | null
  selectedPR: GhPullRequest | null
}>()

const emit = defineEmits<{
  'select-pr': [number: number]
  /** The dropdown opened, so the list is read for what it shows */
  'shown': []
  'set-state': [state: PRListState]
  'set-query': [query: string]
  'load-more': []
}>()

/** Each list's name, in the order its tabs show: a `Record`, so a state the backend lists cannot go unnamed */
const STATE_LABELS: Record<PRListState, string> = { open: 'Open', closed: 'Closed', merged: 'Merged', all: 'All' }
const PR_LIST_STATES = Object.keys(STATE_LABELS) as PRListState[]

const isDropdownOpen = ref(false)
const dropdownContainer = useTemplateRef<HTMLElement>('dropdownContainer')
/** What is typed in the search box, which the list is searched by once typing pauses */
const query = ref(props.list.query)

useClickOutside(dropdownContainer, () => {
  isDropdownOpen.value = false
})

const toggle = () => {
  isDropdownOpen.value = !isDropdownOpen.value
  if (isDropdownOpen.value) emit('shown')
}

const selectPR = (number: number) => {
  isDropdownOpen.value = false
  emit('select-pr', number)
}

// Typing searches once it pauses, so each key is not a search of GitHub's
const { debounced: search, cancel, flush } = useDebounce((text: string) => emit('set-query', text), 300)
watch(query, text => search(text))
const searchNow = () => flush()
watch(() => props.list.query, text => {
  if (text.trim() !== query.value.trim()) { cancel(); query.value = text }
})

function prStatusColor(pr: GhPullRequest | null): string {
  if (!pr) return 'text-neutral-400'
  if (pr.state === 'MERGED') return 'text-purple-400'
  if (pr.state === 'CLOSED') return 'text-red-400'
  if (pr.isDraft) return 'text-neutral-400'
  return 'text-green-400'
}

/** A pull request's state, where it is not plainly open */
const StateBadge = defineComponent({
  props: { pr: { type: Object as () => GhPullRequest | null, default: null } },
  setup: (badge) => () => {
    const pr = badge.pr
    if (!pr) return null
    const [label, classes] = pr.state === 'MERGED' ? ['MERGED', 'bg-purple-600/50 text-purple-300']
      : pr.state === 'CLOSED' ? ['CLOSED', 'bg-red-600/50 text-red-300']
        : pr.isDraft ? ['DRAFT', 'bg-neutral-600 text-neutral-300'] : []
    return label ? h('span', { class: `text-[9px] px-1 leading-4 rounded shrink-0 ${classes}` }, label) : null
  },
})
</script>
