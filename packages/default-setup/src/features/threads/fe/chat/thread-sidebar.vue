<template>
  <div class="flex flex-col h-full min-w-0 overflow-hidden shrink-0 border-r border-neutral-800 bg-neutral-900">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-neutral-800">
      <span class="text-xs font-medium text-neutral-400 uppercase tracking-wider">{{ showArchive ? 'Archived' : 'Threads' }}</span>
      <button @click="emit('close')" class="text-neutral-500 hover:text-neutral-300 transition-colors">
        <X :size="14" />
      </button>
    </div>

    <!-- Message search -->
    <div v-if="!showArchive" class="px-2.5 py-2 border-b border-neutral-800">
      <div class="flex items-center gap-1.5 rounded-md bg-neutral-800/70 px-2 py-1 focus-within:ring-1 focus-within:ring-neutral-600">
        <Search :size="12" class="shrink-0 text-neutral-500" />
        <input
          v-model="searchText"
          type="text"
          placeholder="Search messages"
          aria-label="Search messages"
          data-testid="message-search"
          class="flex-1 min-w-0 bg-transparent text-xs text-neutral-200 placeholder-neutral-500 outline-none"
          @input="debouncedSearch()"
          @keydown.escape="clearSearch"
        />
        <button v-if="searchText" class="text-neutral-500 hover:text-neutral-300" aria-label="Clear search" @click="clearSearch">
          <X :size="12" />
        </button>
      </div>
    </div>

    <!-- Scrollable list -->
    <div class="flex-1 overflow-y-auto py-1" @scroll="onSidebarScroll">
      <!-- Search results -->
      <template v-if="!showArchive && messageSearch.query">
        <div v-if="messageSearch.searching" class="py-6 text-center text-xs text-neutral-500">Searching…</div>
        <div v-else-if="messageSearch.results.length === 0" class="py-6 text-center text-xs text-neutral-500">No messages match</div>
        <button
          v-for="result in messageSearch.results" :key="result.messageId"
          class="block w-full text-left px-3 py-2 hover:bg-neutral-800 transition-colors"
          data-testid="message-search-result"
          @click="emit('open-message', result)"
        >
          <div class="flex items-baseline gap-2">
            <span class="flex-1 min-w-0 truncate text-xs font-medium text-neutral-300">{{ result.topic || 'Untitled' }}</span>
            <span class="shrink-0 text-[10px] text-neutral-600">{{ formatWhen(result.timestamp) }}</span>
          </div>
          <p class="mt-0.5 text-xs leading-snug text-neutral-500 line-clamp-3 break-words">
            <span v-if="result.clippedStart">…</span><template v-for="(part, at) in snippetParts(result)" :key="at"><mark
              v-if="part.marked" class="rounded-sm bg-yellow-500/25 px-0.5 text-neutral-100">{{ part.text }}</mark><span v-else>{{ part.text }}</span></template><span v-if="result.clippedEnd">…</span>
          </p>
        </button>
      </template>

      <!-- Archive view -->
      <template v-else-if="showArchive">
        <div v-if="archivedThreads.length === 0" class="py-8 text-center">
          <p class="text-sm text-neutral-500">No archived threads</p>
        </div>
        <ContextMenuRoot v-for="thread in archivedThreads.slice(0, archiveDisplayCount)" :key="thread.id">
          <ContextMenuTrigger as-child>
            <div
              class="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer transition-colors group hover:bg-neutral-800 text-neutral-300 hover:text-white"
              @click="emit('select-thread', thread.id!)"
            >
              <span class="shrink-0 w-1.5 h-1.5 rounded-full bg-neutral-600" />
              <span class="flex-1 min-w-0 truncate text-sm">{{ thread.topic || 'Untitled' }}</span>
            </div>
          </ContextMenuTrigger>
          <ThreadContextMenu
            :is-pinned="false" :is-archived="true" :copy-text="thread.shortCode || thread.id"
            @unarchive="handleUnarchive(thread.id!)" @delete="handleDelete(thread)"
          />
        </ContextMenuRoot>
      </template>

      <!-- Normal thread list -->
      <template v-else>
        <!-- Empty state -->
        <div v-if="allThreads.length === 0" class="py-8 text-center">
          <p class="text-sm text-neutral-500">No threads yet</p>
        </div>

        <template v-else>
          <!-- Pinned section -->
          <template v-if="pinnedThreads.length > 0">
            <div
              class="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5 cursor-pointer select-none"
              @click="toggleCollapsed('pinned')"
            >
              <ChevronRight v-if="collapsed.has('pinned')" :size="10" class="text-neutral-600 transition-transform" />
              <ChevronDown v-else :size="10" class="text-neutral-600 transition-transform" />
              <span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Pinned</span>
            </div>

            <div v-if="!collapsed.has('pinned')" class="ml-[15px] border-l border-neutral-700/30">
              <!-- Pinned groups -->
              <template v-for="pg in pinnedGroups" :key="pg.group.id">
                <div
                  class="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 cursor-pointer hover:bg-neutral-800/50 transition-colors"
                  @click="toggleCollapsed(pg.group.id)"
                >
                  <ChevronRight v-if="collapsed.has(pg.group.id)" :size="11" class="text-neutral-600 shrink-0 transition-transform" />
                  <ChevronDown v-else :size="11" class="text-neutral-600 shrink-0 transition-transform" />
                  <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: groupColor(pg.group.color) }" />
                  <span class="text-xs font-medium text-neutral-400 truncate">{{ pg.group.name }}</span>
                </div>
                <div v-if="!collapsed.has(pg.group.id)" class="ml-[13px] border-l border-neutral-700/25">
                  <SidebarThreadItem
                    v-for="thread in pg.threads" :key="thread.id"
                    :thread="thread" :is-active="thread.id === currentThread?.id" :is-pinned="!!thread.pinned"
                    :dot-color="getDotColor(thread.id)" :is-busy="getBusy(thread.id)"
                    :group-id="pg.group.id" :tab-groups="tabGroups"
                    @select="emit('select-thread', thread.id!)" @rename="handleRename(thread.id!, thread.topic)"
                    @pin="handlePin(thread.id!)" @unpin="handleUnpin(thread.id!)"
                    @archive="handleArchive(thread.id!)" @delete="handleDelete(thread)"
                    @add-to-group="(gId: string) => handleAddToGroup(thread.id!, gId)"
                    @remove-from-group="handleRemoveFromGroup(thread.id!)"
                    @create-group="handleCreateGroup(thread.id!)"
                  />
                </div>
              </template>

              <!-- Ungrouped pinned threads -->
              <SidebarThreadItem
                v-for="thread in ungroupedPinnedThreads" :key="thread.id"
                :thread="thread" :is-active="thread.id === currentThread?.id" :is-pinned="!!thread.pinned"
                :dot-color="getDotColor(thread.id)" :is-busy="getBusy(thread.id)"
                :group-id="undefined" :tab-groups="tabGroups"
                @select="emit('select-thread', thread.id!)" @rename="handleRename(thread.id!, thread.topic)"
                @pin="handlePin(thread.id!)" @unpin="handleUnpin(thread.id!)"
                @archive="handleArchive(thread.id!)" @delete="handleDelete(thread)"
                @add-to-group="(gId: string) => handleAddToGroup(thread.id!, gId)"
                @create-group="handleCreateGroup(thread.id!)"
              />
            </div>
          </template>

          <!-- Unpinned groups -->
          <template v-for="ug in unpinnedGroups" :key="ug.group.id">
            <div
              class="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-neutral-800/50 transition-colors"
              @click="toggleCollapsed(ug.group.id)"
            >
              <ChevronRight v-if="collapsed.has(ug.group.id)" :size="11" class="text-neutral-600 shrink-0 transition-transform" />
              <ChevronDown v-else :size="11" class="text-neutral-600 shrink-0 transition-transform" />
              <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: groupColor(ug.group.color) }" />
              <span class="text-xs font-medium text-neutral-400 truncate">{{ ug.group.name }}</span>
            </div>
            <div v-if="!collapsed.has(ug.group.id)" class="ml-[15px] border-l border-neutral-700/30">
              <SidebarThreadItem
                v-for="thread in ug.threads" :key="thread.id"
                :thread="thread" :is-active="thread.id === currentThread?.id" :is-pinned="!!thread.pinned"
                :dot-color="getDotColor(thread.id)" :is-busy="getBusy(thread.id)"
                :group-id="ug.group.id" :tab-groups="tabGroups"
                @select="emit('select-thread', thread.id!)" @rename="handleRename(thread.id!, thread.topic)"
                @pin="handlePin(thread.id!)" @unpin="handleUnpin(thread.id!)"
                @archive="handleArchive(thread.id!)" @delete="handleDelete(thread)"
                @add-to-group="(gId: string) => handleAddToGroup(thread.id!, gId)"
                @remove-from-group="handleRemoveFromGroup(thread.id!)"
                @create-group="handleCreateGroup(thread.id!)"
              />
            </div>
          </template>

          <!-- Time-based sections -->
          <template v-for="tg in timeGroups" :key="tg.label">
            <div
              class="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5 cursor-pointer select-none"
              @click="toggleCollapsed(tg.label)"
            >
              <ChevronRight v-if="collapsed.has(tg.label)" :size="10" class="text-neutral-600 transition-transform" />
              <ChevronDown v-else :size="10" class="text-neutral-600 transition-transform" />
              <span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{{ tg.label }}</span>
            </div>
            <div v-if="!collapsed.has(tg.label)" class="ml-[15px] border-l border-neutral-700/30">
              <SidebarThreadItem
                v-for="thread in tg.threads" :key="thread.id"
                :thread="thread" :is-active="thread.id === currentThread?.id" :is-pinned="!!thread.pinned"
                :dot-color="getDotColor(thread.id)" :is-busy="getBusy(thread.id)"
                :group-id="tabGroupMap.get(thread.id!)" :tab-groups="tabGroups"
                @select="emit('select-thread', thread.id!)" @rename="handleRename(thread.id!, thread.topic)"
                @pin="handlePin(thread.id!)" @unpin="handleUnpin(thread.id!)"
                @archive="handleArchive(thread.id!)" @delete="handleDelete(thread)"
                @add-to-group="(gId: string) => handleAddToGroup(thread.id!, gId)"
                @remove-from-group="handleRemoveFromGroup(thread.id!)"
                @create-group="handleCreateGroup(thread.id!)"
              />
            </div>
          </template>
        </template>
      </template>
    </div>

    <!-- Fixed footer -->
    <div class="flex-shrink-0 border-t border-neutral-800 px-3 py-2">
      <button
        class="flex items-center gap-1.5 w-full text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
        @click="toggleArchive"
      >
        <ChevronLeft v-if="showArchive" :size="14" />
        <span class="flex-1 text-left">{{ showArchive ? 'Back to Threads' : 'View Archive' }}</span>
        <Archive v-if="!showArchive" :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed, reactive, ref, watchEffect } from 'vue'
import { X, ChevronDown, ChevronRight, ChevronLeft, Archive, Search } from 'lucide-vue-next'
import { useDebounce } from '@apackdev/ui/composables/useDebounce'
import type { MessageSearchResult } from '#generated/types.ts'
import { useSelector } from '@xstate/vue'
import { id, type ThreadsState, type ThreadListItem } from '#features/threads/fe/state.ts'
import { getThreadDotColor, isThreadBusy } from './thread-status.ts'
import { ContextMenuRoot, ContextMenuTrigger } from 'reka-ui'
import ThreadContextMenu from '#features/threads/fe/canvas/components/thread-context-menu.vue'
import SidebarThreadItem from './sidebar-thread-item.vue'
import { sendToSystem } from '#generated/events.ts'

const emit = defineEmits<{
  'select-thread': [threadId: string]
  'open-message': [result: MessageSearchResult]
  'close': []
}>()

// State from threads actor
const actor: ThreadsState = useSurface()
const threadMap = useSelector(actor, (state) => state.context.threadMap)
const tabs = useSelector(actor, (state) => state.context.tabs)
const tabGroups = useSelector(actor, (state) => state.context.tabGroups)
const currentThread = useSelector(actor, (state) => state.context.currentThread)
const chatStates = useSelector(actor, (state) => state.context.chatStates)
const chatStateOverrides = useSelector(actor, (state) => state.context.chatStateOverrides)
const settings = useSelector(actor, (state) => state.context.settings)
const messageSearch = useSelector(actor, (state) => state.context.messageSearch)

// The message search box: what is typed is sent once typing pauses, and its results are the surface's
const searchText = ref(messageSearch.value.query)
const { debounced: debouncedSearch, cancel: cancelSearch } = useDebounce(() => {
  actor.send({ type: 'SEARCH_MESSAGES', query: searchText.value })
}, 200)
function clearSearch() {
  cancelSearch()
  searchText.value = ''
  actor.send({ type: 'SEARCH_MESSAGES', query: '' })
}

/** A result's snippet as runs of text, each marked where the search matched it */
function snippetParts(result: MessageSearchResult): Array<{ text: string; marked: boolean }> {
  const parts: Array<{ text: string; marked: boolean }> = []
  let at = 0
  for (const [start, end] of result.marks) {
    if (start > at) parts.push({ text: result.snippet.slice(at, start), marked: false })
    parts.push({ text: result.snippet.slice(start, end), marked: true })
    at = end
  }
  if (at < result.snippet.length) parts.push({ text: result.snippet.slice(at), marked: false })
  return parts
}

function formatWhen(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// Collapsible groups & sections (local UI state — non-overlapping key spaces)
const collapsed = reactive(new Set<string>())
const hasInitializedCollapse = ref(false)

function toggleCollapsed(key: string) {
  if (collapsed.has(key)) collapsed.delete(key)
  else collapsed.add(key)
}

// Thread status helpers
function getDotColor(threadId: string | undefined): string | undefined {
  if (!threadId) return undefined
  return getThreadDotColor(threadId, chatStates.value, chatStateOverrides.value, settings.value)
}

function getBusy(threadId: string | undefined): boolean {
  if (!threadId) return false
  return isThreadBusy(threadId, chatStates.value, chatStateOverrides.value, settings.value)
}

// Render limiting
const BATCH_SIZE = 30
const displayCount = ref(BATCH_SIZE)
const archiveDisplayCount = ref(BATCH_SIZE)

function onSidebarScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    if (showArchive.value) {
      archiveDisplayCount.value = Math.min(archiveDisplayCount.value + BATCH_SIZE, archivedThreads.value.length)
    } else {
      displayCount.value += BATCH_SIZE
    }
  }
}

// Group color mapping
const groupColorMap: Record<string, string> = {
  blue: '#3B82F6', purple: '#8B5CF6', pink: '#EC4899', red: '#EF4444',
  orange: '#F97316', yellow: '#EAB308', green: '#22C55E', teal: '#14B8A6', gray: '#6B7280',
}
function groupColor(c: string) { return groupColorMap[c] || '#6B7280' }

// Sort timestamp for a thread
function sortTs(t: ThreadListItem): number {
  return t.lastVisitedTimestamp || t.lastMessageTimestamp || t.timestamp || 0
}

// All threads sorted by recency
const allThreads = computed(() =>
  Object.values(threadMap.value)
    .filter(t => !t.archived)
    .sort((a, b) => sortTs(b) - sortTs(a))
)

const pinnedThreads = computed(() => allThreads.value.filter(t => t.pinned))
const unpinnedThreads = computed(() => allThreads.value.filter(t => !t.pinned))

// Map threadId -> groupId from open tabs
const tabGroupMap = computed(() => {
  const map = new Map<string, string>()
  for (const tab of tabs.value) {
    if (tab.groupId) map.set(tab.id, tab.groupId)
  }
  return map
})

// Pinned groups
const pinnedGroups = computed(() =>
  tabGroups.value
    .filter(g => g.isPinned)
    .sort((a, b) => a.order - b.order)
    .map(group => ({
      group,
      threads: pinnedThreads.value.filter(t => tabGroupMap.value.get(t.id!) === group.id),
    }))
    .filter(g => g.threads.length > 0)
)

// Ungrouped pinned threads
const ungroupedPinnedThreads = computed(() => {
  const inGroup = new Set(pinnedGroups.value.flatMap(pg => pg.threads.map(t => t.id)))
  return pinnedThreads.value.filter(t => !inGroup.has(t.id))
})

// Unpinned groups
const unpinnedGroups = computed(() =>
  tabGroups.value
    .filter(g => !g.isPinned)
    .sort((a, b) => a.order - b.order)
    .map(group => ({
      group,
      threads: unpinnedThreads.value.filter(t => tabGroupMap.value.get(t.id!) === group.id),
    }))
    .filter(g => g.threads.length > 0)
)

// Time-based groups for ungrouped unpinned threads
const timeGroups = computed(() => {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  const weekAgoStart = todayStart - 7 * 86_400_000

  const unpinnedGroupedIds = new Set(
    unpinnedGroups.value.flatMap(ug => ug.threads.map(t => t.id))
  )

  const ungrouped = unpinnedThreads.value
    .filter(t => !unpinnedGroupedIds.has(t.id))
    .slice(0, displayCount.value)

  const today: ThreadListItem[] = []
  const yesterday: ThreadListItem[] = []
  const week: ThreadListItem[] = []
  const older: ThreadListItem[] = []

  for (const thread of ungrouped) {
    const ts = sortTs(thread)
    if (ts >= todayStart) today.push(thread)
    else if (ts >= yesterdayStart) yesterday.push(thread)
    else if (ts >= weekAgoStart) week.push(thread)
    else older.push(thread)
  }

  return [
    { label: 'Today', threads: today },
    { label: 'Yesterday', threads: yesterday },
    { label: 'Previous 7 Days', threads: week },
    { label: 'Older', threads: older },
  ].filter(g => g.threads.length > 0)
})

// Collapse all sections by default on first data load
watchEffect(() => {
  if (hasInitializedCollapse.value || allThreads.value.length === 0) return
  hasInitializedCollapse.value = true
  if (pinnedThreads.value.length > 0) collapsed.add('pinned')
  for (const pg of pinnedGroups.value) collapsed.add(pg.group.id)
  for (const ug of unpinnedGroups.value) collapsed.add(ug.group.id)
  for (const tg of timeGroups.value) collapsed.add(tg.label)
})

// Actions
function handlePin(threadId: string) {
  actor.send({ type: 'PIN_THREAD', threadId })
}

function handleUnpin(threadId: string) {
  actor.send({ type: 'UNPIN_THREAD', threadId })
}

function handleRename(threadId: string, topic: string | undefined) {
  const newName = prompt('Rename thread:', topic || '')
  if (newName?.trim()) {
    actor.send({ type: 'RENAME_THREAD', threadId, topic: newName.trim() })
  }
}

function handleArchive(threadId: string) {
  if (settings.value?.skipArchiveConfirm || confirm('Archive this thread? It will be hidden from all lists.')) {
    actor.send({ type: 'ARCHIVE_THREAD', threadId })
  }
}

function handleDelete(thread: ThreadListItem) {
  if (confirm(`Permanently delete thread "${thread.topic || 'Untitled'}"? This cannot be undone.`)) {
    actor.send({ type: 'DELETE_THREAD', threadId: thread.id! })
  }
}

function handleUnarchive(threadId: string) {
  actor.send({ type: 'UNARCHIVE_THREAD', threadId })
}

function handleAddToGroup(tabId: string, groupId: string) {
  actor.send({ type: 'ADD_TAB_TO_GROUP', tabId, groupId })
}

function handleRemoveFromGroup(tabId: string) {
  actor.send({ type: 'REMOVE_TAB_FROM_GROUP', tabId })
}

function handleCreateGroup(tabId: string) {
  actor.send({ type: 'CREATE_TAB_GROUP', tabIds: [tabId] })
}

// Archive view
const showArchive = ref(false)
const archivedThreads = useSelector(actor, (state) => state.context.sidebarArchivedThreads)

function toggleArchive() {
  showArchive.value = !showArchive.value
  displayCount.value = BATCH_SIZE
  archiveDisplayCount.value = BATCH_SIZE
  if (showArchive.value) {
    sendToSystem(id, { type: 'GET_ARCHIVED_THREADS' })
  }
}
</script>
