<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div
      class="relative z-20 flex items-center justify-between h-header px-4 border-b border-neutral-800"
      :class="{ 'panel-drag': !dropdownOpen }"
      @dragover.prevent="!showTrash && handleRootDragOver($event)"
      @drop="!showTrash && handleRootDrop($event)"
    >
      <div class="flex items-center gap-1.5">
        <button
          v-if="showTrash"
          class="flex items-center justify-center w-5 h-5 text-neutral-400 hover:text-neutral-200 transition-colors rounded"
          title="Back to Notes"
          @click="handleHideTrash"
        >
          <ArrowLeft :size="14" />
        </button>
        <span class="text-sm font-medium text-neutral-300">{{ showTrash ? 'Trash' : 'Notes' }}</span>
      </div>
      <div class="flex items-center gap-0.5">
        <template v-if="showTrash">
          <button
            v-if="trashedNotes.length > 0"
            class="flex items-center justify-center px-2 h-6 text-xs text-red-400 hover:text-red-300 hover:bg-neutral-700/50 transition-colors rounded"
            title="Empty Trash"
            @click="handleEmptyTrash"
          >
            Empty
          </button>
        </template>
        <template v-else>
          <button
            class="flex items-center justify-center w-6 h-6 text-neutral-400 hover:text-neutral-200 transition-colors rounded"
            title="New Document"
            @click="handleCreateNote()"
            @contextmenu.prevent="handleCreateTaskList()"
          >
            <Plus :size="16" />
          </button>
          <button
            class="flex items-center justify-center w-6 h-6 text-neutral-400 hover:text-neutral-200 transition-colors rounded"
            :class="searchActive && 'text-neutral-200 bg-neutral-700'"
            title="Search notes"
            @click="toggleSearch"
          >
            <Search :size="16" />
          </button>
          <DropdownMenuRoot v-model:open="dropdownOpen">
            <DropdownMenuTrigger as-child>
              <button
                class="flex items-center justify-center w-6 h-6 text-neutral-400 hover:text-neutral-200 transition-colors rounded"
                title="More actions"
                @click.stop
              >
                <MoreVertical :size="16" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                class="bg-neutral-800 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[140px] z-50"
                :side-offset="4"
              >
                <DropdownMenuItem
                  v-for="item in createMenuItems"
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
        </template>
      </div>
    </div>

    <!-- Trash View -->
    <template v-if="showTrash">
      <div class="flex-1 overflow-y-auto p-3 px-2">
        <div v-if="trashedNotes.length === 0" class="px-3 py-4 text-sm text-neutral-500 text-center">
          Trash is empty
        </div>
        <div
          v-for="note in trashedNotes"
          :key="note.id"
          class="group flex items-center gap-2 px-3 py-1.5 rounded text-sm text-neutral-400 hover:bg-neutral-800 cursor-default"
        >
          <span v-if="note.icon" class="shrink-0 text-xs">{{ note.icon }}</span>
          <span class="truncate flex-1">{{ note.title || 'Untitled' }}</span>
          <span class="shrink-0 text-[10px] text-neutral-600">{{ formatDeletedAge(note.trashedAt) }}</span>
          <div class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              class="flex items-center justify-center w-5 h-5 text-neutral-500 hover:text-neutral-200 rounded"
              title="Restore"
              @click="handleRestoreNote(note.id)"
            >
              <Undo2 :size="12" />
            </button>
            <button
              class="flex items-center justify-center w-5 h-5 text-neutral-500 hover:text-red-400 rounded"
              title="Delete permanently"
              @click="handlePermanentlyDelete(note.id)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Normal View -->
    <template v-else>
      <!-- Search Input -->
      <div v-if="searchActive" class="px-3 py-2 border-b border-neutral-800">
        <div class="relative">
          <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            placeholder="Search notes..."
            class="w-full pl-8 pr-7 py-1.5 text-sm bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-500 outline-none focus:border-neutral-500"
            @focus="($event.target as HTMLInputElement).select()"
            @keydown.escape="toggleSearch"
            @keydown.down.prevent="highlightedIndex = Math.min(highlightedIndex + 1, filteredNotes.length - 1)"
            @keydown.up.prevent="highlightedIndex = Math.max(highlightedIndex - 1, 0)"
            @keydown.enter.prevent="filteredNotes.length > 0 && handleSelectNote(filteredNotes[highlightedIndex].id)"
          />
          <button
            class="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
            @click="toggleSearch"
          >
            <X :size="14" />
          </button>
        </div>
      </div>

      <!-- Search Results -->
      <div v-if="searchActive && searchQuery.trim()" ref="searchResultsRef" class="flex-1 overflow-y-auto overflow-x-hidden p-2">
        <div v-if="filteredNotes.length === 0" class="px-3 py-4 text-sm text-neutral-500 text-center">
          No notes found
        </div>
        <button
          v-for="(note, index) in filteredNotes"
          :key="note.id"
          class="w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-neutral-300 transition-colors text-left"
          :class="index === highlightedIndex ? 'bg-neutral-700' : 'hover:bg-neutral-800'"
          @click="handleSelectNote(note.id)"
          @mouseenter="highlightedIndex = index"
        >
          <span v-if="note.icon" class="shrink-0 text-xs">{{ note.icon }}</span>
          <ListChecks v-else-if="note.noteType === 'tasklist'" :size="14" class="text-neutral-500 shrink-0" />
          <CircleCheck v-else-if="note.noteType === 'task'" :size="14" class="text-neutral-500 shrink-0" />
          <FileText v-else :size="14" class="text-neutral-500 shrink-0" />
          <span class="truncate">{{ note.title || 'Untitled' }}</span>
        </button>
      </div>

      <div v-else class="flex-1 overflow-y-auto overflow-x-hidden">
      <!-- Favorites -->
      <div v-if="showFavorites && favoriteNotes.length > 0" class="border-b border-neutral-800 px-2 py-3">
        <button
          class="group flex items-center gap-2 px-1.5 w-full text-left ml-2.5"
          :class="favoritesExpanded && 'mb-1'"
          @click="favoritesExpanded = !favoritesExpanded"
        >
          <span class="relative shrink-0 w-[12px] h-[12px]">
            <Star :size="12" class="absolute inset-0 text-yellow-500/60 transition-opacity group-hover:opacity-0" />
            <ChevronRight
              :size="12"
              class="absolute inset-0 text-neutral-500 opacity-0 transition-all duration-150 group-hover:opacity-100"
              :class="favoritesExpanded && 'rotate-90'"
            />
          </span>
          <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Favorites</span>
        </button>
        <template v-if="favoritesExpanded">
          <NoteTreeItem
            v-for="fav in favoriteNotes"
            :key="fav.id"
            :note="fav"
            :all-notes="notes"
            :current-note-id="currentNoteId"
            :expanded-node-ids="expandedNodeIds"
            :depth="0"
            :get-item-class="getItemClass"
            :drop-indicator-note-id="dropIndicator?.noteId ?? null"
            :drop-indicator-position="dropIndicator?.position ?? null"
            :show-collapse-icon="showCollapseIcon"
            @select="handleSelectNote"
            @toggle-expand="handleToggleExpand"
            @create="handleCreateNote"
            @delete="handleDeleteNote"
            @update-icon="handleUpdateIcon"
            @toggle-select="handleToggleSelect"
            @shift-select="handleShiftSelect"
            @drag-start="handleDragStart"
            @drag-over="handleDragOver"
            @drag-leave="handleDragLeave"
            @drop="(e: DragEvent, id: string) => handleDrop(e, id)"
            @drag-end="handleDragEnd"
            @create-task="handleCreateTask"
            @open="handleOpenNote"
            @create-tasklist="handleCreateTaskList"
            @toggle-favorite="handleToggleFavorite"
          />
        </template>
      </div>

      <!-- Tree -->
      <div
        class="p-3 px-2"
        @click="handleOutsideClick"
        @dragover.prevent="handleRootDragOver"
        @drop="handleRootDrop"
      >
        <div v-if="rootNotes.length === 0" class="px-3 py-4 text-sm text-neutral-500 text-center">
          No notes yet
        </div>
        <NoteTreeItem
          v-for="note in rootNotes"
          :key="note.id"
          :note="note"
          :all-notes="notes"
          :current-note-id="currentNoteId"
          :expanded-node-ids="expandedNodeIds"
          :depth="0"
          :get-item-class="getItemClass"
          :drop-indicator-note-id="dropIndicator?.noteId ?? null"
          :drop-indicator-position="dropIndicator?.position ?? null"
          :show-collapse-icon="showCollapseIcon"
          @select="handleSelectNote"
          @toggle-expand="handleToggleExpand"
          @create="handleCreateNote"
          @delete="handleDeleteNote"
          @update-icon="handleUpdateIcon"
          @toggle-select="handleToggleSelect"
          @shift-select="handleShiftSelect"
          @drag-start="handleDragStart"
          @drag-over="handleDragOver"
          @drag-leave="handleDragLeave"
          @drop="(e: DragEvent, id: string) => handleDrop(e, id)"
          @drag-end="handleDragEnd"
          @create-task="handleCreateTask"
          @open="handleOpenNote"
          @create-tasklist="handleCreateTaskList"
          @toggle-favorite="handleToggleFavorite"
        />
      </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useView } from '#generated/fe.ts'
import { useSettings } from '#generated/settings-fe.ts'
import { computed, ref, nextTick, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { type NotesState } from './state.ts'
import NoteTreeItem from './components/NoteTreeItem.vue'
import { Plus, ListChecks, MoreVertical, Star, ChevronRight, Trash2, ArrowLeft, Undo2, Search, X, FileText, CircleCheck } from 'lucide-vue-next'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui'
import { useNoteTreeDragDrop } from './composables/useNoteTreeDragDrop.ts'
import type { MenuItem } from '@apackdev/ui/composables/useContextMenu'
import { useTrackedMenuOpen, useSurface } from '@apackdev/sdk/fe'

const actor: NotesState = useSurface()

const dropdownOpen = ref(false)
const favoritesExpanded = ref(true)
const showFavorites = ref(true)
const searchActive = useSelector(actor, (s) => s.context.panelSearchActive)
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const highlightedIndex = ref(0)
const searchResultsRef = ref<HTMLElement | null>(null)
useTrackedMenuOpen(dropdownOpen)

const createMenuItems = computed<MenuItem[]>(() => [
  { label: 'New TaskList', icon: ListChecks, class: 'text-neutral-300', action: () => handleCreateTaskList() },
  { label: showFavorites.value ? 'Hide Favorites' : 'Show Favorites', icon: Star, class: 'text-neutral-300', iconClass: 'text-yellow-500/60', action: () => { showFavorites.value = !showFavorites.value } },
  { label: 'Trash', icon: Trash2, class: 'text-neutral-300', action: () => handleShowTrash() },
])
const notes = useSelector(actor, (s) => s.context.notes)
const currentNoteId = useSelector(actor, (s) => s.context.currentNoteId)
const expandedNodeIds = useSelector(actor, (s) => s.context.expandedNodeIds)
const selectedNoteIds = useSelector(actor, (s) => s.context.selectedNoteIds)
const settings = useSettings('notes')
const showCollapseIcon = computed(() => settings.value.value?.showCollapseIcon ?? false)
const showTrash = useSelector(actor, (s) => s.context.showTrash)
// The trash, which the panel's trash button counts whether or not it is open
const trash = useView('notes', 'trash')
const trashedNotes = computed(() => trash.data ?? [])

const rootNotes = computed(() =>
  notes.value
    .filter(n => !n.parentId)
    .sort((a, b) => a.displayOrder - b.displayOrder)
)

const favoriteNotes = computed(() => notes.value.filter(n => n.favorite))

const filteredNotes = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return notes.value.filter(n => n.title?.toLowerCase().includes(q))
})

function toggleSearch() {
  actor.send({ type: 'NOTE.TOGGLE_PANEL_SEARCH' })
}

watch(searchActive, (active) => {
  if (active) {
    nextTick(() => searchInputRef.value?.focus())
  } else {
    searchQuery.value = ''
  }
})

watch(searchQuery, () => {
  highlightedIndex.value = 0
})

watch(highlightedIndex, () => {
  nextTick(() => {
    const container = searchResultsRef.value
    if (!container) return
    const items = container.querySelectorAll('button')
    items[highlightedIndex.value]?.scrollIntoView({ block: 'nearest' })
  })
})

function handleToggleFavorite(noteId: string) {
  actor.send({ type: 'NOTE.TOGGLE_FAVORITE', noteId })
}

const {
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  cancelDragLeave,
  getItemClass,
  dropIndicator,
} = useNoteTreeDragDrop({
  notes,
  selectedNoteIds,
  currentNoteId,
  expandedNodeIds,
  onMove: (noteIds, newParentId) => {
    actor.send({ type: 'NOTE.MOVE', noteIds, newParentId })
  },
  onReorder: (noteId, newParentId, newIndex) => {
    actor.send({ type: 'NOTE.REORDER', noteId, newParentId, newIndex })
  },
  onFileDrop: (files, parentId, index) => {
    for (const [i, file] of files.entries()) {
      actor.send({ type: 'NOTE.CREATE', title: file.title, content: file.content, parentId: parentId ?? undefined, displayOrder: index + i })
    }
  },
})

const visibleNodeIds = computed(() => {
  const result: string[] = []
  function walk(parentId: string | null) {
    const children = notes.value
      .filter(n => (n.parentId ?? null) === parentId)
      .sort((a, b) => a.displayOrder - b.displayOrder)
    for (const child of children) {
      result.push(child.id)
      if (expandedNodeIds.value.includes(child.id)) {
        walk(child.id)
      }
    }
  }
  walk(null)
  return result
})

function handleShiftSelect(noteId: string) {
  const visible = visibleNodeIds.value
  const anchor = currentNoteId.value
  if (!anchor) {
    handleSelectNote(noteId)
    return
  }
  const anchorIdx = visible.indexOf(anchor)
  const targetIdx = visible.indexOf(noteId)
  if (anchorIdx === -1 || targetIdx === -1) {
    handleSelectNote(noteId)
    return
  }
  const start = Math.min(anchorIdx, targetIdx)
  const end = Math.max(anchorIdx, targetIdx)
  const rangeIds = visible.slice(start, end + 1)
  actor.send({ type: 'NOTE.RANGE_SELECT', noteIds: rangeIds })
}

function handleSelectNote(noteId: string) {
  actor.send({ type: 'NOTE.SELECT', noteId })
}

function handleOpenNote(noteId: string) {
  actor.send({ type: 'NOTE.OPEN', noteId })
}

function handleToggleSelect(noteId: string) {
  actor.send({ type: 'NOTE.TOGGLE_SELECT', noteId })
}

function handleToggleExpand(nodeId: string) {
  actor.send({ type: 'NOTE.TOGGLE_EXPAND', nodeId })
}

function handleCreateNote(parentId?: string) {
  actor.send({ type: 'NOTE.CREATE', parentId })
}

function handleCreateTaskList(parentId?: string) {
  actor.send({ type: 'NOTE.CREATE_TASKLIST', parentId })
}

function handleCreateTask(parentId: string) {
  actor.send({ type: 'TASK.CREATE', parentId })
}

function handleDeleteNote(noteId: string) {
  actor.send({ type: 'NOTE.DELETE', noteId })
}

function handleUpdateIcon(noteId: string, icon: string | null) {
  actor.send({ type: 'NOTE.UPDATE_ICON', noteId, icon })
}

function handleShowTrash() {
  actor.send({ type: 'NOTE.SHOW_TRASH' })
}

function handleHideTrash() {
  actor.send({ type: 'NOTE.HIDE_TRASH' })
}

function handleRestoreNote(noteId: string) {
  actor.send({ type: 'NOTE.RESTORE', noteId })
}

function handlePermanentlyDelete(noteId: string) {
  actor.send({ type: 'NOTE.PERMANENTLY_DELETE', noteId })
}

function handleEmptyTrash() {
  actor.send({ type: 'NOTE.EMPTY_TRASH' })
}

function formatDeletedAge(trashedAt?: number): string {
  if (!trashedAt) return ''
  const days = Math.floor((Date.now() - trashedAt) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('[data-note-tree-item]')) {
    actor.send({ type: 'NOTE.CLEAR_SELECTION' })
  }
}

function handleRootDragOver(e: DragEvent) {
  cancelDragLeave()
  if (e.dataTransfer) {
    // Accept external file drags at root level too
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    } else {
      e.dataTransfer.dropEffect = 'move'
    }
  }
}

function handleRootDrop(e: DragEvent) {
  handleDrop(e, null)
}
</script>

<style scoped>
.panel-drag {
  -webkit-app-region: drag;
  user-select: none;
}

.panel-drag button {
  -webkit-app-region: no-drag;
}
</style>
