<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <ThreadsHeader />

    <!-- Threads Table -->
    <div class="flex-1 overflow-hidden">
      <div v-if="filteredThreads.length > 0" ref="scrollContainer" class="h-full overflow-y-auto custom-scrollbar" @scroll="onScroll" @dragend="handleDragEnd" @click="handleBackgroundClick">
        <table class="w-full">
          <thead class="sticky top-0 z-10 bg-neutral-900">
            <tr class="text-xs font-medium tracking-wider text-left uppercase border-b text-neutral-400 border-neutral-800">
              <th class="px-6 py-3 w-full">Label</th>
              <th class="px-6 py-3 whitespace-nowrap">Tags</th>
              <th class="px-6 py-3 whitespace-nowrap">Status</th>
              <th class="px-6 py-3 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            <ThreadRow
              v-for="thread in visibleThreads"
              :key="thread.id"
              :thread="thread"
              :available-tags="machine.data.availableTags"
              :settings="machine.data.settings"
              :chat-states="machine.data.chatStates"
              :chat-state-overrides="machine.data.chatStateOverrides"
              :is-selected="machine.data.selectedThreadIds.includes(thread.id)"
              :drag-class="getRowClass(thread.id)"
              :show-archived="machine.data.showArchived"
              @select="send({ type: 'SELECT_THREAD', id: $event })"
              @multi-select="(id, event) => selectItem(thread, filteredThreads, event)"
              @status-change="(id, status) => send({ type: 'UPDATE_THREAD_STATUS', id, status })"
              @chat-click="(threadId) => send({ type: 'OPEN_THREAD_CHAT', threadId })"
              @archive-click="handleArchiveThread"
              @unarchive-click="(threadId) => send({ type: 'UNARCHIVE_THREAD', threadId })"
              @delete-click="handleDeleteThread"
              @unpin-click="handleUnpinThread"
              :renaming-name="renamingThreadId === thread.id ? renamingName : null"
              @rename-click="handleRenameThread"
              @rename-input="renamingName = $event"
              @rename-confirm="handleRenameConfirm"
              @rename-cancel="handleRenameCancel"
              @pin-click="handlePinThread"
              @drag-start="handleDragStart"
              @drag-over="handleDragOver"
              @drag-leave="handleDragLeave"
              @drop="handleDrop"
            />
          </tbody>
        </table>
      </div>

      <!-- Filtered Empty State -->
      <div
        v-else-if="hasActiveFilters"
        class="flex flex-col items-center pt-10 h-full"
      >
        <div class="flex flex-col items-center max-w-sm text-center">
          <div class="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-neutral-800">
            <SearchX class="w-8 h-8 text-neutral-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-neutral-100">No matching threads</h3>
          <p class="mb-6 text-sm text-neutral-400">
            Try adjusting your filters or search
          </p>
          <Button @click="send({ type: 'CLEAR_FILTERS' })" variant="transparent">
            <span>Clear filters</span>
          </Button>
        </div>
      </div>

      <!-- Archive Empty State -->
      <div
        v-else-if="machine.data.showArchived"
        class="flex flex-col items-center pt-10 h-full"
      >
        <div class="flex flex-col items-center max-w-sm text-center">
          <div class="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-neutral-800">
            <Archive class="w-8 h-8 text-neutral-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-neutral-100">No archived threads</h3>
          <p class="text-sm text-neutral-400">
            Archived threads will appear here
          </p>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="flex flex-col items-center pt-10 h-full"
      >
        <div class="flex flex-col items-center max-w-sm text-center">
          <div class="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-neutral-800">
            <MessageCircleMore class="w-8 h-8 text-neutral-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-neutral-100">No threads yet</h3>
          <p class="mb-6 text-sm text-neutral-400">
            Create your first thread to start a conversation
          </p>
          <Button @click="send({ type: 'SHOW_CREATE_FORM' })" variant="primary">
            <Plus class="w-4 h-4" />
            <span>New Thread</span>
          </Button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref, computed, watch } from 'vue'
import { Archive, MessageCircleMore, Plus, SearchX } from 'lucide-vue-next'
import Button from '@apackdev/ui/design/button'
import ThreadRow from './list/thread-row.vue'
import ThreadsHeader from './components/ThreadsHeader.vue'
import { threadsFromStore, type ThreadsState } from '#features/threads/fe/state.ts'
import { useThreadSelection } from '#features/threads/fe/composables/useThreadSelection.ts'
import { useThreadDragDrop } from '#features/threads/fe/composables/useThreadDragDrop.ts'

const actor: ThreadsState = useSurface()
const { state: machine, send } = useState(actor)
const threads = computed(() => threadsFromStore(machine.value.data.threadMap, machine.value.data.threadIds))
const filters = computed(() => machine.value.data.filters)
const selectedThreadIds = computed(() => machine.value.data.selectedThreadIds)

const { selectItem, clearSelection } = useThreadSelection(
  () => filteredThreads.value,
  () => selectedThreadIds.value,
  (itemIds) => send({ type: 'SELECT_THREAD_ITEMS', itemIds })
)

const { handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd, getRowClass } = useThreadDragDrop({
  selectedItems: selectedThreadIds,
  onReparent: (childIds, parentId) => send({ type: 'SET_THREAD_PARENT', childIds, parentId })
})

const BATCH_SIZE = 20
const displayCount = ref(BATCH_SIZE)
const scrollContainer = ref<HTMLElement | null>(null)

const hasActiveFilters = computed(() =>
  filters.value.statuses.length > 0 || filters.value.tags.length > 0 || filters.value.chatStates.length > 0 || filters.value.search !== ''
  || (filters.value.showRootOnly && threads.value.some(t => t.parentId))
)

const filteredThreads = computed(() => {
  let result = threads.value

  // Show only root threads (no parent) by default
  if (filters.value.showRootOnly) {
    result = result.filter(t => !t.parentId)
  }

  if (filters.value.statuses.length > 0) {
    result = result.filter(t => filters.value.statuses.includes(t.status))
  }

  if (filters.value.tags.length > 0) {
    result = result.filter(t =>
      t.tags && t.tags.some(tag => filters.value.tags.includes(tag))
    )
  }

  if (filters.value.chatStates.length > 0) {
    const now = Date.now()
    result = result.filter(t => {
      const override = machine.value.data.chatStateOverrides[t.id]
      const effectiveState = (override && override.expiresAt > now)
        ? override.id
        : (machine.value.data.chatStates[t.id] || 'idle')
      return filters.value.chatStates.includes(effectiveState)
    })
  }

  if (filters.value.search) {
    const keyword = filters.value.search.toLowerCase()
    result = result.filter(t =>
      t.topic?.toLowerCase().includes(keyword)
    )
  }

  result.sort((a, b) => {
    const pinnedDiff = Number(b.pinned ?? false) - Number(a.pinned ?? false);
    if (pinnedDiff !== 0) return pinnedDiff;
    return (b.timestamp || 0) - (a.timestamp || 0);
  })

  return result
})

watch(filters, () => {
  displayCount.value = BATCH_SIZE
  if (scrollContainer.value) scrollContainer.value.scrollTop = 0
}, { deep: true })

const visibleThreads = computed(() => {
  return filteredThreads.value.slice(0, displayCount.value)
})

const onScroll = (e: Event) => {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    if (displayCount.value < filteredThreads.value.length) {
      displayCount.value += BATCH_SIZE
    }
  }
}

const handleBackgroundClick = (e: MouseEvent) => {
  // Clear selection when clicking outside any row (empty table area, below rows, etc.)
  const target = e.target as HTMLElement
  if (!target.closest('tr') || target.closest('thead')) {
    clearSelection()
  }
}

const handleArchiveThread = (threadId: string) => {
  const thread = threads.value.find(t => t.id === threadId);
  if (!thread) return;

  const confirmed = confirm(`Archive thread "${thread.topic || 'Untitled'}"? It will be hidden from all lists.`);

  if (confirmed) {
    send({ type: 'ARCHIVE_THREAD', threadId });
  }
};

const handleUnpinThread = (threadId: string) => {
  send({ type: 'UNPIN_THREAD', threadId });
};

const handlePinThread = (threadId: string) => {
  send({ type: 'PIN_THREAD', threadId });
};

const renamingThreadId = ref<string | null>(null)
const renamingName = ref('')

const handleRenameThread = (threadId: string) => {
  const thread = threads.value.find(t => t.id === threadId);
  if (!thread) return;
  renamingThreadId.value = threadId;
  renamingName.value = thread.topic || '';
};

const handleRenameConfirm = (threadId: string) => {
  const trimmed = renamingName.value.trim();
  if (trimmed && renamingThreadId.value) {
    send({ type: 'RENAME_THREAD', threadId, topic: trimmed });
  }
  renamingThreadId.value = null;
  renamingName.value = '';
};

const handleRenameCancel = () => {
  renamingThreadId.value = null;
  renamingName.value = '';
};

const handleDeleteThread = (threadId: string) => {
  const thread = threads.value.find(t => t.id === threadId);
  if (!thread) return;

  const confirmed = confirm(`Are you sure you want to delete thread "${thread.topic || 'Untitled'}"? This will permanently delete all messages and other data associated .`);

  if (confirmed) {
    send({ type: 'DELETE_THREAD', threadId });
  }
};
</script>
