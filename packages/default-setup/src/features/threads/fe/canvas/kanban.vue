<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref, reactive, computed, watch } from 'vue'
import { ArrangeableList, type MovingItem } from 'vue-arrange'
import { threadsFromStore, type ThreadsState, type ThreadListItem } from '#features/threads/fe/state.ts'
import ThreadsHeader from './components/ThreadsHeader.vue'
import { SquarePen } from 'lucide-vue-next'

// import type { ThreadsSettings } from '#generated/types.ts'

const actor: ThreadsState = useSurface()
const { state: machine, send } = useState(actor)
const threads = computed(() => threadsFromStore(machine.value.data.threadMap, machine.value.data.threadIds))
const filters = computed(() => machine.value.data.filters)
const settings = computed(() => machine.value.data.settings)

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type WorkItem = ThreadListItem & {
  listId: symbol
  index: number
  time: string
  date: string
}

type KanbanList = {
  id: symbol
  name: string
  color: string
  index: number
}

/* -------------------------------------------------------------------------- */
/*  Computed Data                                                             */
/* -------------------------------------------------------------------------- */

// Build lists from settings statuses
const lists = computed<KanbanList[]>(() => {
  if (!settings.value?.statuses || settings.value.statuses.length === 0) {
    // Fallback to default statuses
    return [
      { id: Symbol('backlog'), name: 'Backlog', color: 'bg-neutral-800 border-b border-neutral-700/50', index: 0 },
      { id: Symbol('in-progress'), name: 'In Progress', color: 'bg-blue-900/50 border-b border-blue-800/30', index: 1 },
      { id: Symbol('done'), name: 'Done', color: 'bg-emerald-900/40 border-b border-emerald-800/30', index: 2 },
    ]
  }

  return settings.value.statuses.map((status, index) => ({
    id: Symbol(status.label),
    name: status.label,
    color: `bg-neutral-800 border-b border-neutral-700/50`, // Base color, can be enhanced with status.color
    index,
  }))
})

// Map status label to list index
const statusToListIndex = computed(() => {
  const map: Record<string, number> = {}
  lists.value.forEach((list, index) => {
    map[list.name.toLowerCase().replace(/\s+/g, '-')] = index
    map[list.name] = index
  })
  return map
})

// Initialize items from threads
const items = ref<WorkItem[]>([])
let droppingItem = false

function initializeItems() {
  if (!threads.value || threads.value.length === 0) {
    items.value = []
    return
  }

  let source = threads.value

  if (filters.value.statuses.length > 0) {
    source = source.filter(t => filters.value.statuses.includes(t.status))
  }
  if (filters.value.tags.length > 0) {
    source = source.filter(t =>
      t.tags && t.tags.some(tag => filters.value.tags.includes(tag))
    )
  }
  if (filters.value.search) {
    const keyword = filters.value.search.toLowerCase()
    source = source.filter(t => t.topic?.toLowerCase().includes(keyword))
  }
  if (filters.value.chatStates.length > 0) {
    const now = Date.now()
    source = source.filter(t => {
      const override = machine.value.data.chatStateOverrides[t.id]
      const effectiveState = (override && override.expiresAt > now)
        ? override.id
        : (machine.value.data.chatStates[t.id] || 'idle')
      return filters.value.chatStates.includes(effectiveState)
    })
  }

  const workItemsByStatus: Record<string, WorkItem[]> = {}

  source.forEach((thread) => {
    const status = thread.status || lists.value[0]?.name || 'Backlog'
    const listIndex = statusToListIndex.value[status] ?? statusToListIndex.value[status.toLowerCase().replace(/\s+/g, '-')] ?? 0
    const listId = lists.value[listIndex]?.id || lists.value[0].id

    if (!workItemsByStatus[status]) {
      workItemsByStatus[status] = []
    }

    const timestamp = thread.updatedAt || thread.createdAt || thread.timestamp || Date.now()

    workItemsByStatus[status].push({
      ...thread,
      listId,
      index: workItemsByStatus[status].length,
      time: new Date(timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }),
      date: new Date(timestamp).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }),
    })
  })

  items.value = Object.values(workItemsByStatus).flat()
}

// Initialize and watch for changes
initializeItems()
watch([threads, settings, filters], () => {
  if (droppingItem) {
    droppingItem = false
    return
  }
  initializeItems()
  resetColumnCounts()
})

/* -------------------------------------------------------------------------- */
/*  Per-column render limiting                                                 */
/* -------------------------------------------------------------------------- */

const BATCH_SIZE = 20
const columnDisplayCounts = reactive(new Map<symbol, number>())

function resetColumnCounts() {
  for (const list of lists.value) {
    columnDisplayCounts.set(list.id, BATCH_SIZE)
  }
}
resetColumnCounts()

function visibleColumnItems(listId: symbol) {
  const count = columnDisplayCounts.get(listId) ?? BATCH_SIZE
  return items.value.filter(i => i.listId === listId).slice(0, count)
}

function onColumnScroll(e: Event, listId: symbol) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    const current = columnDisplayCounts.get(listId) ?? BATCH_SIZE
    const total = items.value.filter(i => i.listId === listId).length
    if (current < total) {
      columnDisplayCounts.set(listId, current + BATCH_SIZE)
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Drag‑&‑drop config                                                        */
/* -------------------------------------------------------------------------- */

const dropGroup = Symbol('kanban-group')

const arrangeableOptions = {
  hoverClass: 'opacity-90 cursor-grabbing shadow-2xl',
  pickedItemClass: 'opacity-70',
  handle: true,
  // liftDelay: 150,
}

/* -------------------------------------------------------------------------- */
/*  Event handlers                                                            */
/* -------------------------------------------------------------------------- */

function onCardClick(item: WorkItem) {
  send({ type: 'OPEN_THREAD_CHAT', threadId: item.id })
}

async function dropItem<T extends KanbanList | WorkItem>(moving: MovingItem<T>) {
  const targetTable = 'listId' in moving.payload ? items : lists

  // no drop target => revert
  if (!moving.destination) return

  // Re‑index destination items and update listId (for cards)
  if (moving.destination.listItems) {
    moving.destination.listItems.forEach((itm, idx) => {
      (itm as any).index = idx
      if ('listId' in itm) (itm as WorkItem).listId = moving.destination!.identifier as symbol
    })
  }

  // Keep table array sorted by index
  targetTable.value.sort((a: any, b: any) => a.index - b.index)

  // If we're moving a work item, update its status
  if ('listId' in moving.payload && moving.destination) {
    const workItem = moving.payload as WorkItem
    const destinationListId = moving.destination.identifier as symbol

    // Find the status for the destination list
    const destinationList = lists.value.find(list => list.id === destinationListId)
    if (destinationList) {
      const newStatus = destinationList.name

      // Skip the next watcher rebuild — vue-arrange already has the correct state
      droppingItem = true

      // Send status update event
      send({
        type: 'UPDATE_THREAD_STATUS',
        id: workItem.id,
        status: newStatus,
      })
    }
  }
}
</script>

<template>
  <div class="flex flex-col h-full min-h-[300px] bg-neutral-900">
    <ThreadsHeader />
    <main class="flex-1 flex flex-col p-6 bg-transparent overflow-hidden min-h-0">
    <div v-if="lists.length === 0" class="flex items-center justify-center h-full">
      <p class="text-neutral-500">No status columns configured. Please configure thread statuses in settings.</p>
    </div>
    <div v-else class="flex flex-1 gap-4 min-h-0 w-full select-none">
      <section
        v-for="list in lists"
        :key="String(list.id)"
        class="flex flex-col flex-1 overflow-hidden shadow-sm rounded-xl bg-neutral-900 min-h-0 border border-neutral-800"
      >
        <!-- column header -->
        <header
          class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium whitespace-nowrap"
          :class="list.color"
        >
          <span class="text-sm text-neutral-200">{{ list.name }}</span>
          <span class="text-xs text-neutral-500">
            ({{ items.filter(({ listId }) => listId === list.id).length }})
          </span>
        </header>

        <!-- inner list = cards -->
        <ArrangeableList
          :identifier="list.id"
          :group="dropGroup"
          :targets="[dropGroup]"
          :list="visibleColumnItems(list.id)"
          class="kanban-list flex-1 flex flex-col p-3 space-y-2 overflow-y-auto min-h-[6rem]"
          @scroll="onColumnScroll($event, list.id)"
          :options="arrangeableOptions"
          @drop-item="dropItem"
        >
          <template #default="{ item: card }">
            <article
              data-handle
              class="group p-3 transition-all duration-200 border rounded-lg cursor-grab bg-neutral-800/50 hover:bg-neutral-800/80 border-neutral-800/50 hover:border-neutral-700/50"
            >
              <div class="flex items-center justify-between gap-2 mb-1 pointer-events-none" :title="card.topic || 'Untitled Thread'">
                <p class="flex-1 min-w-0 text-sm font-medium leading-snug text-neutral-100 truncate">
                  <span
                    class="pointer-events-auto cursor-pointer hover:underline underline-offset-2 decoration-neutral-400"
                    @click.stop="onCardClick(card)"
                  >
                    {{ card.topic || 'Untitled Thread' }}
                  </span>
                </p>
                <SquarePen
                  class="flex-shrink-0 w-3.5 h-3.5 text-neutral-400 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:text-blue-400 rounded pointer-events-auto cursor-pointer"
                  title="Edit details"
                  @click.stop="send({ type: 'SELECT_THREAD', id: card.id })"
                />
              </div>
              <!-- <div class="flex items-center gap-2 mt-2">
                <span class="text-xs text-neutral-500">{{ card.date }}</span>
                <span class="text-xs text-neutral-600">•</span>
                <span class="text-xs text-neutral-500">{{ card.time }}</span>
              </div> -->
              <div v-if="card.tags && card.tags.length > 0" class="flex flex-wrap gap-1 mt-2 pointer-events-none">
                <span
                  v-for="tag in card.tags"
                  :key="tag"
                  class="px-2 py-0.5 text-xs rounded-full bg-neutral-700/50 text-neutral-300"
                >
                  {{ tag }}
                </span>
              </div>
            </article>
          </template>
          <template #after>
            <div class="after-spacer" />
          </template>
        </ArrangeableList>
      </section>
    </div>
  </main>
  </div>
</template>

<style scoped>
:deep(.cursor-grabbing) {
  position: fixed !important;
}

/* Make the #after slot's <li> wrapper grow to fill remaining column space */
.kanban-list :deep(li:has(> .after-spacer)) {
  flex: 1;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
