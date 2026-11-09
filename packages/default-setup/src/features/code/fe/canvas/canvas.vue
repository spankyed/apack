<template>
  <div
    class="relative flex flex-col h-full bg-neutral-900"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover.prevent
    @drop.capture="handleDrop"
  >
    <!-- Drop overlay -->
    <div
      v-if="isDraggingOver"
      class="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500/50 pointer-events-none"
    >
      <div class="px-6 py-3 text-sm font-medium rounded-lg bg-neutral-800/90 text-blue-400">
        Drop to open file
      </div>
    </div>

    <!-- Quick Open Palette -->
    <QuickOpenPalette />

    <!-- Always use FileEditor which now handles both regular files and diffs -->
    <FileEditor
      ref="fileEditorRef"
      :open-files="openFiles"
      :active-file-path="activeFilePath"
      :base-directory="baseDirectory"
      :tab-groups="tabGroups"
      @select-file="selectFile"
      @close-file="closeFile"
      @content-change="handleContentChange"
      @reorder="handleReorder"
      @reveal-in-explorer="revealInExplorer"
      @pin-tab="pinTab"
      @unpin-tab="unpinTab"
      @pin-tab-at="pinTabAt"
      @unpin-tab-at="unpinTabAt"
      @create-group="createGroup"
      @rename-group="renameGroup"
      @change-group-color="changeGroupColor"
      @delete-group="deleteGroup"
      @toggle-group-collapse="toggleGroupCollapse"
      @add-tab-to-group="addTabToGroup"
      @remove-tab-from-group="removeTabFromGroup"
      @ungroup-all="ungroupAll"
      @close-all-in-group="closeAllInGroup"
      @pin-group="pinGroup"
      @unpin-group="unpinGroup"
      @rename-terminal="renameTerminal"
      @kill-terminal="killTerminal"
      @move-to-panel="moveToPanel"
      @restart-terminal="restartTerminal"
      @promote-preview="promotePreview"
      @editor-mount="tryRevealLine"
      @editor-file-ready="tryRevealLine"
      class="flex-1 min-h-0"
    />

    <!-- Status Bar -->
    <div v-if="openFiles.length > 0" class="flex items-center justify-between px-4 py-1 text-xs border-t bg-neutral-800/80 border-neutral-800">
      <div class="flex items-center gap-4">
        <span v-if="activeFile" class="flex items-center gap-2 text-neutral-400">
          <component :is="getStatusIcon(activeFile)" class="w-3 h-3" />
          {{ getStatusText(activeFile) }}
        </span>
        <span v-if="activeFile && !isTerminal(activeFile) && activeFile.pendingSaveConflict && (!activeFile.isDiff || isActiveEditableDiff)" class="text-orange-400">
          External changes detected
        </span>
        <span v-else-if="activeFile && !isTerminal(activeFile) && activeFile.modified && (!activeFile.isDiff || isActiveEditableDiff)" class="text-blue-400">
          Modified
        </span>
        <span v-if="refreshNotification" class="text-green-400 animate-pulse">
          File refreshed
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="activeFile && !isTerminal(activeFile) && activeFile.pendingSaveConflict && (!activeFile.isDiff || isActiveEditableDiff) && !isAction(activeFile) && !isPrompt(activeFile)"
          @click="loadExternalChanges"
          class="px-2 py-0.5 bg-neutral-600 hover:bg-neutral-700 text-white rounded transition-colors"
        >
          Load Changes
        </button>
        <button
          v-if="activeFile && !isTerminal(activeFile) && activeFile.modified && (!activeFile.isDiff || isActiveEditableDiff)"
          @click="() => saveFile()"
          class="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          {{ activeFile.pendingSaveConflict ? 'Override' : 'Save' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { useExternalFileDrag } from '@apackdev/ui/composables/useExternalFileDrag'
import { useSelector } from '@xstate/vue'
import { type CodeState, type OpenFile, setEditorSelectionGetter, isEditableDiff } from '../state.ts'
import { GitCompare, FileCode, Terminal } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import FileEditor from '#features/code/fe/canvas/FileEditor.vue'
import QuickOpenPalette from '#features/code/fe/canvas/QuickOpenPalette.vue'
import { reorderTabs } from '../utils/tab-management.ts'
import { codeChild } from '../features/children.ts';

const actor: CodeState = useSurface()
const explorerActor = codeChild(actor, 'explorer')
const terminalActor = codeChild(actor, 'terminal')

// State selectors
const openFiles = useSelector(actor, (state) => state.context.openFiles)
const activeFilePath = useSelector(actor, (state) => state.context.activeFilePath)
const baseDirectory = useSelector(actor, (state) => state.context.baseDirectory)
const tabGroups = useSelector(actor, (state) => state.context.tabGroups)

const fileEditorRef = ref<InstanceType<typeof FileEditor>>()
const pendingRevealLine = useSelector(actor, (state) => state.context.pendingRevealLine)

// Reveal pending line in editor (called from @editor-file-ready, @editor-mount, and watch)
const tryRevealLine = async () => {
  const reveal = pendingRevealLine.value
  if (!reveal) return
  if (reveal.filePath !== activeFilePath.value) return
  await nextTick()

  const ref = fileEditorRef.value
  if (!ref) {
    console.warn('[code] tryRevealLine: editor ref not available for', reveal.filePath)
    return
  }

  // Monaco editor path
  const monacoEditor = ref.getEditor()
  if (monacoEditor) {
    monacoEditor.layout()
    monacoEditor.revealLineInCenter(reveal.line)
    monacoEditor.setPosition({ lineNumber: reveal.line, column: reveal.column })
    monacoEditor.focus()
    actor.send({ type: 'UPDATE_STATE', updates: { pendingRevealLine: null } })
    return
  }

  // Tiptap (rich text / markdown) editor path
  const tiptapEditor = ref.getTiptapEditor()
  if (tiptapEditor) {
    const searchText = reveal.lineText?.trim()
    if (searchText) {
      let targetPos: number | null = null
      tiptapEditor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false
        if (node.isText && node.text?.includes(searchText)) {
          targetPos = pos + (node.text.indexOf(searchText))
        }
      })
      if (targetPos !== null) {
        tiptapEditor.chain().setTextSelection(targetPos).focus().scrollIntoView().run()
      }
    }
    actor.send({ type: 'UPDATE_STATE', updates: { pendingRevealLine: null } })
    return
  }
}

watch(pendingRevealLine, () => {
  tryRevealLine()
})

// Computed
const activeFile = computed(() =>
  openFiles.value.find(f => f.path === activeFilePath.value)
)
const isActiveEditableDiff = computed(() =>
  !!activeFile.value && isEditableDiff(activeFile.value as OpenFile)
)

// External file drop
const binaryExtensions = new Set([
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  'mp4', 'avi', 'mov', 'mkv', 'webm', 'wmv',
  'zip', 'tar', 'gz', 'bz2', 'rar', '7z', 'dmg', 'iso',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'sqlite', 'db', 'mdb',
])

const hasOpenableFile = (dataTransfer: DataTransfer): boolean => {
  const items = dataTransfer.items
  if (!items?.length) return false
  for (const item of items) {
    if (item.kind !== 'file') continue
    const name = item.type ? item.getAsFile()?.name : undefined
    // If we can't determine the name/extension, assume it's openable
    if (!name) return true
    const ext = name.split('.').pop()?.toLowerCase()
    if (!ext || !binaryExtensions.has(ext)) return true
  }
  return false
}

const { isDragging: isDraggingOver, onDragEnter: handleDragEnter, onDragLeave: handleDragLeave, onDrop: handleDrop } = useExternalFileDrag({
  accept: hasOpenableFile,
  onDrop: (e) => {
    const files = e.dataTransfer?.files
    if (!files?.length) return

    // Collect valid file paths using Electron's webUtils API (File.path was removed in Electron 32)
    const getPath = window.electronAPI?.fileUtils?.getPathForFile
    if (!getPath) return

    const filePaths: string[] = []
    for (const file of files) {
      const filePath: string = getPath(file)
      if (!filePath) continue

      const ext = filePath.split('.').pop()?.toLowerCase()
      if (ext && binaryExtensions.has(ext)) continue

      filePaths.push(filePath)
    }

    if (filePaths.length === 0) return

    // Prevent Monaco from also processing this drop
    e.preventDefault()
    e.stopPropagation()

    for (const filePath of filePaths) {
      explorerActor?.send({ type: 'explorer.OPEN_FILE', path: filePath })
    }
  },
})

// Notification state
const refreshNotification = ref(false)
let refreshTimeout: number | undefined

// Watch for external file refreshes
watch(openFiles, (newFiles, oldFiles) => {
  if (!oldFiles || !newFiles) return

  // Check if any file was refreshed (externallyModified cleared)
  for (const newFile of newFiles) {
    const oldFile = oldFiles.find(f => f.path === newFile.path)
    if (oldFile && oldFile.externallyModified && !newFile.externallyModified && !newFile.modified) {
      // File was refreshed
      showRefreshNotification()
      break
    }
  }
}, { deep: true })

const showRefreshNotification = () => {
  refreshNotification.value = true
  if (refreshTimeout) {
    clearTimeout(refreshTimeout)
  }
  refreshTimeout = window.setTimeout(() => {
    refreshNotification.value = false
  }, 3000)
}

// Event handlers
const selectFile = (path: string) => {
  actor.send({
    type: 'UPDATE_STATE',
    updates: { activeFilePath: path }
  })
}

const killTerminal = (path: string) => actor.send({ type: 'KILL_TERMINAL', path })
const moveToPanel = (path: string) => actor.send({ type: 'MOVE_TERMINAL_TO_PANEL', path })

/**
 * Starts a new shell under this terminal, as the panel's menu does.
 *
 * **A restart is one event, and closing-then-creating is not it** (T6). Killing the terminal and creating
 * another produced a different id, so this tab was removed and a new one appended at the end — losing the
 * terminal's place, and, since pinned tabs are no longer exempt from removal, losing a pinned tab outright.
 * It also silently downgraded the shell: `terminal.CREATE` carries only a title and a cwd, so a zsh terminal
 * came back as the platform default. `terminal.RESTART` keeps the id, the tab, its position and the
 * transcript of what came before, and re-opens the shell the terminal already had.
 */
const restartTerminal = (path: string) => {
  const file = openFiles.value.find(f => f.path === path) as any
  if (!file?.isTerminal) return
  terminalActor?.send({ type: 'terminal.RESTART', terminalId: file.terminalInfo.id })
}

const closeFile = (path: string) => actor.send({ type: 'CLOSE_TAB', path })
const promotePreview = (path: string) => actor.send({ type: 'PROMOTE_PREVIEW_TAB', path })

const handleContentChange = (path: string, content: string) => {
  const newOpenFiles = openFiles.value.map(f => {
    if (f.path !== path) return f
    if (!('originalContent' in f)) return { ...f, content, modified: true }

    const isModified = content !== f.originalContent

    // Tiptap normalizes markdown on mount — update baseline once, skip promotion
    if (!f.modified && f.isRichText && isModified && !f._richTextBaselineSet) {
      return { ...f, content, originalContent: content, modified: false, _richTextBaselineSet: true }
    }

    if (f.isPreview && isModified) actor.send({ type: 'PROMOTE_PREVIEW_TAB', path })
    return { ...f, content, modified: isModified }
  })

  actor.send({
    type: 'UPDATE_STATE',
    updates: { openFiles: newOpenFiles }
  })
}

const handleReorder = (fromIndex: number, toIndex: number) => {
  const reorderedFiles = reorderTabs(openFiles.value, fromIndex, toIndex)

  actor.send({
    type: 'UPDATE_STATE',
    updates: { openFiles: reorderedFiles }
  })
}

const saveFile = () => actor.send({ type: 'SAVE_ACTIVE_FILE' })

const loadExternalChanges = () => {
  if (activeFile.value && activeFile.value.pendingSaveConflict) {
    // Send event to explorer state machine
    explorerActor?.send({
      type: 'explorer.OPEN_FILE',
      path: activeFile.value.path
    })
  }
}

// Helper functions
const getFileName = (path: string) => {
  return path.split('/').pop() || path
}

const isTerminal = (file: any): boolean => {
  return 'isTerminal' in file && file.isTerminal === true
}

const isAction = (file: any): boolean => {
  return 'isAction' in file && file.isAction === true
}

const isPrompt = (file: any): boolean => {
  return 'isPrompt' in file && file.isPrompt === true
}

const getStatusIcon = (file: any) => {
  if (isTerminal(file)) return Terminal
  if (file.isDiff) return GitCompare
  if (isAction(file)) return FileCode // Actions use same icon as files
  if (isPrompt(file)) return FileCode // Prompts use same icon as files
  return FileCode
}

const getStatusText = (file: any) => {
  if (isTerminal(file)) {
    return file.terminalInfo.title
  }
  if (file.isDiff && file.gitFile) {
    return getFileName(file.gitFile.path)
  }
  if (isAction(file)) {
    return file.actionEntity.label
  }
  if (isPrompt(file)) {
    return file.promptEntity.label
  }
  return getFileName(file.path)
}

const revealInExplorer = (path: string) => {
  actor.send({ type: 'SELECT_PANEL', panel: 'explorer' })
  explorerActor?.send({ type: 'explorer.REVEAL_IN_TREE', path })
}

const pinTab = (path: string) => {
  actor.send({ type: 'PIN_TAB', path })
}

const unpinTab = (path: string) => {
  actor.send({ type: 'UNPIN_TAB', path })
}

const pinTabAt = (path: string, targetPath: string, side: 'left' | 'right') => {
  actor.send({ type: 'PIN_TAB_AT', path, targetPath, side })
}

const unpinTabAt = (path: string, targetPath: string, side: 'left' | 'right') => {
  actor.send({ type: 'UNPIN_TAB_AT', path, targetPath, side })
}

// Tab group handlers
const createGroup = (name: string, tabPaths: string[]) => {
  actor.send({ type: 'CREATE_GROUP', name, tabPaths })
}

const renameGroup = (groupId: string, name: string) => {
  actor.send({ type: 'RENAME_GROUP', groupId, name })
}

const renameTerminal = (path: string, customTitle: string) => {
  const terminalId = path.replace('terminal:', '')
  terminalActor?.send({ type: 'terminal.RENAME', terminalId, customTitle })
}

const changeGroupColor = (groupId: string, color: string) => {
  actor.send({ type: 'CHANGE_GROUP_COLOR', groupId, color: color as any })
}

const deleteGroup = (groupId: string) => {
  actor.send({ type: 'DELETE_GROUP', groupId, closeTabsInGroup: false })
}

const toggleGroupCollapse = (groupId: string) => {
  actor.send({ type: 'TOGGLE_GROUP_COLLAPSE', groupId })
}

const addTabToGroup = (path: string, groupId: string) => {
  actor.send({ type: 'ADD_TAB_TO_GROUP', path, groupId })
}

const removeTabFromGroup = (path: string) => {
  actor.send({ type: 'REMOVE_TAB_FROM_GROUP', path })
}

const ungroupAll = (groupId: string) => {
  actor.send({ type: 'DELETE_GROUP', groupId, closeTabsInGroup: false })
}

const closeAllInGroup = (groupId: string) => {
  actor.send({ type: 'DELETE_GROUP', groupId, closeTabsInGroup: true })
}

const pinGroup = (groupId: string) => {
  actor.send({ type: 'PIN_GROUP', groupId })
}

const unpinGroup = (groupId: string) => {
  actor.send({ type: 'UNPIN_GROUP', groupId })
}

// Register editor selection getter so the state machine can read Monaco selection for search prefill
onMounted(() => {
  setEditorSelectionGetter(() => {
    const editor = fileEditorRef.value?.getEditor()
    if (!editor) return ''
    const selection = editor.getSelection()
    const model = editor.getModel()
    if (!selection || !model) return ''
    return model.getValueInRange(selection)
  })
})

// Cleanup on unmount
onUnmounted(() => {
  setEditorSelectionGetter(null)
  if (refreshTimeout) {
    clearTimeout(refreshTimeout)
  }
})
</script>

<style>
.bg-neutral-850 {
  background-color: rgb(28, 28, 30);
}
</style>
