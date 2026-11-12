<template>
  <div class="flex flex-col h-full">
    <!-- Tabs -->
    <Tabs
      :tabs="openFiles"
      :active-tab-path="activeFilePath"
      :base-directory="baseDirectory"
      :tab-groups="tabGroups"
      @select="selectFile"
      @close="closeFile"
      @reorder="(fromIndex, toIndex) => $emit('reorder', fromIndex, toIndex)"
      @reveal-in-explorer="(path) => $emit('reveal-in-explorer', path)"
      @pin-tab="(path) => $emit('pin-tab', path)"
      @unpin-tab="(path) => $emit('unpin-tab', path)"
      @pin-tab-at="(path, targetPath, side) => $emit('pin-tab-at', path, targetPath, side)"
      @unpin-tab-at="(path, targetPath, side) => $emit('unpin-tab-at', path, targetPath, side)"
      @create-group="(name, tabPaths) => $emit('create-group', name, tabPaths)"
      @rename-group="(groupId, name) => $emit('rename-group', groupId, name)"
      @change-group-color="(groupId, color) => $emit('change-group-color', groupId, color)"
      @delete-group="(groupId) => $emit('delete-group', groupId)"
      @toggle-group-collapse="(groupId) => $emit('toggle-group-collapse', groupId)"
      @add-tab-to-group="(tabPath, groupId) => $emit('add-tab-to-group', tabPath, groupId)"
      @remove-tab-from-group="(path) => $emit('remove-tab-from-group', path)"
      @ungroup-all="(groupId) => $emit('ungroup-all', groupId)"
      @close-all-in-group="(groupId) => $emit('close-all-in-group', groupId)"
      @pin-group="(groupId) => $emit('pin-group', groupId)"
      @unpin-group="(groupId) => $emit('unpin-group', groupId)"
      @rename-terminal="(path, customTitle) => $emit('rename-terminal', path, customTitle)"
      @kill-terminal="(path) => $emit('kill-terminal', path)"
      @move-to-panel="(path) => $emit('move-to-panel', path)"
      @promote-preview="(path) => $emit('promote-preview', path)"
    />

    <!-- Editor -->
    <div class="relative flex-1 min-h-0 bg-neutral-900">
      <div v-if="openFiles.length === 0" class="absolute inset-0 flex items-center justify-center">
        <div class="text-center">
          <FileCode class="w-16 h-16 mx-auto mb-4 text-neutral-600" />
          <p class="text-neutral-400">Open a file from the explorer to start editing</p>
        </div>
      </div>

      <div v-else-if="activeFile" class="absolute inset-0 overflow-hidden">
        <!-- Terminal view -->
        <div v-show="isTerminal(activeFile)" class="h-full overflow-hidden">
          <TerminalView
            v-if="isTerminal(activeFile)"
            :key="activeFile.terminalInfo.id"
            :terminal-info="activeFile.terminalInfo"
            @kill-terminal="$emit('kill-terminal', activeFile!.path)"
            @restart-terminal="$emit('restart-terminal', activeFile!.path)"
            class="h-full"
          />
        </div>

        <!-- Image preview -->
        <div v-show="isImage(activeFile) && !isImageDiff" class="flex items-center justify-center h-full overflow-auto bg-neutral-950 p-4">
          <img
            v-if="isImage(activeFile) && !isImageDiff"
            :src="activeFile.content"
            :alt="activeFile.path.split('/').pop()"
            class="max-w-full max-h-full object-contain"
          />
        </div>

        <!-- Video player (native formats) -->
        <div v-show="isVideoFile(activeFile) && isNativeVideo" class="flex items-center justify-center h-full bg-neutral-950">
          <VideoPlayer
            v-if="isVideoFile(activeFile) && isNativeVideo"
            :key="activeFile.path"
            :file-path="activeFile.path"
          />
        </div>

        <!-- Unsupported video format fallback -->
        <div v-show="isVideoFile(activeFile) && !isNativeVideo" class="h-full flex items-center justify-center" style="background: #1e1e1e">
          <div v-if="isVideoFile(activeFile) && !isNativeVideo" class="text-center">
            <VideoIcon class="w-12 h-12 mx-auto mb-3 text-neutral-600" />
            <p class="text-neutral-400 text-sm">This video format is not supported for in-app playback</p>
            <p class="text-neutral-600 text-xs mt-1">{{ activeFile.path.split('/').pop() }}</p>
            <button
              @click="openVideoExternal"
              class="mt-4 px-4 py-1.5 text-sm rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 transition-colors"
            >
              Open in Video Player
            </button>
          </div>
        </div>

        <!-- Image diff side-by-side view -->
        <div v-show="isImageDiff" class="h-full flex" style="background: #1e1e1e">
          <div v-if="isImageDiff" class="flex-1 min-w-0 flex flex-col border-r border-neutral-700">
            <div class="text-neutral-500 text-xs px-3 py-1.5 border-b border-neutral-800 shrink-0">Original</div>
            <div class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6">
              <img v-if="diffOriginalContent" :src="diffOriginalContent" class="max-w-full max-h-full object-contain" />
              <span v-else class="text-neutral-500 text-sm italic">File added</span>
            </div>
          </div>
          <div v-if="isImageDiff" class="flex-1 min-w-0 flex flex-col">
            <div class="text-neutral-500 text-xs px-3 py-1.5 border-b border-neutral-800 shrink-0">Modified</div>
            <div class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6">
              <img v-if="diffModifiedContent" :src="diffModifiedContent" class="max-w-full max-h-full object-contain" />
              <span v-else class="text-neutral-500 text-sm italic">File deleted</span>
            </div>
          </div>
        </div>

        <!-- Deleted file view -->
        <div v-if="isDeletedFile" class="h-full">
          <DeletedFileView
            :file-path="(activeFile as any).deletedFilePath"
            @close="closeFile(activeFilePath!)"
          />
        </div>

        <!-- Binary file info -->
        <div v-else-if="isBinaryFile" class="h-full flex items-center justify-center" style="background: #1e1e1e">
          <div class="text-center">
            <FileWarning class="w-12 h-12 mx-auto mb-3 text-neutral-600" />
            <p class="text-neutral-400 text-sm">This is a binary file and cannot be displayed</p>
            <p class="text-neutral-600 text-xs mt-1">{{ activeFile?.path.split('/').pop() }}</p>
          </div>
        </div>

        <!-- Rich text editor for markdown files -->
        <div v-show="isRichText(activeFile)" class="h-full overflow-auto file-rich-text" style="background: #1e1e1e">
          <TiptapEditor
            ref="tiptapEditorRef"
            v-if="isRichText(activeFile)"
            :key="activeFile.path"
            mode="editor"
            show-gutter
            :model-value="activeFile.content"
            @update:model-value="handleContentChange"
            @vue:mounted="emit('editorMount')"
            class="h-full p-4 ml-2"
          />
        </div>

        <ConflictView
          v-if="activeConflict"
          :path="activeDiff!.path"
          :conflict="activeConflict"
          @resolve="(side) => emit('resolveConflict', activeDiff!.path, side)"
        />
        <!-- Monaco editor for both regular files and diffs -->
        <div v-show="!activeConflict && !isTerminal(activeFile) && !isImage(activeFile) && !isVideoFile(activeFile) && !isBinaryFile && !isRichText(activeFile) && !isDeletedFile && !isImageDiff" class="h-full overflow-hidden flex flex-col">
          <DiffHunkBar
            v-if="diffHunks.length > 0"
            :hunks="diffHunks"
            :staged="activeDiff!.staged"
            :unsaved="'modified' in activeFile && activeFile.modified === true"
            :busy="isApplyingHunk === true"
            @reveal="revealLine"
            @apply="(hunk) => emit('applyHunk', activeDiff!.path, activeDiff!.staged, hunk.id)"
          />
          <!-- The editor's own box: its line-number layer is taller than it and slides upward as it scrolls, and
               would be drawn over the bar above without something to clip it -->
          <div class="flex-1 min-h-0 overflow-hidden">
            <MonacoEditor
              ref="monacoEditorRef"
              v-if="!isTerminal(activeFile) && !isImage(activeFile) && !isVideoFile(activeFile) && !isBinaryFile && !isRichText(activeFile) && !isDeletedFile && !isImageDiff"
              :model-value="activeFile.content"
              @update:model-value="handleContentChange"
              :file-path="activeFilePath || undefined"
              theme="vs-dark"
              :diff-mode="isDiffFile"
              :original-content="diffOriginalContent"
              :modified-content="diffModifiedContent"
              :read-only="isDiffReadOnly"
              :dsl-params="activeDslParams"
              class="h-full"
              @mount="emit('editorMount')"
              @file-ready="emit('editorFileReady')"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileCode, FileWarning, Video as VideoIcon } from 'lucide-vue-next'
import MonacoEditor from './MonacoEditor.vue'
import TerminalView from './TerminalView.vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import DeletedFileView from './DeletedFileView.vue'
import DiffHunkBar from './DiffHunkBar.vue'
import ConflictView from './ConflictView.vue'
import VideoPlayer from './VideoPlayer.vue'
import Tabs from './Tabs.vue'
import { isEditableDiff, type OpenFile, type TerminalTab, type TabGroup } from '#features/code/fe/state.ts'
import { nativeVideoExtensions } from '#features/code/fe/utils/file-icons.ts'
import type { ActionTab } from '#features/code/fe/features/actions/state.ts'
import type { PromptTab } from '#features/code/fe/features/prompts/state.ts'
import type { GitDiff } from '#features/code/fe/features/commit/state.ts'

// Props
const props = defineProps<{
  openFiles: (OpenFile | TerminalTab | ActionTab | PromptTab)[]
  activeFilePath: string | null
  baseDirectory?: string
  tabGroups: TabGroup[]
  /** Whether git was asked to stage or unstage one piece of a change and has not answered */
  isApplyingHunk?: boolean
  /** The pieces staged or unstaged since the open diff was read, which it still lists */
  appliedHunks?: string[]
}>()

// Emits
const emit = defineEmits<{
  selectFile: [path: string]
  closeFile: [path: string]
  contentChange: [path: string, content: string]
  reorder: [fromIndex: number, toIndex: number]
  'reveal-in-explorer': [path: string]
  'pin-tab': [path: string]
  'unpin-tab': [path: string]
  'pin-tab-at': [path: string, targetPath: string, side: 'left' | 'right']
  'unpin-tab-at': [path: string, targetPath: string, side: 'left' | 'right']
  'create-group': [name: string, tabPaths: string[]]
  'rename-group': [groupId: string, name: string]
  'change-group-color': [groupId: string, color: string]
  'delete-group': [groupId: string]
  'toggle-group-collapse': [groupId: string]
  'add-tab-to-group': [tabPath: string, groupId: string]
  'remove-tab-from-group': [path: string]
  'ungroup-all': [groupId: string]
  'close-all-in-group': [groupId: string]
  'pin-group': [groupId: string]
  'unpin-group': [groupId: string]
  'rename-terminal': [path: string, customTitle: string]
  'kill-terminal': [path: string]
  'move-to-panel': [path: string]
  'restart-terminal': [path: string]
  'promote-preview': [path: string]
  editorMount: []
  editorFileReady: []
  applyHunk: [path: string, staged: boolean, hunk: string]
  resolveConflict: [path: string, side: 'ours' | 'theirs']
}>()

// Helper to check if a file is a terminal
const isTerminal = (file: OpenFile | TerminalTab | ActionTab | PromptTab): file is TerminalTab => {
  return 'isTerminal' in file && file.isTerminal === true
}

// Helper to check if a file is an image
const isImage = (file: OpenFile | TerminalTab | ActionTab | PromptTab): boolean => {
  return 'isImage' in file && file.isImage === true
}

// Helper to check if a file is a video
const isVideoFile = (file: OpenFile | TerminalTab | ActionTab | PromptTab): boolean => {
  return 'isVideo' in file && file.isVideo === true
}

// Check if the active video file uses a Chromium-native format
const isNativeVideo = computed(() => {
  if (!activeFile.value || !isVideoFile(activeFile.value)) return false
  const ext = activeFile.value.path.split('.').pop()?.toLowerCase() || ''
  return nativeVideoExtensions.includes(ext)
})

// Helper to check if a file should use rich text editor
const isRichText = (file: OpenFile | TerminalTab | ActionTab | PromptTab): boolean => {
  return 'isRichText' in file && file.isRichText === true
}

// Helper to check if file is a diff
const isDiffFile = computed(() => {
  return activeFile.value && 'isDiff' in activeFile.value && activeFile.value.isDiff === true
})

// Regular files are editable; unstaged diffs are editable (right side = working tree); staged diffs stay read-only
const isDiffReadOnly = computed(() => {
  if (!activeFile.value) return true
  if (!isDiffFile.value) return false
  return !isEditableDiff(activeFile.value as OpenFile)
})

// Helper to check if file is an image diff (side-by-side comparison)
const isImageDiff = computed(() => {
  if (!isDiffFile.value || !activeFile.value) return false
  const diff = getDiffContent(activeFile.value)
  return diff?.isImage === true
})

// Helper to check if file is binary
const isBinaryFile = computed(() => {
  return activeFile.value && 'isBinary' in activeFile.value && activeFile.value.isBinary === true
})

// Helper to check if file is a deleted file placeholder
const isDeletedFile = computed(() => {
  return activeFile.value && 'isDeleted' in activeFile.value && activeFile.value.isDeleted === true
})

// Get diff content
const getDiffContent = (file: OpenFile | TerminalTab | ActionTab | PromptTab | undefined): GitDiff | null => {
  return file && 'gitDiff' in file ? file.gitDiff ?? null : null
}

// Computed
const activeFile = computed(() =>
  props.openFiles.find(f => f.path === props.activeFilePath)
)

const activeDslParams = computed(() => {
  const file = activeFile.value
  if (!file) return undefined
  if ('isAction' in file && file.isAction) {
    return (file as ActionTab).actionEntity.input
  }
  if ('isPrompt' in file && file.isPrompt) {
    return (file as PromptTab).promptEntity.inputs
  }
  return undefined
})

/** The diff the active tab shows, and the pieces of it that can be staged one at a time */
const activeDiff = computed(() => (isDiffFile.value ? getDiffContent(activeFile.value) : null))
/** A conflicted file's three sides, which are shown in place of the diff */
const activeConflict = computed(() => activeDiff.value?.conflict ?? null)
const diffHunks = computed(() => (activeDiff.value?.hunks ?? []).filter(hunk => !props.appliedHunks?.includes(hunk.id)))

const revealLine = (line: number) => {
  monacoEditorRef.value?.getEditor()?.revealLineInCenter(line)
}

const diffOriginalContent = computed(() => {
  if (!isDiffFile.value || !activeFile.value) return undefined
  const diff = getDiffContent(activeFile.value)
  return diff?.originalContent
})

const diffModifiedContent = computed(() => {
  if (!isDiffFile.value || !activeFile.value) return undefined
  // For editable (unstaged) diffs, don't pass modifiedContent as a prop —
  // let modelValue (activeFile.content) drive the modified editor instead,
  // so user edits aren't overwritten by the static gitDiff.modifiedContent.
  if (isEditableDiff(activeFile.value as OpenFile)) return undefined
  const diff = getDiffContent(activeFile.value)
  return diff?.modifiedContent
})

// Event handlers
const selectFile = (path: string) => {
  emit('selectFile', path)
}

const closeFile = (path: string) => {
  emit('closeFile', path)
}

const handleContentChange = (value: string) => {
  if (props.activeFilePath) {
    emit('contentChange', props.activeFilePath, value)
  }
}

const openVideoExternal = () => {
  if (activeFile.value) {
    window.electronAPI?.shell.openPath(activeFile.value.path)
  }
}

const monacoEditorRef = ref<InstanceType<typeof MonacoEditor>>()
const tiptapEditorRef = ref<InstanceType<typeof TiptapEditor>>()

defineExpose({
  getEditor: () => monacoEditorRef.value?.getEditor(),
  getTiptapEditor: () => tiptapEditorRef.value?.editor,
  isActiveFileRichText: () => activeFile.value ? isRichText(activeFile.value) : false,
})
</script>

<style>
.file-rich-text .tiptap-editor .ProseMirror {
  padding-left: 2.4rem;
}

.file-rich-text .tiptap-editor .block-drop-indicator {
  left: 2.4rem;
}
</style>
