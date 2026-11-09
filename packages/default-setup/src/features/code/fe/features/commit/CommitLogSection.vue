<template>
  <!-- Commits resize handle -->
  <PanelResizer
    v-if="commitLog.length > 0 && isCommitsExpanded"
    orientation="vertical"
    subtle
    @resize="onCommitsResize"
  />

  <!-- Commits Section -->
  <div v-if="commitLog.length > 0" class="flex-shrink-0 border-t border-neutral-800">
    <div class="flex items-center justify-between p-3 px-5 cursor-pointer hover:bg-neutral-800/60 transition-colors" @click="toggleCommitsExpanded">
      <div class="flex items-center gap-1 text-xs font-medium text-neutral-400">
        <ChevronRight v-if="!isCommitsExpanded" class="w-3 h-3" />
        <ChevronDown v-else class="w-3 h-3" />
        COMMITS ({{ commitSearchQuery.trim() ? `${filteredCommits.length}/` : '' }}{{ commitLog.length }})
      </div>
      <div class="flex items-center gap-1" @click.stop>
        <button @click="toggleCommitSearch" class="p-1 hover:bg-neutral-700 rounded transition-colors" :class="showCommitSearch ? 'bg-neutral-700' : ''" title="Search Commits">
          <Search class="w-3.5 h-3.5 text-neutral-400" />
        </button>
        <button @click="refreshCommitLog" class="p-1 hover:bg-neutral-700 rounded transition-colors" title="Refresh Commit Log">
          <RefreshCw class="w-3.5 h-3.5 text-neutral-400" />
        </button>
      </div>
    </div>
    <div v-if="isCommitsExpanded" class="overflow-y-auto pb-3" :style="{ maxHeight: commitsHeight + 'px' }">
      <div v-if="showCommitSearch" class="pl-5 pr-3 mb-1.5">
        <div class="relative">
        <Search :size="12" class="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
        <input
          ref="commitSearchInput"
          v-model="commitSearchQuery"
          placeholder="Search commits..."
          class="w-full pl-7 pr-7 py-1 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
          @click.stop
        />
        <button
          v-if="commitSearchQuery"
          @click.stop="commitSearchQuery = ''"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-neutral-700 rounded"
        >
          <X :size="12" class="text-neutral-400" />
        </button>
        </div>
      </div>
      <div class="space-y-0.5 pl-3">
        <div
          v-for="entry in filteredCommits"
          :key="entry.hash"
          class="group px-2 py-1.5 rounded hover:bg-neutral-800/50 transition-colors"
        >
          <div class="flex items-center gap-2 min-w-0">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <div class="text-xs text-neutral-200 truncate" :title="entry.body ? `${entry.subject}\n\n${entry.body}` : entry.subject">{{ entry.subject }}</div>
                <span v-if="entry.refs" class="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-500/20 text-blue-400 whitespace-nowrap">{{ formatRefs(entry.refs) }}</span>
              </div>
              <div class="text-[11px] text-neutral-500 truncate">{{ entry.shortHash }} · {{ entry.authorName }} · {{ formatCommitDate(entry.date) }}</div>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button @click.stop="openRevertCommitDialog(entry)" class="p-0.5 hover:bg-neutral-700 rounded" title="Revert this commit">
                <Undo2 class="w-3 h-3 text-neutral-400" />
              </button>
              <button @click.stop="resetToCommit(entry)" class="p-0.5 hover:bg-neutral-700 rounded" title="Reset to this commit">
                <RotateCw class="w-3 h-3 text-neutral-400" />
              </button>
              <button @click.stop="copyCommitHash(entry)" class="p-0.5 hover:bg-neutral-700 rounded" title="Copy commit hash">
                <Copy class="w-3 h-3 text-neutral-400" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Revert Commit Dialog -->
  <RevertDialog
    :show="showRevertCommitDialog"
    :file="null"
    :customTitle="'Revert Commit'"
    :customMessage="`Are you sure you want to revert commit ${pendingCommitShortHash}? This will create a new commit that undoes the changes.`"
    @confirm="confirmRevertCommit"
    @cancel="cancelRevertCommit"
  />

</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { ref, computed, nextTick } from 'vue'
import { useSelector } from '@xstate/vue'
import type { CodeState } from '#features/code/fe/state.ts'
import type { CommitLogEntry } from '#features/code/fe/features/commit/state.ts'
import { ChevronDown, ChevronRight, RefreshCw, Undo2, RotateCw, Copy, Search, X } from 'lucide-vue-next'
import RevertDialog from '#features/code/fe/features/commit/RevertDialog.vue'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'
import { panelChild } from '../children.ts';

const props = defineProps<{
  toast: { success: (title: string, message: string) => void } | undefined
}>()

const codeActor: CodeState = useSurface()
const commitActor = panelChild(codeActor, 'commit')!

const commitLog = useSelector(commitActor, (state) => state.context.commitLog) as import('vue').Ref<CommitLogEntry[]>

// Search state
const showCommitSearch = ref(false)
const commitSearchQuery = ref('')
const commitSearchInput = ref<HTMLInputElement | null>(null)

// Local state
const isCommitsExpanded = ref(false)
const MIN_COMMITS_HEIGHT = 80
const MAX_COMMITS_HEIGHT = 400
const commitsHeight = ref(192)
const showRevertCommitDialog = ref(false)
const pendingCommitHash = ref<string | null>(null)
const pendingCommitShortHash = ref('')

const onCommitsResize = (delta: number) => {
  commitsHeight.value = Math.max(MIN_COMMITS_HEIGHT, Math.min(MAX_COMMITS_HEIGHT, commitsHeight.value - delta))
}

const toggleCommitsExpanded = () => {
  isCommitsExpanded.value = !isCommitsExpanded.value
  if (!isCommitsExpanded.value && showCommitSearch.value) {
    showCommitSearch.value = false
    commitSearchQuery.value = ''
  }
}

const refreshCommitLog = () => {
  commitActor?.send({ type: 'commit.LOG_LIST' })
}

const openRevertCommitDialog = (entry: CommitLogEntry) => {
  pendingCommitHash.value = entry.hash
  pendingCommitShortHash.value = entry.shortHash
  showRevertCommitDialog.value = true
}

const confirmRevertCommit = () => {
  if (pendingCommitHash.value) {
    commitActor?.send({ type: 'commit.REVERT_COMMIT', hash: pendingCommitHash.value })
  }
  showRevertCommitDialog.value = false
  pendingCommitHash.value = null
  pendingCommitShortHash.value = ''
}

const cancelRevertCommit = () => {
  showRevertCommitDialog.value = false
  pendingCommitHash.value = null
  pendingCommitShortHash.value = ''
}

const resetToCommit = (entry: CommitLogEntry) => {
  commitActor?.send({ type: 'commit.RESET_TO_COMMIT', hash: entry.hash })
}

const copyCommitHash = (entry: CommitLogEntry) => {
  navigator.clipboard.writeText(entry.hash)
  props.toast?.success('Copied', 'Commit hash copied to clipboard')
}

const filteredCommits = computed(() => {
  const query = commitSearchQuery.value.trim()
  if (!query) return commitLog.value
  const lowerQuery = query.toLowerCase()
  return commitLog.value.filter((entry: CommitLogEntry) => {
    const text = `${entry.subject} ${entry.shortHash} ${entry.authorName} ${entry.refs}`.toLowerCase()
    return text.includes(lowerQuery)
  })
})

const toggleCommitSearch = async () => {
  showCommitSearch.value = !showCommitSearch.value
  if (showCommitSearch.value) {
    await nextTick()
    commitSearchInput.value?.focus()
  } else {
    commitSearchQuery.value = ''
  }
}

const formatCommitDate = (dateStr: string) => {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    const diffMonths = Math.floor(diffDays / 30)
    if (diffMonths < 12) return `${diffMonths}mo ago`
    return `${Math.floor(diffMonths / 12)}y ago`
  } catch {
    return dateStr
  }
}

const formatRefs = (refs: string) => {
  if (!refs) return ''
  return refs.split(',')[0].trim().replace(/^HEAD -> /, '')
}
</script>
