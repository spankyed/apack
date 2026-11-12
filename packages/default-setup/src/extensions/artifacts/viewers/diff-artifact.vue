<template>
  <div class="flex h-full gap-3">
    <!-- File list (left) -->
    <div class="w-56 flex-shrink-0 overflow-y-auto rounded-lg border border-neutral-700/50 bg-neutral-900/60">
      <div class="px-3 py-2 border-b border-neutral-700/30 text-[11px] text-neutral-500 tracking-wide">
        {{ content.summary || 'No changes' }}
      </div>
      <div class="py-1">
        <button
          v-for="(file, idx) in content.files"
          :key="file.path"
          type="button"
          class="group w-full text-left px-3 py-1.5 transition-colors"
          :class="selectedIdx === Number(idx)
            ? 'bg-neutral-800/70'
            : 'hover:bg-neutral-800/40'"
          @click="selectedIdx = Number(idx)"
        >
          <div class="flex items-center gap-2">
            <component :is="changeIcon(file.changeType)" :size="11" :class="changeIconClass(file.changeType)" class="flex-shrink-0" />
            <span class="text-xs font-mono text-neutral-300 truncate flex-1" :title="file.path">
              {{ shortenPath(file.path) }}
            </span>
            <span class="text-[10px] tabular-nums flex-shrink-0 space-x-0.5">
              <span v-if="file.added" class="text-green-500/80">+{{ file.added }}</span>
              <span v-if="file.removed" class="text-red-500/80">-{{ file.removed }}</span>
            </span>
          </div>
        </button>
      </div>
      <div v-if="content.files.length === 0" class="px-3 py-8 text-xs text-neutral-500 text-center">
        No files in this diff
      </div>
      <!-- An agent's turn: every file it changed, whatever wrote it, and the offer to take the turn back whole -->
      <div v-if="content.turn" data-testid="turn-changes" class="border-t border-neutral-700/30 px-3 py-2 space-y-1">
        <div class="text-[11px] text-neutral-500">
          This turn {{ content.turn.changes.length === 1 ? 'changed one file' : `changed ${content.turn.changes.length} files` }}
        </div>
        <div v-for="change in content.turn.changes" :key="change.path" class="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
          <component :is="changeIcon(change.change)" :size="10" :class="changeIconClass(change.change)" class="flex-shrink-0" />
          <span class="truncate" :title="change.path">{{ shortenPath(change.path) }}</span>
        </div>
        <div v-if="content.turn.takenBack" class="text-[11px] text-neutral-500">Taken back: the files are as they were before this turn.</div>
        <button
          v-else-if="content.turn.changes.length > 0"
          data-testid="take-back-turn"
          type="button"
          class="mt-1 w-full px-2 py-1 rounded text-xs text-neutral-200 bg-neutral-800 hover:bg-neutral-700"
          @click="takeBack"
        >Take back this turn</button>
      </div>
    </div>

    <!-- Monaco diff viewer (right) -->
    <div class="flex-1 overflow-hidden rounded-lg border border-neutral-700/50">
      <div v-if="!selectedFile" class="flex items-center justify-center h-full text-xs text-neutral-600 bg-neutral-900">
        Select a file to view its diff
      </div>
      <div v-else class="diff-container h-full">
        <UnifiedMonacoEditor
          :key="selectedFile.path"
          :model-value="versions.modified"
          mode="diff"
          :diff-original="versions.original"
          :diff-modified="versions.modified"
          :language="fileLanguage"
          :read-only="true"
          :file-path="selectedFile.path"
          preset="readonly"
          :diff-options="diffEditorOptions"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { sendToSystem } from '#generated/events.ts'
import { useSurfaceState } from '#generated/fe.ts'
import { FilePlus2, FileMinus2, FilePenLine, ArrowRightLeft } from 'lucide-vue-next'
import type { ArtifactItem } from '@apackdev/sdk/artifacts'
import type { DiffArtifactContent } from '#features/threads/be/types.ts'
import UnifiedMonacoEditor from '@apackdev/ui/components/UnifiedMonacoEditor'
import { getLanguageFromPath } from '@apackdev/ui/components/monaco-config'

type DiffFile = DiffArtifactContent['files'][number]

const props = defineProps<{
  artifact: ArtifactItem<DiffArtifactContent>
}>()

const content = computed(() => props.artifact.content)

const currentThread = useSurfaceState('threads', (s) => s.currentThread)

/** Asks for the turn to be taken back, through the flows: the files go back as they were when it started */
function takeBack() {
  const turn = content.value.turn
  const threadId = currentThread.value?.id
  if (!turn || !threadId) return
  sendToSystem('threads', {
    type: 'FORWARD_BRAIN_EVENT',
    eventType: 'user.turn.takeBack',
    payload: { threadId, artifactId: props.artifact.id, checkpoint: turn.checkpoint },
  })
}

const selectedIdx = ref(0)
const selectedFile = computed(() => content.value.files[selectedIdx.value])

const fileLanguage = computed(() =>
  selectedFile.value ? getLanguageFromPath(selectedFile.value.path) : 'plaintext'
)

/** Extract original and modified content from a unified diff patch. */
function patchToVersions(patch: string): { original: string; modified: string } {
  const lines = patch.split('\n')
  const original: string[] = []
  const modified: string[] = []

  for (const line of lines) {
    // Skip diff headers
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('rename ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) continue

    // Skip hunk headers
    if (line.startsWith('@@')) continue

    if (line.startsWith('+')) {
      modified.push(line.slice(1))
    } else if (line.startsWith('-')) {
      original.push(line.slice(1))
    } else {
      // Context line (starts with space) or empty line
      const content = line.startsWith(' ') ? line.slice(1) : line
      original.push(content)
      modified.push(content)
    }
  }

  return {
    original: original.join('\n'),
    modified: modified.join('\n'),
  }
}

const versions = computed(() =>
  selectedFile.value ? patchToVersions(selectedFile.value.patch) : { original: '', modified: '' }
)

const diffEditorOptions = {
  // Diff-specific
  renderSideBySide: false,
  renderMarginRevertIcon: false,
  renderGutterMenu: false,
  renderIndicators: false,
  renderOverviewRuler: false,
  compactMode: true,
  // Editor chrome
  originalEditable: false,
  contextmenu: false,
  lineNumbers: 'off',
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 0,
  scrollBeyondLastLine: false,
}

function changeIcon(type: DiffFile['changeType']) {
  switch (type) {
    case 'added': return FilePlus2
    case 'deleted': return FileMinus2
    case 'renamed': return ArrowRightLeft
    default: return FilePenLine
  }
}

function changeIconClass(type: DiffFile['changeType']): string {
  switch (type) {
    case 'added': return 'text-green-500'
    case 'deleted': return 'text-red-500'
    case 'renamed': return 'text-blue-400'
    default: return 'text-neutral-400'
  }
}

function shortenPath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 3) return path
  return `…/${segments.slice(-3).join('/')}`
}
</script>

<style scoped>
/* Soften Monaco's default diff colors */
.diff-container :deep(.monaco-editor .line-delete) {
  background-color: rgba(248, 81, 73, 0.10) !important;
}
.diff-container :deep(.monaco-editor .char-delete) {
  background-color: rgba(248, 81, 73, 0.22) !important;
}
.diff-container :deep(.monaco-editor .line-insert) {
  background-color: rgba(63, 185, 80, 0.10) !important;
}
.diff-container :deep(.monaco-editor .char-insert) {
  background-color: rgba(63, 185, 80, 0.22) !important;
}

/* Horizontal padding inside diff highlighted regions */
.diff-container :deep(.monaco-editor .view-lines > .view-line) {
  padding-left: 12px !important;
  padding-right: 12px !important;
}
.diff-container :deep(.monaco-editor .line-delete .view-line) {
  padding-left: 12px !important;
  padding-right: 12px !important;
}
</style>
