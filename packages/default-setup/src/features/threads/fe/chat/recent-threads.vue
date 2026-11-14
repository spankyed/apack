<template>
  <div class="@container relative max-w-[80%] mx-auto pb-2" ref="containerRef">
    <Teleport to="body">
    <div
      v-if="isOpen"
      ref="popupRef"
      class="@container fixed p-1 border border-neutral-700 bg-neutral-900 rounded-lg shadow-xl max-h-80 overflow-y-auto animate-slide-down z-50"
      :style="popupStyle"
    >
      <div v-if="recentThreads.length === 0" class="py-8 text-center">
        <div class="flex flex-col items-center gap-1.5">
          <History :size="20" class="text-neutral-700" />
          <p class="text-sm text-neutral-400">No threads yet</p>
          <p class="text-xs text-neutral-600">Recent threads will appear here</p>
        </div>
      </div>
      <div v-else class="flex flex-col">
        <ContextMenuRoot v-for="(thread, index) in recentThreads" :key="thread.id">
          <ContextMenuTrigger as-child>
        <div
          ref="threadRowRefs"
          class="group flex items-center gap-3 w-full px-3 py-2 rounded-md cursor-pointer transition-colors"
          :class="[
            selectedIndex === index ? 'bg-neutral-700/60 text-white' : 'hover:bg-neutral-800 hover:text-white',
            thread.id === currentThread?.id ? 'bg-blue-500/15' : '',
          ]"
          @click="handleSelectThread(thread.id)"
        >
          <span class="shrink-0 relative inline-block w-1.5 h-1.5">
            <span
              class="block w-full h-full rounded-full transition-colors"
              :class="isThreadBusyLocal(thread.id) ? 'mosaic-dot' : ''"
              :style="!isThreadBusyLocal(thread.id) ? { backgroundColor: getThreadDotColorLocal(thread.id) || '#525252' } : undefined"
            />
            <span
              v-if="isThreadBusyLocal(thread.id)"
              class="absolute inset-0 rounded-full scale-[2] mosaic-glow"
            />
          </span>
          <input
            v-if="editingThreadId === thread.id"
            ref="renameInputRef"
            v-model="editingName"
            class="flex-1 min-w-0 text-sm bg-neutral-800 text-neutral-100 border border-neutral-600 rounded px-1.5 py-0.5 outline-none focus:border-neutral-400"
            @keydown.enter.stop.prevent="confirmRename"
            @keydown.escape.stop.prevent="cancelRename"
            @blur="confirmRename"
            @click.stop
          />
          <span v-else class="flex-1 min-w-0 truncate text-sm text-neutral-300 group-hover:text-white">
            {{ thread.topic || 'Untitled' }}
          </span>
          <button
            v-if="thread.pinned"
            type="button"
            class="flex items-center px-1.5 py-1 text-blue-400 hover:text-blue-300 transition-colors"
            title="Unpin thread"
            @click.stop="handleUnpinThread(thread.id)"
          >
            <Pin :size="12" />
          </button>
          <button
            v-if="!thread.pinned"
            type="button"
            class="flex items-center px-1.5 py-1 text-neutral-600 hover:text-neutral-300 transition-colors opacity-0 group-hover:opacity-100"
            title="Pin thread"
            @click.stop="handlePinThread(thread.id)"
          >
            <Pin :size="12" />
          </button>
          <span class="shrink-0 text-xs tabular-nums text-neutral-600">
            {{ formatTime(thread.timestamp) }}
          </span>
          <div class="shrink-0 flex items-center gap-0.5 ml-1">
            <button
              type="button"
              class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
              title="Open thread details"
              @click.stop="handleViewThread(thread.id)"
            >
              <FileText :size="12" />
              <span class="hidden @lg:inline">Details</span>
            </button>
            <button
              type="button"
              class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
              title="Open thread artifacts"
              @click.stop="handleViewArtifacts(thread.id)"
            >
              <PanelLeft :size="12" />
              <span class="hidden @lg:inline">Artifacts</span>
            </button>
            <span v-if="thread.pinned" class="invisible flex items-center gap-1.5 px-1.5 py-1 text-xs">
              <Archive :size="12" />
              <span class="hidden @lg:inline">Archive</span>
            </span>
            <ContextMenuRoot v-else>
              <ContextMenuTrigger as-child>
                <button
                  type="button"
                  class="flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-neutral-400 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                  title="Archive thread (right-click to delete)"
                  @click.stop="handleArchiveThread(thread.id)"
                >
                  <Archive :size="12" />
                  <span class="hidden @lg:inline">Archive</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuPortal>
                <ContextMenuContent
                  class="bg-neutral-800 border border-neutral-700 rounded-md p-1 min-w-[120px] shadow-[0_10px_38px_-10px_rgba(0,0,0,0.75),0_10px_20px_-15px_rgba(0,0,0,0.4)] z-50"
                  :side-offset="2"
                >
                  <ContextMenuItem
                    class="flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer text-red-400 hover:bg-neutral-700 transition-colors outline-none"
                    @select="handleDeleteThread(thread.id)"
                  >
                    <Trash2 :size="14" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenuPortal>
            </ContextMenuRoot>
          </div>
        </div>
          </ContextMenuTrigger>
          <ThreadContextMenu
            :is-pinned="!!thread.pinned"
            :is-archived="false"
            :copy-text="thread.shortCode || thread.id"
            @rename="startRename(thread.id, thread.topic)"
            @pin="handlePinThread(thread.id)"
            @unpin="handleUnpinThread(thread.id)"
            @archive="handleArchiveThread(thread.id)"
            @delete="handleDeleteThread(thread.id)"
          />
        </ContextMenuRoot>
      </div>
    </div>
    </Teleport>

    <div class="flex items-center content-between cursor-pointer" @click="isOpen = !isOpen">
      <button
        type="button"
        class="flex items-center px-5 pb-2 text-sm transition-colors text-neutral-500 hover:text-neutral-200"
      >
        <History v-if="!isOpen" :size="16" class="mr-2" />
        <ChevronUp v-else :size="16" class="mr-2" />

        Recent<span class="hidden @lg:inline">&nbsp;Threads</span>
      </button>

      <div class="flex-grow min-w-0 px-2 @md:px-12 pb-2 text-sm text-center text-neutral-500 cursor-pointer">
        <span
          v-if="currentThread?.topic"
          class="group inline-flex items-center justify-center gap-2 max-w-full"
        >
          <PanelLeft :size="14" class="shrink-0 cursor-pointer transition-colors hover:text-neutral-200" title="Toggle thread sidebar" @mousedown.prevent @click.stop="handleToggleSidebar" @contextmenu.prevent.stop="handleToggleInlineDashboard" />
          <input
            v-if="editingTitleBar"
            ref="titleBarInputRef"
            v-model="editingName"
            :size="Math.max(editingName.length + 1, 1)"
            class="min-w-0 text-sm bg-neutral-800 text-neutral-100 border border-neutral-600 rounded px-1.5 py-0.5 outline-none focus:border-neutral-400 text-center"
            @keydown.enter.stop.prevent="confirmTitleBarRename"
            @keydown.escape.stop.prevent="cancelTitleBarRename"
            @blur="confirmTitleBarRename"
            @click.stop
          />
          <span v-else class="min-w-[3ch] truncate cursor-pointer transition-colors hover:text-neutral-200 hover:underline underline-offset-4 decoration-neutral-600" title="Thread Artifacts" @click.stop="handleTitleClick" @contextmenu.prevent="startTitleBarRename">{{ currentThread?.topic }}</span>
        </span>
      </div>

      <ContextMenuRoot>
        <ContextMenuTrigger as-child>
          <button
            type="button"
            class="flex items-center px-5 pb-2 text-sm transition-colors text-neutral-500 hover:text-neutral-200"
            @click.stop="handleNewThread"
          >
            <Plus :size="16" class="mr-2" />
            New<span class="hidden @lg:inline">&nbsp;thread</span>
          </button>
        </ContextMenuTrigger>

        <ContextMenuPortal>
          <ContextMenuContent
            class="w-fit bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50"
          >
            <ContextMenuSub>
              <ContextMenuSubTrigger
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none data-[state=open]:bg-neutral-800"
              >
                <FolderOpen class="w-4 h-4" />
                <span class="flex-1">In Project</span>
                <ChevronRight class="w-3 h-3 text-neutral-500" />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent
                class="min-w-[200px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50"
                :side-offset="4"
              >
                <ContextMenuItem
                  @select="$emit('new-thread-no-project')"
                  class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:bg-neutral-800 focus:outline-none"
                >
                  No project (ask me)
                </ContextMenuItem>
                <template v-for="project in projects" :key="project.name">
                  <ContextMenuSeparator class="h-[1px] bg-neutral-700 my-1" />
                  <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-500 select-none">
                    <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: project.color }" />
                    <span class="truncate">{{ project.name }}</span>
                  </div>
                  <ContextMenuItem
                    v-for="dir in project.directories"
                    :key="dir"
                    @select="$emit('new-thread-in-project', dir)"
                    class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
                  >
                    <span class="truncate">{{ dirName(dir) }}</span>
                  </ContextMenuItem>
                </template>
                <div v-if="projects.length === 0" class="px-3 py-2 text-xs text-neutral-500 italic">
                  No projects configured
                </div>
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator class="h-[1px] bg-neutral-700 my-1" />

            <ContextMenuSub>
              <ContextMenuSubTrigger
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none data-[state=open]:bg-neutral-800"
              >
                <GitBranchPlus class="w-4 h-4" />
                <span class="flex-1">As Child of</span>
                <ChevronRight class="w-3 h-3 text-neutral-500" />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent
                class="min-w-[200px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50"
                :side-offset="4"
              >
                <ContextMenuItem
                  v-for="projectThread in recentThreads"
                  :key="projectThread.id"
                  @select="$emit('new-thread-as-child', projectThread.id)"
                  class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
                >
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="text-xs font-medium text-neutral-500">{{ projectThread.shortCode }}</span>
                    <span class="truncate">{{ projectThread.topic || 'Untitled' }}</span>
                  </div>
                </ContextMenuItem>
                <div v-if="recentThreads.length === 0" class="px-3 py-2 text-sm text-neutral-500 italic">
                  No threads available
                </div>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'
import { useAppSettings } from '#generated/settings-fe.ts'
import { ref, onMounted, onUnmounted, computed, watch, nextTick, type CSSProperties } from 'vue'
import { Archive, History, ChevronUp, ChevronRight, Plus, PanelLeft, FileText, Pin, Trash2, FolderOpen, GitBranchPlus } from 'lucide-vue-next'
import type { ThreadEntity } from '#generated/types.ts';
import type { AgentThreadData } from '#generated/types.ts'
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from 'reka-ui'
import { useSelector } from '@xstate/vue'
import type { ThreadsState } from '#features/threads/fe/state.ts'
import ThreadContextMenu from '#features/threads/fe/canvas/components/thread-context-menu.vue'
import { getThreadDotColor, isThreadBusy } from './thread-status.ts'

export interface ThreadsProps {
  currentThread: AgentThreadData | null;
  recentThreads: ThreadEntity[]
}

const props = defineProps<ThreadsProps>()
const isOpen = ref(false)
const selectedIndex = ref(-1)
const containerRef = ref<HTMLDivElement | null>(null)
const popupRef = ref<HTMLDivElement | null>(null)
const threadRowRefs = ref<HTMLDivElement[]>([])

// Inline rename state for recent threads list
const editingThreadId = ref<string | null>(null)
const editingName = ref('')
const renameInputRef = ref<HTMLInputElement[] | null>(null)

// Inline rename state for title bar
const editingTitleBar = ref(false)
const titleBarInputRef = ref<HTMLInputElement | null>(null)

// Position the teleported popup above the container using fixed coords
const popupStyle = ref<CSSProperties>({})

watch(isOpen, async (open) => {
  if (!open || !containerRef.value) return
  await nextTick()
  const rect = containerRef.value.getBoundingClientRect()
  popupStyle.value = {
    bottom: `${window.innerHeight - rect.top + 8}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  }
})

// Get threads from the threads surface state
const threadsActor: ThreadsState = useSurface()
const chatStates = useSelector(threadsActor, (state) => state.context.chatStates)
const chatStateOverrides = useSelector(threadsActor, (state) => state.context.chatStateOverrides)
const settings = useSelector(threadsActor, (state) => state.context.settings)

function getThreadDotColorLocal(threadId: string): string | undefined {
  return getThreadDotColor(threadId, chatStates.value, chatStateOverrides.value, settings.value)
}

function isThreadBusyLocal(threadId: string): boolean {
  return isThreadBusy(threadId, chatStates.value, chatStateOverrides.value, settings.value)
}

const recentThreads = computed(() => props.recentThreads)

const handleClickOutside = (event: MouseEvent) => {
  if (editingThreadId.value) return
  const target = event.target as Node
  if (containerRef.value && !containerRef.value.contains(target) && (!popupRef.value || !popupRef.value.contains(target))) {
    isOpen.value = false
  }
}

function isNonChatInputFocused() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.closest?.('.ProseMirror')) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
    || !!el.closest?.('.monaco-editor')
}

const handleKeydown = (e: KeyboardEvent) => {
  // Ctrl+Space: toggle popup (only when not typing in an editor/input)
  if (e.key === ' ' && e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (!isOpen.value && isNonChatInputFocused()) return
    e.preventDefault()
    isOpen.value = !isOpen.value
    selectedIndex.value = -1
    if (isOpen.value) (document.activeElement as HTMLElement)?.blur()
    return
  }

  if (!isOpen.value) return

  const currentIdx = recentThreads.value.findIndex(t => t.id === props.currentThread?.id)

  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault()
      let next = selectedIndex.value + 1
      if (next === currentIdx) next++
      if (next < recentThreads.value.length) selectedIndex.value = next
      nextTick(() => threadRowRefs.value[selectedIndex.value]?.scrollIntoView({ block: 'nearest' }))
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      let next = selectedIndex.value <= 0 ? 0 : selectedIndex.value - 1
      if (next === currentIdx) next--
      if (next >= 0) selectedIndex.value = next
      nextTick(() => threadRowRefs.value[selectedIndex.value]?.scrollIntoView({ block: 'nearest' }))
      break
    }
    case 'Enter':
      if (selectedIndex.value >= 0) {
        e.preventDefault()
        handleSelectThread(recentThreads.value[selectedIndex.value]?.id)
      }
      break
    case 'Escape':
      e.preventDefault()
      isOpen.value = false
      break
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('keydown', handleKeydown)
})

const emit = defineEmits<{
  (e: 'view-thread', threadId: string): void
  (e: 'open-thread-chat', threadId: string): void
  (e: 'view-dashboard'): void
  (e: 'toggle-inline-dashboard'): void
  (e: 'toggle-thread-sidebar'): void
  (e: 'toggle-inline-tabs'): void
  (e: 'view-artifacts', threadId: string): void
  (e: 'new-thread'): void
  (e: 'new-thread-as-child', parentThreadId: string): void
  (e: 'new-thread-in-project', directory: string): void
  (e: 'new-thread-no-project'): void
}>()

// Read projects from settings for the "New Thread in Project" submenu
const { value: general } = useAppSettings()
const storedProjects = computed(() => general.value?.projects ?? [])
const projects = computed(() => storedProjects.value ?? [])

const dirName = (dir: string) => dir.split('/').filter(Boolean).pop() || dir

// Rename helpers for recent threads list
const startRename = (threadId: string, topic: string | undefined) => {
  editingThreadId.value = threadId
  editingName.value = topic || ''
  setTimeout(() => {
    const input = renameInputRef.value?.[0]
    input?.focus()
    input?.select()
  }, 50)
}

const confirmRename = () => {
  const threadId = editingThreadId.value
  if (!threadId) return
  const trimmed = editingName.value.trim()
  if (trimmed) {
    threadsActor.send({ type: 'RENAME_THREAD', threadId, topic: trimmed })
  }
  editingThreadId.value = null
}

const cancelRename = () => {
  editingThreadId.value = null
}

// Rename helpers for title bar
const startTitleBarRename = () => {
  if (!props.currentThread?.id) return
  editingName.value = props.currentThread.topic || ''
  editingTitleBar.value = true
  setTimeout(() => {
    titleBarInputRef.value?.focus()
    titleBarInputRef.value?.select()
  }, 50)
}

const confirmTitleBarRename = () => {
  if (!editingTitleBar.value) return
  const threadId = props.currentThread?.id
  if (!threadId) return
  const trimmed = editingName.value.trim()
  if (trimmed) {
    threadsActor.send({ type: 'RENAME_THREAD', threadId, topic: trimmed })
  }
  editingTitleBar.value = false
}

const cancelTitleBarRename = () => {
  editingTitleBar.value = false
}

const handleArchiveThread = (id: string | undefined) => {
  if (!id) return
  if (settings.value?.skipArchiveConfirm || confirm('Archive this thread? It will be hidden from all lists.')) {
    threadsActor.send({ type: 'ARCHIVE_THREAD', threadId: id })
  }
}

const handleUnpinThread = (id: string | undefined) => {
  if (!id) return
  threadsActor.send({ type: 'UNPIN_THREAD', threadId: id })
}

const handlePinThread = (id: string | undefined) => {
  if (!id) return
  threadsActor.send({ type: 'PIN_THREAD', threadId: id })
}

const handleDeleteThread = (id: string | undefined) => {
  if (!id) return
  const thread = recentThreads.value.find(t => t.id === id)
  const confirmed = confirm(`Permanently delete thread "${thread?.topic || 'Untitled'}"? This cannot be undone.`)
  if (confirmed) {
    threadsActor.send({ type: 'DELETE_THREAD', threadId: id })
  }
}

const handleViewThread = (id: string | undefined) => {
  if (!id) return
  emit('view-thread', id)
  isOpen.value = false
}

const handleViewArtifacts = (id: string | undefined) => {
  if (!id) return
  emit('view-artifacts', id)
  isOpen.value = false
}

const handleTitleClick = (event: MouseEvent) => {
  if (event.metaKey || event.ctrlKey) {
    handleToggleInlineTabs()
  } else {
    handleViewDashboard()
  }
}

const handleViewDashboard = () => {
  if (!props.currentThread?.id) return
  emit('view-dashboard')
  isOpen.value = false
}

const handleToggleInlineTabs = () => {
  if (!props.currentThread?.id) return
  emit('toggle-inline-tabs')
}

const handleToggleSidebar = () => {
  if (editingTitleBar.value) confirmTitleBarRename()
  if (!props.currentThread?.id) return
  emit('toggle-thread-sidebar')
}

const handleToggleInlineDashboard = () => {
  if (editingTitleBar.value) confirmTitleBarRename()
  if (!props.currentThread?.id) return
  emit('toggle-inline-dashboard')
}

const handleSelectThread = (id: string | undefined) => {
  if (!id) return
  emit('open-thread-chat', id)
  isOpen.value = false
}

const handleNewThread = () => {
  emit('new-thread')
  isOpen.value = false
}

const formatTime = (timestamp: Date | number | string) => {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>
