<template>
  <div :class="['flex flex-col h-full w-[250px] min-w-[250px] border-neutral-800', panelPosition === 'right' ? 'border-l' : 'border-r']">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-neutral-800 cursor-pointer transition-colors"
      :class="!selectedTaskId ? 'bg-neutral-700' : 'hover:bg-neutral-800'"
      @click="$emit('deselect-task')"
      @contextmenu.prevent="handleHeaderContextMenu"
      @dragover.prevent="handleRootDragOver"
      @drop="handleRootDrop"
    >
      <div
        class="flex items-center gap-1.5 flex-1 min-w-0 text-sm font-medium transition-colors rounded px-1 -ml-1"
        :class="!selectedTaskId ? 'text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'"
      >
        <span v-if="currentNoteIcon" class="text-sm leading-none shrink-0">{{ currentNoteIcon }}</span>
        <ListChecks v-else :size="16" class="text-neutral-500 shrink-0" />
        <span class="truncate">{{ currentNoteTitle || 'Untitled' }}</span>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <DropdownMenuRoot v-model:open="dropdownOpen">
          <DropdownMenuTrigger as-child>
            <button
              class="flex items-center justify-center w-6 h-6 text-neutral-400 hover:text-neutral-200 transition-colors rounded"
              title="More actions"
              @click.stop
            >
              <MoreHorizontal :size="16" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              class="bg-neutral-800 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[140px] z-50"
              :side-offset="4"
            >
              <DropdownMenuItem
                v-for="item in headerMenuItems"
                :key="item.label"
                class="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-neutral-700 transition-colors cursor-pointer"
                :class="item.class"
                @select="item.action"
              >
                <component :is="item.icon" :size="14" class="shrink-0" :class="item.iconClass || 'text-neutral-500'" />
                {{ item.label }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <button
          class="flex items-center justify-center w-6 h-6 text-neutral-400 hover:text-neutral-200 transition-colors rounded"
          title="Add task"
          @click.stop="$emit('create-task')"
        >
          <Plus :size="16" />
        </button>
      </div>
    </div>

    <!-- Header context menu -->
    <ContextMenuPopup
      :show="showHeaderMenu"
      :pos="headerMenuPos"
      :items="headerMenuItems"
      @close="showHeaderMenu = false"
    />

    <!-- Task list -->
    <div
      class="flex-1 overflow-y-auto py-1"
      @dragover.prevent="handleRootDragOver"
      @drop="handleRootDrop"
    >

      <!-- Incomplete tasks -->
      <NoteTreeItem
        v-for="task in incompleteTasks"
        :key="task.id"
        :note="task"
        :all-notes="allNotes"
        :current-note-id="selectedTaskId"
        :expanded-node-ids="expandedNodeIds"
        :depth="0"
        :get-item-class="getItemClass"
        :task-mode="true"

        :drop-indicator-note-id="dropIndicator?.noteId ?? null"
        :drop-indicator-position="dropIndicator?.position ?? null"
        :show-collapse-icon="showCollapseIcon"
        @select="(id: string) => $emit('select-task', id)"
        @toggle-expand="(nodeId: string) => $emit('toggle-expand', nodeId)"
        @delete="(id: string) => $emit('delete-task', id)"
        @toggle-complete="(id: string) => $emit('toggle-complete', id)"
        @update-icon="(noteId: string, icon: string | null) => $emit('update-icon', noteId, icon)"
        @create-task="(parentId: string) => $emit('create-task-child', parentId)"
        @create="(parentId: string) => $emit('create-subnote', parentId)"
        @open="(noteId: string) => $emit('open-note', noteId)"
        @toggle-hide-completed="(nodeId: string) => $emit('toggle-hide-completed', nodeId)"
        @toggle-favorite="(id: string) => $emit('toggle-favorite', id)"
        @drag-start="handleDragStart"
        @drag-over="handleDragOver"
        @drag-leave="handleDragLeave"
        @drop="handleDrop"
        @drag-end="handleDragEnd"
      />

      <!-- Completed section -->
      <template v-if="showCompleted && completedTasks.length > 0">
        <div v-if="incompleteTasks.length > 0" class="border-b border-neutral-800 mx-3 my-1" />
        <NoteTreeItem
          v-for="task in completedTasks"
          :key="task.id"
          :note="task"
          :all-notes="allNotes"
          :current-note-id="selectedTaskId"
          :expanded-node-ids="expandedNodeIds"
          :depth="0"
          :get-item-class="getItemClass"
          :task-mode="true"
          :muted="true"

          :drop-indicator-note-id="dropIndicator?.noteId ?? null"
          :drop-indicator-position="dropIndicator?.position ?? null"
          :show-collapse-icon="showCollapseIcon"
          @select="(id: string) => $emit('select-task', id)"
          @toggle-expand="(nodeId: string) => $emit('toggle-expand', nodeId)"
          @delete="(id: string) => $emit('delete-task', id)"
          @toggle-complete="(id: string) => $emit('toggle-complete', id)"
          @update-icon="(noteId: string, icon: string | null) => $emit('update-icon', noteId, icon)"
          @create-task="(parentId: string) => $emit('create-task-child', parentId)"
          @create="(parentId: string) => $emit('create-subnote', parentId)"
          @open="(noteId: string) => $emit('open-note', noteId)"
          @toggle-hide-completed="(nodeId: string) => $emit('toggle-hide-completed', nodeId)"
          @toggle-favorite="(id: string) => $emit('toggle-favorite', id)"
          @drag-start="handleDragStart"
          @drag-over="handleDragOver"
          @drag-leave="handleDragLeave"
          @drop="handleDrop"
          @drag-end="handleDragEnd"
        />
      </template>

      <!-- Empty state -->
      <div v-if="incompleteTasks.length === 0 && (!showCompleted || completedTasks.length === 0)" class="px-3 py-4 text-xs text-neutral-500 text-center">
        No tasks yet
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NoteSummary } from '#generated/types.ts'
import { Copy, Plus, ListChecks, Eye, EyeOff, FilePlus, MoreHorizontal, Trash2 } from 'lucide-vue-next'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui'
import NoteTreeItem from './NoteTreeItem.vue'
import ContextMenuPopup from '@apackdev/ui/design/ContextMenuPopup'
import { useNoteTreeDragDrop } from '../composables/useNoteTreeDragDrop.ts'
import { useContextMenu, type MenuItem } from '@apackdev/ui/composables/useContextMenu'
import { useTrackedMenuOpen } from '@apackdev/sdk/fe'

const props = defineProps<{
  tasks: NoteSummary[]
  allNotes: NoteSummary[]
  selectedTaskId: string | null
  expandedNodeIds: string[]
  currentNoteId: string | null
  currentNoteTitle: string
  currentNoteIcon: string | null
  showCompleted: boolean
  panelPosition?: 'left' | 'right'
  showCollapseIcon?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-task', taskId: string): void
  (e: 'deselect-task'): void
  (e: 'create-task'): void
  (e: 'create-task-child', parentId: string): void
  (e: 'delete-task', taskId: string): void
  (e: 'toggle-complete', taskId: string): void
  (e: 'toggle-show-completed'): void
  (e: 'toggle-expand', nodeId: string): void
  (e: 'move-task', noteIds: string[], newParentId: string | null): void
  (e: 'reorder-task', noteId: string, newParentId: string | null, newIndex: number): void
  (e: 'create-subnote', parentId: string): void
  (e: 'open-note', noteId: string): void
  (e: 'toggle-hide-completed', nodeId: string): void
  (e: 'update-icon', noteId: string, icon: string | null): void
  (e: 'delete-tasklist'): void
  (e: 'toggle-favorite', noteId: string): void
}>()

const { handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd, cancelDragLeave, getItemClass, dropIndicator } =
  useNoteTreeDragDrop({
    notes: computed(() => props.allNotes),
    selectedNoteIds: ref([]),
    currentNoteId: computed(() => props.selectedTaskId),
    expandedNodeIds: computed(() => props.expandedNodeIds),
    onMove: (noteIds, newParentId) => emit('move-task', noteIds, newParentId),
    onReorder: (noteId, newParentId, newIndex) => emit('reorder-task', noteId, newParentId, newIndex),
  })

const dropdownOpen = ref(false)
useTrackedMenuOpen(dropdownOpen)
const { showMenu: showHeaderMenu, menuPos: headerMenuPos, open: openHeaderMenu } = useContextMenu()

function handleHeaderContextMenu(e: MouseEvent) {
  openHeaderMenu(e, headerMenuItems.value.length)
}

const headerMenuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []
  items.push({ label: 'Add Document', icon: FilePlus, class: 'text-neutral-300', action: () => emit('create-subnote', props.currentNoteId!) })
  items.push({
    label: props.showCompleted ? 'Hide Completed' : 'Show Completed',
    icon: props.showCompleted ? EyeOff : Eye,
    class: 'text-neutral-300',
    action: () => emit('toggle-show-completed'),
  })
  items.push({ label: 'Copy Id', icon: Copy, class: 'text-neutral-300', action: () => navigator.clipboard.writeText(props.currentNoteId!) })
  items.push({ label: 'Delete', icon: Trash2, class: 'text-red-400', iconClass: 'text-red-400', action: () => emit('delete-tasklist') })
  return items
})

function handleRootDragOver(e: DragEvent) {
  cancelDragLeave()
  e.dataTransfer!.dropEffect = 'move'
}

function handleRootDrop(e: DragEvent) {
  handleDrop(e, props.currentNoteId)
}

const incompleteTasks = computed(() =>
  props.tasks
    .filter(t => !t.completed)
    .sort((a, b) => a.displayOrder - b.displayOrder)
)

const completedTasks = computed(() =>
  props.tasks
    .filter(t => t.completed)
    .sort((a, b) => a.displayOrder - b.displayOrder)
)
</script>
