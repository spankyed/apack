<template>
  <div>
    <!-- Drop indicator: before -->
    <div
      v-if="showDropBefore"
      class="h-0.5 bg-blue-500 mx-2 rounded-full pointer-events-none"
      :style="{ marginLeft: `${depth * INDENT_PX + BASE_PADDING_PX}px` }"
    />
    <!-- Node row -->
    <div
      data-note-tree-item
      class="mx-1 relative flex items-center gap-1 px-2 py-2 rounded-md cursor-pointer text-sm transition-colors group"
      :class="[
        note.id === currentNoteId
          ? taskMode && (note.completed || muted) ? 'bg-neutral-700 text-neutral-400' : 'bg-neutral-700 text-neutral-100'
          : taskMode && (note.completed || muted) ? 'text-neutral-600 hover:bg-neutral-800' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
        ownItemClass,
      ]"
      :style="{ paddingLeft: `${depth * INDENT_PX + BASE_PADDING_PX}px` }"
      :draggable="!(taskMode && (note.completed || muted) && depth === 0)"
      @click="handleClick"
      @dblclick="$emit('open', note.id)"
      @contextmenu="handleContextMenu"
      @dragstart="$emit('drag-start', $event, note.id)"
      @dragover="$emit('drag-over', $event, note.id)"
      @dragleave="$emit('drag-leave', $event)"
      @drop="$emit('drop', $event, note.id)"
      @dragend="$emit('drag-end')"
    >
      <!-- Note icon / Expand chevron -->
      <EmojiPicker :model-value="note.icon" @update:model-value="(icon: string | null) => $emit('update-icon', note.id, icon)">
        <template #default="{ toggle }">
          <button
            class="flex items-center justify-center w-5 h-5 shrink-0"
            @click.stop="children.length > 0 ? $emit('toggle-expand', note.id) : toggle()"
          >
            <!-- Chevron: always visible when showCollapseIcon + has children, otherwise on hover -->
            <ChevronRight
              v-if="children.length > 0"
              :size="16"
              class="transition-transform text-neutral-500"
              :class="[
                isExpanded ? 'rotate-90' : '',
                showCollapseIcon ? 'block' : 'hidden group-hover:block',
              ]"
            />
            <!-- Note icon: hidden entirely when showCollapseIcon + has children -->
            <template v-if="!(showCollapseIcon && children.length > 0)">
              <span
                v-if="note.icon"
                class="text-sm leading-none"
                :class="children.length > 0 ? 'group-hover:hidden' : ''"
              >{{ note.icon }}</span>
              <ListChecks
                v-else-if="note.noteType === 'tasklist'"
                :size="16"
                class="text-neutral-500"
                :class="children.length > 0 ? 'group-hover:hidden' : ''"
              />
              <CircleCheck
                v-else-if="note.noteType === 'task'"
                :size="16"
                class="text-neutral-500"
                :class="children.length > 0 ? 'group-hover:hidden' : ''"
              />
              <FileText
                v-else
                :size="16"
                class="text-neutral-500"
                :class="children.length > 0 ? 'group-hover:hidden' : ''"
              />
            </template>
          </button>
        </template>
      </EmojiPicker>

      <!-- Title -->
      <span class="truncate flex-1 ml-0.5" :class="note.completed ? 'line-through' : ''">{{ note.title || 'Untitled' }}</span>

      <!-- Task checkbox (taskMode only, before action pill) -->
      <template v-if="taskMode && note.noteType === 'task'">
        <!-- Grouped action pill (visible on hover) -->
        <div class="items-center gap-0.5 bg-neutral-700/50 rounded-md px-1 shrink-0 mr-1" :class="dropdownOpen ? 'flex' : 'hidden group-hover:flex'" @dblclick.stop>
          <DropdownMenuRoot v-model:open="dropdownOpen">
            <DropdownMenuTrigger as-child>
              <button
                class="flex items-center justify-center w-5 h-5 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-600/50 rounded transition-colors"
                title="More actions"
                @click.stop
              >
                <MoreHorizontal :size="13" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                class="bg-neutral-800 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[140px] z-50"
                :side-offset="4"
              >
                <DropdownMenuItem
                  v-for="item in menuItems"
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
            class="flex items-center justify-center w-5 h-5 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-600/50 rounded transition-colors"
            title="Add sub-task"
            @click.stop="$emit('create-task', note.id)"
          >
            <Plus :size="13" />
          </button>
        </div>
        <!-- Checkbox (always visible) -->
        <button
          class="flex items-center justify-center w-4 h-4 shrink-0 rounded border transition-colors"
          :class="note.completed
            ? 'border-neutral-600 bg-neutral-700'
            : 'border-neutral-500 hover:border-neutral-300'"
          @click.stop="$emit('toggle-complete', note.id)"
        >
          <Check v-if="note.completed" :size="10" class="text-neutral-400" />
        </button>
      </template>

      <!-- Actions (on hover, normal mode) -->
      <div v-else class="items-center gap-0.5 bg-neutral-700/50 rounded-md px-1" :class="dropdownOpen ? 'flex' : 'hidden group-hover:flex'" @dblclick.stop>
        <DropdownMenuRoot v-model:open="dropdownOpen">
          <DropdownMenuTrigger as-child>
            <button
              class="flex items-center justify-center w-5 h-5 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-600/50 rounded transition-colors"
              title="More actions"
              @click.stop
            >
              <MoreHorizontal :size="13" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              class="bg-neutral-800 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[140px] z-50"
              :side-offset="4"
            >
              <DropdownMenuItem
                v-for="item in menuItems"
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
          class="flex items-center justify-center w-5 h-5 text-neutral-500 hover:text-neutral-200 hover:bg-neutral-600/50 rounded transition-colors"
          :title="isTaskRelated ? 'Add task' : 'Add document'"
          @click.stop="isTaskRelated ? $emit('create-task', note.id) : $emit('create', note.id)"
        >
          <Plus :size="13" />
        </button>
      </div>

    </div>

    <!-- Context menu (positioned at cursor) -->
    <ContextMenuPopup
      :show="showContextMenu"
      :pos="contextMenuPos"
      :items="menuItems"
      @close="showContextMenu = false"
    />

    <!-- Drop indicator: after (only when not expanded, to avoid ambiguity) -->
    <div
      v-if="showDropAfter && !isExpanded"
      class="h-0.5 bg-blue-500 mx-2 rounded-full pointer-events-none"
      :style="{ marginLeft: `${depth * INDENT_PX + BASE_PADDING_PX}px` }"
    />
    <!-- Children (recursive) -->
    <div
      v-if="isExpanded && children.length > 0"
      class="relative"
      :style="showCollapseIcon ? { paddingLeft: `${GUIDE_INDENT_PX}px` } : undefined"
    >
      <!-- Indent guideline spanning all children -->
      <div
        v-if="showCollapseIcon"
        class="absolute top-0 bottom-0 w-px bg-neutral-700/40 pointer-events-none"
        :style="{ left: `${depth * INDENT_PX + BASE_PADDING_PX + 14}px` }"
      />
      <NoteTreeItem
        v-for="child in children"
        :key="child.id"
        :note="child"
        :all-notes="allNotes"
        :current-note-id="currentNoteId"
        :expanded-node-ids="expandedNodeIds"
        :depth="depth + 1"
        :get-item-class="getItemClass"
        :task-mode="taskMode"
        :muted="false"
        :drop-indicator-note-id="dropIndicatorNoteId"
        :drop-indicator-position="dropIndicatorPosition"
        :show-collapse-icon="showCollapseIcon"
        @select="$emit('select', $event)"
        @toggle-expand="$emit('toggle-expand', $event)"
        @create="$emit('create', $event)"
        @delete="$emit('delete', $event)"
        @update-icon="(noteId: string, icon: string | null) => $emit('update-icon', noteId, icon)"
        @toggle-select="$emit('toggle-select', $event)"
        @shift-select="$emit('shift-select', $event)"
        @toggle-complete="$emit('toggle-complete', $event)"
        @create-task="$emit('create-task', $event)"
        @drag-start="(e: DragEvent, id: string) => $emit('drag-start', e, id)"
        @drag-over="(e: DragEvent, id: string) => $emit('drag-over', e, id)"
        @drag-leave="(e: DragEvent) => $emit('drag-leave', e)"
        @drop="(e: DragEvent, id: string) => $emit('drop', e, id)"
        @drag-end="$emit('drag-end')"
        @open="$emit('open', $event)"
        @toggle-hide-completed="$emit('toggle-hide-completed', $event)"
        @create-tasklist="$emit('create-tasklist', $event)"
        @toggle-favorite="$emit('toggle-favorite', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NoteSummary } from '#generated/types.ts'
import { Check, ChevronRight, CircleCheck, Copy, Eye, EyeOff, FileText, FilePlus, ListChecks, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-vue-next'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui'
import EmojiPicker from '@apackdev/ui/design/EmojiPicker'
import ContextMenuPopup from '@apackdev/ui/design/ContextMenuPopup'
import { useContextMenu, type MenuItem } from '@apackdev/ui/composables/useContextMenu'
import { useTrackedMenuOpen } from '@apackdev/sdk/fe'

const INDENT_PX = 8
const BASE_PADDING_PX = 8
const GUIDE_INDENT_PX = 12

const props = withDefaults(defineProps<{
  note: NoteSummary
  allNotes: NoteSummary[]
  currentNoteId: string | null
  expandedNodeIds: string[]
  depth: number
  getItemClass: (noteId: string) => string
  taskMode?: boolean
  muted?: boolean
  dropIndicatorNoteId?: string | null
  dropIndicatorPosition?: 'before' | 'after' | null
  showCollapseIcon?: boolean
}>(), {
  taskMode: false,
  muted: false,
  dropIndicatorNoteId: null,
  dropIndicatorPosition: null,
  showCollapseIcon: false,
})

const emit = defineEmits<{
  (e: 'select', noteId: string): void
  (e: 'toggle-expand', nodeId: string): void
  (e: 'create', parentId: string): void
  (e: 'delete', noteId: string): void
  (e: 'update-icon', noteId: string, icon: string | null): void
  (e: 'toggle-select', noteId: string): void
  (e: 'drag-start', event: DragEvent, noteId: string): void
  (e: 'drag-over', event: DragEvent, noteId: string): void
  (e: 'drag-leave', event: DragEvent): void
  (e: 'drop', event: DragEvent, noteId: string): void
  (e: 'drag-end'): void
  (e: 'shift-select', noteId: string): void
  (e: 'toggle-complete', noteId: string): void
  (e: 'create-task', parentId: string): void
  (e: 'open', noteId: string): void
  (e: 'toggle-hide-completed', nodeId: string): void
  (e: 'create-tasklist', parentId: string): void
  (e: 'toggle-favorite', noteId: string): void
}>()

function handleClick(e: MouseEvent) {
  if (e.shiftKey) {
    emit('shift-select', props.note.id)
  } else if (e.ctrlKey || e.metaKey) {
    emit('toggle-select', props.note.id)
  } else {
    emit('select', props.note.id)
  }
}

const isTaskRelated = computed(() => props.note.noteType === 'tasklist' || props.note.noteType === 'task')

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []
  if (isTaskRelated.value) {
    items.push({ label: 'Add Document', icon: FilePlus, class: 'text-neutral-300', action: () => emit('create', props.note.id) })
  }
  if (!isTaskRelated.value) {
    items.push({ label: 'Add Tasklist', icon: ListChecks, class: 'text-neutral-300', action: () => emit('create-tasklist', props.note.id) })
  }
  if (hasCompletedChildren.value) {
    items.push({
      label: isHidingCompleted.value ? 'Show Completed' : 'Hide Completed',
      icon: isHidingCompleted.value ? Eye : EyeOff,
      class: 'text-neutral-300',
      action: () => emit('toggle-hide-completed', props.note.id),
    })
  }
  items.push({
    label: props.note.favorite ? 'Remove from Favorites' : 'Add to Favorites',
    icon: Star,
    class: 'text-neutral-300',
    iconClass: props.note.favorite ? 'text-yellow-400' : undefined,
    action: () => emit('toggle-favorite', props.note.id),
  })
  items.push({ label: 'Copy Id', icon: Copy, class: 'text-neutral-300', action: () => navigator.clipboard.writeText(props.note.id) })
  items.push({ label: 'Delete', icon: Trash2, class: 'text-red-400', iconClass: 'text-red-400', action: () => emit('delete', props.note.id) })
  return items
})

const dropdownOpen = ref(false)
useTrackedMenuOpen(dropdownOpen)
const { showMenu: showContextMenu, menuPos: contextMenuPos, open: openContextMenu } = useContextMenu()

function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  openContextMenu(e, menuItems.value.length)
}

const showDropBefore = computed(() => props.dropIndicatorNoteId === props.note.id && props.dropIndicatorPosition === 'before')
const showDropAfter = computed(() => props.dropIndicatorNoteId === props.note.id && props.dropIndicatorPosition === 'after')

const ownItemClass = computed(() => props.getItemClass(props.note.id))

const isExpanded = computed(() => props.expandedNodeIds.includes(props.note.id))

const allChildren = computed(() =>
  props.allNotes
    .filter(n => n.parentId === props.note.id)
    .sort((a, b) => a.displayOrder - b.displayOrder)
)

const isHidingCompleted = computed(() => props.note.hideCompletedChildren)

const hasCompletedChildren = computed(() =>
  props.taskMode && allChildren.value.some(c => c.completed)
)

const children = computed(() => {
  if (props.taskMode && isHidingCompleted.value) {
    return allChildren.value.filter(c => !c.completed)
  }
  return allChildren.value
})
</script>
