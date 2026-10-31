<template>
  <div
    data-testid="notes-canvas"
    class="flex flex-col h-full relative"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover.prevent
    @drop.capture="handleFileDrop"
  >
    <!-- Drop overlay -->
    <div
      v-if="isDraggingFile"
      class="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500/50 pointer-events-none"
    >
      <div class="px-6 py-3 text-sm font-medium rounded-lg bg-neutral-800/90 text-blue-400">
        Drop file to create note
      </div>
    </div>
    <!-- Welcome State -->
    <div v-if="state.hasTag('welcome')" class="flex flex-col h-full overflow-y-auto">
      <!-- Empty state: no notes at all -->
      <template v-if="notes.length === 0">
        <div class="flex flex-col items-center pt-10 h-full gap-4 text-neutral-400">
          <NotebookText :size="48" class="text-neutral-600" />
          <p class="text-lg">Create your first note</p>
          <button
            class="px-4 py-2 text-sm bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded-lg transition-colors"
            @click="handleCreateNote()"
          >
            New Document
          </button>
        </div>
      </template>

      <!-- Home state: has notes -->
      <template v-else>
        <!-- Greeting -->
        <h1 class="text-3xl font-bold text-neutral-100 text-center pt-12 pb-6">{{ greeting }}</h1>

        <!-- Centered content column -->
        <div class="w-full max-w-2xl mx-auto px-6">
          <!-- Search bar + New note -->
          <div class="flex items-center gap-2 mb-6">
            <div class="relative flex-1">
              <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                v-model="searchQuery"
                placeholder="Search notes..."
                class="w-full pl-9 pr-3 py-2 text-sm bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-200 placeholder-neutral-500 outline-none focus:border-neutral-500"
              />
            </div>
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shrink-0"
              @click="handleCreateNote()"
            >
              <Plus :size="16" />
              <span>New note</span>
            </button>
          </div>

          <!-- Search results (when typing) -->
          <div v-if="searchQuery.trim()" class="flex-1">
            <div v-if="searchResults.length === 0" class="text-sm text-neutral-500 text-center py-8">
              No notes found
            </div>
            <button v-for="note in searchResults" :key="note.id"
              class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-neutral-300 hover:bg-neutral-800 transition-colors text-left"
              @click="handleSelectNote(note.id)"
            >
              <span v-if="note.icon" class="text-base">{{ note.icon }}</span>
              <ListChecks v-else-if="note.noteType === 'tasklist'" :size="16" class="text-neutral-500 shrink-0" />
              <CircleCheck v-else-if="note.noteType === 'task'" :size="16" class="text-neutral-500 shrink-0" />
              <FileText v-else :size="16" class="text-neutral-500 shrink-0" />
              <span class="truncate">{{ note.title || 'Untitled' }}</span>
            </button>
          </div>

          <!-- Recently visited + Favorites (when not searching) -->
          <div v-else class="pb-6">

          <!-- Recently visited cards -->
          <div class="flex items-center gap-2 mb-3">
            <Clock :size="16" class="text-neutral-500" />
            <p class="text-sm font-medium text-neutral-400">Recently visited</p>
          </div>
          <div v-if="recentNotes.length === 0" class="text-sm text-neutral-500 text-center py-8">
            No recently viewed notes
          </div>
          <div v-else class="relative mb-6">
            <!-- Left edge shadow + arrow -->
            <div
              v-show="canScrollLeft"
              class="absolute left-0 top-0 bottom-2 z-10 w-12 bg-gradient-to-r from-neutral-900/80 to-transparent group/left cursor-pointer"
              @click="scrollCarousel(-1)"
            >
              <button class="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-neutral-700 border border-neutral-600 shadow-lg hover:bg-neutral-600 transition-all opacity-0 group-hover/left:opacity-100">
                <ChevronLeft :size="16" class="text-neutral-200" />
              </button>
            </div>
            <div
              ref="carouselRef"
              class="flex gap-3 pb-2 overflow-x-auto scroll-smooth carousel-hide-scrollbar"
              @scroll="updateScrollState"
            >
              <button
                v-for="note in recentNotes" :key="note.id"
                class="flex-shrink-0 w-40 bg-neutral-800 hover:bg-neutral-750 rounded-xl p-4 flex flex-col justify-between text-left transition-colors border border-neutral-700/50 hover:border-neutral-600/50"
                style="min-height: 110px"
                @click="handleSelectNote(note.id)"
              >
                <div class="-ml-0.5">
                  <span v-if="note.icon" class="text-3xl leading-none">{{ note.icon }}</span>
                  <ListChecks v-else-if="note.noteType === 'tasklist'" :size="28" class="text-neutral-600" />
                  <CircleCheck v-else-if="note.noteType === 'task'" :size="28" class="text-neutral-600" />
                  <FileText v-else :size="28" class="text-neutral-600" />
                </div>
                <div class="mt-1">
                  <p class="text-sm font-medium text-neutral-200 line-clamp-2 leading-snug">{{ note.title || 'Untitled' }}</p>
                  <p class="text-xs text-neutral-500 mt-1.5">{{ formatRelativeTime(note.updatedAt) }}</p>
                </div>
              </button>
            </div>
            <!-- Right edge shadow + arrow -->
            <div
              v-show="canScrollRight"
              class="absolute right-0 top-0 bottom-2 z-10 w-12 bg-gradient-to-l from-neutral-900/80 to-transparent group/right cursor-pointer"
              @click="scrollCarousel(1)"
            >
              <button class="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-neutral-700 border border-neutral-600 shadow-lg hover:bg-neutral-600 transition-all opacity-0 group-hover/right:opacity-100">
                <ChevronRight :size="16" class="text-neutral-200" />
              </button>
            </div>
          </div>

          <!-- Favorites carousel -->
          <div v-if="favoriteNotes.length > 0">
          <div class="flex items-center gap-2 mb-3">
            <Star :size="16" class="text-yellow-400" />
            <p class="text-sm font-medium text-neutral-400">Favorites</p>
          </div>
          <div class="relative">
            <!-- Left edge shadow + arrow -->
            <div
              v-show="favCanScrollLeft"
              class="absolute left-0 top-0 bottom-2 z-10 w-12 bg-gradient-to-r from-neutral-900/80 to-transparent group/left cursor-pointer"
              @click="scrollFavCarousel(-1)"
            >
              <button class="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-neutral-700 border border-neutral-600 shadow-lg hover:bg-neutral-600 transition-all opacity-0 group-hover/left:opacity-100">
                <ChevronLeft :size="16" class="text-neutral-200" />
              </button>
            </div>
            <div
              ref="favCarouselRef"
              class="flex gap-3 pb-2 overflow-x-auto scroll-smooth carousel-hide-scrollbar"
              @scroll="updateFavScrollState"
            >
              <button
                v-for="note in favoriteNotes" :key="note.id"
                class="flex-shrink-0 w-40 bg-neutral-800 hover:bg-neutral-750 rounded-xl p-4 flex flex-col justify-between text-left transition-colors border border-yellow-600/30 hover:border-yellow-500/40"
                style="min-height: 110px"
                @click="handleSelectNote(note.id)"
              >
                <div class="-ml-0.5">
                  <span v-if="note.icon" class="text-3xl leading-none">{{ note.icon }}</span>
                  <ListChecks v-else-if="note.noteType === 'tasklist'" :size="28" class="text-neutral-600" />
                  <CircleCheck v-else-if="note.noteType === 'task'" :size="28" class="text-neutral-600" />
                  <FileText v-else :size="28" class="text-neutral-600" />
                </div>
                <div class="mt-1">
                  <p class="text-sm font-medium text-neutral-200 line-clamp-2 leading-snug">{{ note.title || 'Untitled' }}</p>
                  <p class="text-xs text-neutral-500 mt-1.5">{{ formatRelativeTime(note.updatedAt) }}</p>
                </div>
              </button>
            </div>
            <!-- Right edge shadow + arrow -->
            <div
              v-show="favCanScrollRight"
              class="absolute right-0 top-0 bottom-2 z-10 w-12 bg-gradient-to-l from-neutral-900/80 to-transparent group/right cursor-pointer"
              @click="scrollFavCarousel(1)"
            >
              <button class="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-neutral-700 border border-neutral-600 shadow-lg hover:bg-neutral-600 transition-all opacity-0 group-hover/right:opacity-100">
                <ChevronRight :size="16" class="text-neutral-200" />
              </button>
            </div>
          </div>
          </div>
        </div>
        </div>
      </template>
    </div>

    <!-- Editor State -->
    <div
      v-else-if="state.hasTag('editor') && currentNote"
      :class="['flex h-full', notesSettings.tasklistPanelPosition === 'right' && 'flex-row-reverse']"
    >
      <!-- Task List Panel (left side for tasklists) -->
      <TaskListPanel
        v-if="isTaskList"
        :tasks="taskChildren"
        :all-notes="taskDescendants"
        :selected-task-id="selectedTaskId"
        :expanded-node-ids="taskExpandedNodeIds"
        :current-note-id="currentNote.id"
        :current-note-title="currentNote.title"
        :current-note-icon="currentNote.icon"
        :show-completed="!(currentNote?.hideCompletedChildren ?? false)"
        :panel-position="notesSettings.tasklistPanelPosition"
        :show-collapse-icon="notesSettings.showCollapseIcon"
        @toggle-hide-completed="(nodeId: string) => actor.send({ type: 'TASK.TOGGLE_HIDE_COMPLETED_CHILDREN', nodeId })"
        @select-task="(taskId: string) => actor.send({ type: 'TASK.SELECT', taskId })"
        @deselect-task="actor.send({ type: 'TASK.DESELECT' })"
        @create-task="actor.send({ type: 'TASK.CREATE', parentId: currentNote.id })"
        @create-task-child="(parentId: string) => actor.send({ type: 'TASK.CREATE', parentId })"
        @create-subnote="(parentId: string) => actor.send({ type: 'NOTE.CREATE', parentId })"
        @delete-task="(taskId: string) => actor.send({ type: 'TASK.DELETE', taskId })"
        @toggle-complete="(taskId: string) => actor.send({ type: 'TASK.TOGGLE_COMPLETE', taskId })"
        @toggle-show-completed="actor.send({ type: 'TASK.TOGGLE_SHOW_COMPLETED' })"
        @toggle-expand="(nodeId: string) => actor.send({ type: 'TASK.TOGGLE_EXPAND', nodeId })"
        @move-task="(noteIds: string[], newParentId: string | null) => actor.send({ type: 'NOTE.MOVE', noteIds, newParentId })"
        @reorder-task="(noteId: string, newParentId: string | null, newIndex: number) => actor.send({ type: 'NOTE.REORDER', noteId, newParentId, newIndex })"
        @update-icon="(noteId: string, icon: string | null) => actor.send({ type: 'NOTE.UPDATE_ICON', noteId, icon })"
        @open-note="(noteId: string) => actor.send({ type: 'NOTE.OPEN', noteId })"
        @delete-tasklist="actor.send({ type: 'NOTE.DELETE', noteId: currentNote.id })"
        @toggle-favorite="(noteId: string) => actor.send({ type: 'NOTE.TOGGLE_FAVORITE', noteId })"
      />

      <!-- Editor area -->
      <div class="flex flex-col flex-1 h-full min-w-0 relative" @keydown="handleEditorKeydown">
        <!-- Search bar -->
        <TiptapSearchBar
          v-if="editorRef?.editor"
          ref="searchBarRef"
          :editor="editorRef.editor"
        />

        <!-- Editor -->
        <div
          :ref="(el) => (scrollContainerRef = el as HTMLElement | null)"
          class="flex-1 overflow-y-auto pl-1 pr-4"
        >
          <!-- Title row -->
          <div class="flex items-center gap-1 px-4 py-3">
            <EmojiPicker :model-value="editingNote.icon" @update:model-value="handleIconUpdate">
              <template #default="{ toggle }">
                <button
                  class="flex items-center justify-center w-8 h-8 rounded hover:bg-neutral-800 transition-colors shrink-0"
                  @click="toggle"
                >
                  <span v-if="editingNote.icon" class="text-xl leading-none">{{ editingNote.icon }}</span>
                  <ListChecks v-else-if="editingNote.noteType === 'tasklist'" :size="20" class="text-neutral-500" />
                  <CircleCheck v-else-if="editingNote.noteType === 'task'" :size="20" class="text-neutral-500" />
                  <FileText v-else :size="20" class="text-neutral-500" />
                </button>
              </template>
            </EmojiPicker>
            <input
              ref="titleRef"
              v-model="localTitle"
              class="w-full text-2xl font-bold bg-transparent text-neutral-100 border-none outline-none placeholder-neutral-600"
              placeholder="Untitled"
              @input="handleTitleInput"
              @keydown.enter.prevent="handleTitleEnter"
              @keydown.down.prevent="editorRef?.editor?.commands.focus('start')"
              @keydown.tab.exact.prevent="editorRef?.editor?.commands.focus('start')"
              @keydown.right="handleTitleRight"
            />
          </div>
          <RelatedNotes :notes="related.data ?? []" @open="(noteId: string) => actor.send({ type: 'NOTE.OPEN', noteId })" />
          <TiptapEditor
            ref="editorRef"
            :key="editingNote.id"
            mode="editor"
            show-gutter
            :model-value="editingContent"
            :entity-id="editingNote.id"
            placeholder="Start writing..."
            class="h-full"
            @update:model-value="handleContentUpdate"
            @note-link-click="handleNoteLinkClick"
            @image-click="openLightbox"
            @sub-document-link-deleted="handleSubDocumentLinkDeleted"
            @sub-document-link-restored="handleSubDocumentLinkRestored"
            @focus-title="focusTitleEnd()"
          />
        </div>
      </div>
    </div>

    <ImageLightbox v-model="lightboxOpen" :image-src="lightboxSrc" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, provide, nextTick, onMounted } from 'vue'
import { useExternalFileDrag } from '@apackdev/ui/composables/useExternalFileDrag'
import { useSelector } from '@xstate/vue'
import type { NoteSummary } from '#generated/types.ts'
import { useView } from '#generated/fe.ts'
import { useSettings } from '#generated/settings-fe.ts'
import { type NotesState } from './state.ts'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import { EXTRA_BLOCK_ITEMS_KEY, type BlockItem, useSurface } from '@apackdev/sdk/fe'
import { NotebookText, FileText, ListChecks, CircleCheck, Search, Clock, ChevronLeft, ChevronRight, Star, Plus } from 'lucide-vue-next'
import EmojiPicker from '@apackdev/ui/design/EmojiPicker'
import { useDebounce } from '@apackdev/ui/composables/useDebounce'
import { useNoteFocus } from './composables/useNoteFocus.ts'
import { useNoteScroll } from './composables/useNoteScroll.ts'
import { useSubDocumentInsert } from './composables/useSubDocumentInsert.ts'
import TaskListPanel from './components/TaskListPanel.vue'
import RelatedNotes from './components/RelatedNotes.vue'
import ImageLightbox from '@apackdev/ui/design/ImageLightbox'
import TiptapSearchBar from '@apackdev/ui/components/tiptap/TiptapSearchBar'

const actor: NotesState = useSurface()
const state = useSelector(actor, (s) => s)
const currentNote = useSelector(actor, (s) => s.context.currentNote)
const notes = useSelector(actor, (s) => s.context.notes)
const selectedTaskId = useSelector(actor, (s) => s.context.selectedTaskId)
const selectedTask = useSelector(actor, (s) => s.context.selectedTask)
const currentNoteId = useSelector(actor, (s) => s.context.currentNoteId)
const settings = useSettings('notes')
const notesSettings = computed(() => settings.value.value ?? { tasklistPanelPosition: 'left' as const, showCollapseIcon: false })
const isTaskList = computed(() => currentNote.value?.noteType === 'tasklist')
const editingNote = computed(() => selectedTask.value ?? currentNote.value!)
const contents = useSelector(actor, (s) => s.context.contents)
const editingContent = computed(() => (editingNote.value ? contents.value[editingNote.value.id] ?? '' : ''))

// The tree, and the text of the open note and of the selected task: each its view's result, which the machine applies,
// or holds behind this window's own writes until they're answered. It reads them again when the machine asks.
const tree = useView('notes', 'tree')
const openNote = useView('notes', 'note', () => (currentNoteId.value ? { id: currentNoteId.value as never } : null))
const openTask = useView('notes', 'note', () => (selectedTaskId.value ? { id: selectedTaskId.value as never } : null))
// The notes most related to the one being edited, which follow the links as they change
const related = useView('notes', 'related', () => (editingNote.value ? { id: editingNote.value.id as never, limit: 6 } : null), { keepPrevious: true })
watch(() => tree.data, (notes) => { if (notes) actor.send({ type: 'NOTES.READ', notes }) }, { immediate: true })
for (const [view, id] of [[openNote, currentNoteId], [openTask, selectedTaskId]] as const) {
  watch(() => [view.status, view.data] as const, ([status, note]) => {
    if (status === 'ready' && id.value) actor.send({ type: 'NOTE.READ', noteId: id.value, note: note ?? null })
  })
}
const refreshes = useSelector(actor, (s) => s.context.writes.refreshes)
watch(refreshes, () => { tree.refresh(); openNote.refresh(); openTask.refresh() })

const localTitle = ref(editingNote.value?.title ?? '')

const scrollContainerRef = useNoteScroll(actor, () => editingNote.value?.id)

watch(() => editingNote.value?.id, () => {
  localTitle.value = editingNote.value?.title ?? ''
})
const taskExpandedNodeIds = useSelector(actor, (s) => s.context.taskExpandedNodeIds)
const taskChildren = computed(() =>
  notes.value
    .filter(n => n.parentId === currentNote.value?.id)
)
const taskDescendants = computed(() => {
  if (!currentNote.value) return []
  const rootId = currentNote.value.id
  const result: NoteSummary[] = [currentNote.value]
  const queue = [rootId]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    for (const n of notes.value) {
      if (n.parentId === parentId) {
        result.push(n)
        queue.push(n.id)
      }
    }
  }
  return result
})

const searchQuery = ref('')
const searchText = ref('')
const search = useView('notes', 'search', () => (searchText.value ? { text: searchText.value } : null), { keepPrevious: true })
const searchResults = computed(() => search.data ?? [])

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
})

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// What the welcome page lists, read only while it shows: its view reads when each note changed, which typing moves
const recent = useView('notes', 'recent', () => (state.value.hasTag('welcome') ? { limit: 20 } : null))
const recentNotes = computed(() => recent.data?.recent ?? [])
const favoriteNotes = computed(() => recent.data?.favorites ?? [])

const SEARCH_DEBOUNCE_MS = 50
const { debounced: debouncedSearch } = useDebounce((query: string) => {
  searchText.value = query.trim()
}, SEARCH_DEBOUNCE_MS)

watch(searchQuery, (query) => {
  if (!query.trim()) {
    searchText.value = ''
  } else {
    debouncedSearch(query)
  }
})

const editorRef = ref<InstanceType<typeof TiptapEditor> | null>(null)
const searchBarRef = ref<InstanceType<typeof TiptapSearchBar> | null>(null)
const titleRef = ref<HTMLInputElement | null>(null)
const carouselRef = ref<HTMLDivElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const favCarouselRef = ref<HTMLDivElement | null>(null)
const favCanScrollLeft = ref(false)
const favCanScrollRight = ref(false)
const lightboxOpen = ref(false)
const lightboxSrc = ref('')

function openLightbox(src: string) {
  lightboxSrc.value = src
  lightboxOpen.value = true
}

function updateScrollState() {
  const el = carouselRef.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function scrollCarousel(direction: -1 | 1) {
  const el = carouselRef.value
  if (!el) return
  el.scrollBy({ left: direction * 320, behavior: 'smooth' })
}

function updateFavScrollState() {
  const el = favCarouselRef.value
  if (!el) return
  favCanScrollLeft.value = el.scrollLeft > 0
  favCanScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function scrollFavCarousel(direction: -1 | 1) {
  const el = favCarouselRef.value
  if (!el) return
  el.scrollBy({ left: direction * 320, behavior: 'smooth' })
}

watch(recentNotes, () => nextTick(updateScrollState))
watch(favoriteNotes, () => nextTick(updateFavScrollState))
watch(() => state.value.hasTag('welcome'), (isWelcome) => {
  if (isWelcome) nextTick(() => { updateScrollState(); updateFavScrollState() })
})
onMounted(() => nextTick(() => { updateScrollState(); updateFavScrollState() }))

// Composables
useNoteFocus(actor, titleRef, editorRef)
useSubDocumentInsert(actor, editorRef, editingNote)

// Debounced handlers
const SAVE_DEBOUNCE_MS = 150
const { debounced: debouncedUpdateContent, flush: flushContentUpdate } = useDebounce((noteId: string, content: string) => {
  actor.send({ type: 'NOTE.UPDATE_CONTENT', noteId, content })
}, SAVE_DEBOUNCE_MS)
const { debounced: debouncedUpdateTitle, flush: flushTitleUpdate } = useDebounce((noteId: string, title: string) => {
  actor.send({ type: 'NOTE.UPDATE_TITLE', noteId, title })
}, SAVE_DEBOUNCE_MS)
const { debounced: debouncedUpdateTaskContent, flush: flushTaskContentUpdate } = useDebounce((taskId: string, content: string) => {
  actor.send({ type: 'TASK.UPDATE_CONTENT', taskId, content })
}, SAVE_DEBOUNCE_MS)
const { debounced: debouncedUpdateTaskTitle, flush: flushTaskTitleUpdate } = useDebounce((taskId: string, title: string) => {
  actor.send({ type: 'TASK.UPDATE_TITLE', taskId, title })
}, SAVE_DEBOUNCE_MS)

// Flush pending debounced updates when the edited note/task changes (covers deletion, switching, deselection)
watch(editingNote, () => {
  flushContentUpdate()
  flushTitleUpdate()
  flushTaskContentUpdate()
  flushTaskTitleUpdate()
})

// Provide extra block items for the "Document" action
const documentBlockItem: BlockItem[] = [
  {
    label: 'Document',
    icon: FileText,
    command: (editor: any) => {
      const noteId = editingNote.value?.id
      if (!noteId) return
      const cursorPos = editor.state.selection.from
      actor.send({ type: 'NOTE.REQUEST_DOCUMENT_INSERT', parentId: noteId, cursorPos })
    },
  },
]
provide(EXTRA_BLOCK_ITEMS_KEY, documentBlockItem)

function focusTitleEnd() {
  const el = titleRef.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

function handleSelectNote(noteId: string) {
  actor.send({ type: 'NOTE.SELECT', noteId })
}

function handleCreateNote(parentId?: string) {
  actor.send({ type: 'NOTE.CREATE', parentId })
}

// File drag-and-drop
const ALLOWED_EXTENSIONS = ['.md', '.txt']

function processDroppedFiles(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()

  const files = event.dataTransfer?.files
  if (!files) return

  for (const file of Array.from(files)) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) continue

    const reader = new FileReader()
    reader.onload = () => {
      const content = reader.result as string
      const title = file.name.replace(/\.(md|txt)$/i, '')
      actor.send({ type: 'NOTE.CREATE', title, content })
    }
    reader.readAsText(file)
  }
}

const { isDragging: isDraggingFile, onDragEnter: handleDragEnter, onDragLeave: handleDragLeave, onDrop: handleFileDrop } = useExternalFileDrag({
  onDrop: processDroppedFiles,
})

const isSyncingSubDocumentLinks = ref(false)

function handleContentUpdate(content: string) {
  const note = editingNote.value
  if (!note) return
  if (content === editingContent.value) return
  if (isSyncingSubDocumentLinks.value) return
  if (selectedTask.value) {
    debouncedUpdateTaskContent(selectedTask.value.id, content)
  } else {
    debouncedUpdateContent(note.id, content)
  }
}

function handleTitleInput() {
  const title = localTitle.value
  if (selectedTask.value) {
    debouncedUpdateTaskTitle(selectedTask.value.id, title)
  } else if (currentNote.value) {
    debouncedUpdateTitle(currentNote.value.id, title)
  }
}

function handleNoteLinkClick(noteId: string) {
  actor.send({ type: 'NOTE.LINK_CLICKED', noteId })
}

function handleSubDocumentLinkDeleted(noteId: string) {
  actor.send({ type: 'NOTE.SOFT_DELETE', noteId })
}

function handleSubDocumentLinkRestored(noteId: string) {
  actor.send({ type: 'NOTE.RESTORE', noteId })
}

function handleTitleRight(event: KeyboardEvent) {
  const el = event.target as HTMLInputElement
  if (el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
    event.preventDefault()
    editorRef.value?.editor?.commands.focus('start')
  }
}

function handleTitleEnter() {
  const editor = editorRef.value?.editor
  if (!editor) return
  editor.commands.focus('start')
}

function handleEditorKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
    e.preventDefault()
    actor.send({ type: 'NOTE.TOGGLE_PANEL_SEARCH' })
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault()
    searchBarRef.value?.open()
  }
}

function handleIconUpdate(icon: string | null) {
  const note = editingNote.value
  if (!note) return
  actor.send({ type: 'NOTE.UPDATE_ICON', noteId: note.id, icon })
}

// Clear search when leaving welcome state
watch(() => state.value.hasTag('welcome'), (isWelcome) => {
  if (!isWelcome) searchQuery.value = ''
})

// Sync sub-document link node attrs (title/icon) when child notes change
watch(
  notes,
  (allNotes) => {
    const editor = editorRef.value?.editor
    if (!editor || !currentNote.value) return

    // Collect all needed changes first (positions are from the current document)
    const changes: { pos: number; attrs: Record<string, any> }[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'subDocumentLink' && node.attrs.noteId) {
        const child = allNotes.find(n => n.id === node.attrs.noteId)
        if (child && (node.attrs.title !== child.title || node.attrs.icon !== child.icon)) {
          changes.push({ pos, attrs: { ...node.attrs, title: child.title, icon: child.icon } })
        }
      }
    })

    if (changes.length === 0) return

    // Apply all changes in a single transaction (reverse order keeps positions valid)
    isSyncingSubDocumentLinks.value = true
    let tr = editor.state.tr
    for (let i = changes.length - 1; i >= 0; i--) {
      tr = tr.setNodeMarkup(changes[i].pos, undefined, changes[i].attrs)
    }
    editor.view.dispatch(tr)
    isSyncingSubDocumentLinks.value = false
  },
  { deep: true }
)
</script>

<style scoped>
.carousel-hide-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.carousel-hide-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
