<template>
  <div ref="scrollContainer" class="flex flex-col flex-1 overflow-y-auto">
    <div v-if="pr" class="p-3 space-y-3">
      <!-- PR Header -->
      <div class="pb-3 border-b border-neutral-800">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <!-- Title: editable or read-only -->
            <input
              v-if="editing"
              v-model="editTitle"
              class="w-full text-sm font-medium bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-neutral-100 focus:outline-none focus:border-blue-600"
            />
            <div v-else class="text-base font-medium text-neutral-100 leading-snug">
              {{ pr.title }}
            </div>

            <!-- Branch info -->
            <div :class="['flex items-center gap-1 text-xs text-neutral-600', editing ? 'mt-2' : 'mt-0.5']">
              <GitBranch :size="10" class="shrink-0" />
              <span class="truncate" :title="pr.headRefName">{{ pr.headRefName }}</span>
              <ArrowRight :size="10" class="shrink-0" />
              <!-- Base branch: editable or read-only -->
              <select
                v-if="editing"
                v-model="editBase"
                class="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-xs text-neutral-200 focus:outline-none focus:border-blue-600 cursor-pointer truncate"
                :style="{ maxWidth: `${Math.min(editBase.length + 4, 24)}ch` }"
              >
                <option v-for="branch in branchOptions" :key="branch" :value="branch">{{ branch }}</option>
              </select>
              <span v-else class="truncate" :title="pr.baseRefName">{{ pr.baseRefName }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <span v-if="!editing" class="text-sm text-neutral-500 shrink-0 py-1.5">#{{ pr.number }}</span>
            <!-- Edit toggle (only for OPEN PRs) -->
            <button
              v-if="pr.state === 'OPEN' && !editing"
              @click="startEditing"
              class="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors"
              title="Edit PR"
            >
              <Pencil :size="14" />
            </button>
            <button v-if="!editing" @click="openOnGitHub" class="p-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors" title="View on GitHub">
              <ExternalLink :size="14" />
            </button>
          </div>
        </div>
        <div class="flex items-center gap-1.5 mt-2 text-xs text-neutral-500">
          <span class="text-[11px] px-1.5 py-0.5 rounded-full shrink-0" :class="statusBadgeClass">
            {{ statusLabel }}
          </span>
          <span>&middot;</span>
          <span>{{ pr.author.login }}</span>
          <span>&middot;</span>
          <span>{{ formatDate(pr.createdAt) }}</span>
          <template v-if="pr.commits?.length">
            <span>&middot;</span>
            <button @click="showCommits = !showCommits" :class="['transition-colors cursor-pointer', showCommits ? 'text-neutral-200 underline' : 'hover:text-neutral-300']">
              {{ pr.commits.length }} commit{{ pr.commits.length !== 1 ? 's' : '' }}
            </button>
          </template>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="isLoading" class="flex items-center justify-center gap-2 py-6">
        <Loader2 class="w-4 h-4 animate-spin text-neutral-500" />
        <span class="text-xs text-neutral-500">Loading details...</span>
      </div>

      <template v-else>
      <!-- PR Body -->
      <div v-if="editing" class="min-h-[120px] max-h-[350px] overflow-y-auto rounded bg-neutral-800 border border-neutral-700 p-2">
        <TiptapEditor
          mode="editor"
          :modelValue="editBody"
          @update:modelValue="editBody = $event"
          placeholder="Describe your changes..."
          editorClass="pr-markdown"
        />
      </div>
      <div v-else-if="showCommits && pr.commits?.length" class="space-y-0.5">
        <button
          v-for="commit in [...pr.commits].reverse()"
          :key="commit.oid"
          @click="openCommitOnGitHub(commit.oid)"
          class="flex items-center gap-2 text-sm w-full text-left px-1 py-0.5 rounded hover:bg-neutral-800 transition-colors"
          :title="commit.messageHeadline"
        >
          <span class="text-neutral-300 truncate flex-1">{{ commit.messageHeadline }}</span>
          <span class="text-neutral-500 text-[11px] shrink-0">{{ formatDate(commit.committedDate) }}</span>
        </button>
      </div>
      <div v-else-if="pr.body" class="pr-body">
        <TiptapEditor mode="viewer" :modelValue="pr.body" editorClass="pr-markdown" @imageClick="openLightbox" />
      </div>
      <div v-else class="text-xs text-neutral-500 italic">
        No description provided.
      </div>

      <!-- Edit actions -->
      <div v-if="editing" class="flex items-center gap-2">
        <button
          @click="save"
          :disabled="isUpdating"
          class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
        >
          <Loader2 v-if="isUpdating" :size="11" class="animate-spin" />
          <span>Save</span>
        </button>
        <button
          @click="cancelEditing"
          :disabled="isUpdating"
          class="px-2.5 py-1 text-xs rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-colors disabled:opacity-50"
        >Cancel</button>
      </div>

      <!-- Comments slot -->
      <slot />
      </template>
    </div>

    <div v-else class="flex items-center justify-center flex-1 text-xs text-neutral-500">
      Select a pull request to view details
    </div>

    <ImageLightbox v-model="lightboxOpen" :imageSrc="lightboxSrc" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, useTemplateRef } from 'vue'
import { GitBranch, ArrowRight, Loader2, Pencil, ExternalLink } from 'lucide-vue-next'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import ImageLightbox from '@apackdev/ui/design/ImageLightbox'
import type { GhPullRequest, GhPRComment } from '#generated/types.ts'
import type { WriteAnswer } from './state.ts'
import { openLink } from '@apackdev/sdk/fe'

const props = defineProps<{
  pr: GhPullRequest | null
  comments: GhPRComment[]
  branches: string[]
  isLoading?: boolean
  isUpdating?: boolean
  /** How the last write a form waits on was answered: the edit is left on its own success */
  answered?: WriteAnswer | null
}>()

const emit = defineEmits<{
  'save': [data: { title?: string; body?: string; base?: string }]
  'start-editing': []
}>()

const lightboxOpen = ref(false)
const lightboxSrc = ref('')
const scrollContainer = useTemplateRef<HTMLElement>('scrollContainer')

// Preserve scroll position across re-renders (e.g., after comment mutations refresh PR data)
let savedScrollTop = 0
watch(() => props.pr, () => {
  savedScrollTop = scrollContainer.value?.scrollTop ?? 0
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = savedScrollTop
    }
  })
})

function openOnGitHub() {
  if (props.pr?.url) {
    openLink(props.pr.url)
  }
}

function openCommitOnGitHub(oid: string) {
  if (props.pr?.url) {
    openLink(`${props.pr.url}/commits/${oid}`)
  }
}

function openLightbox(src: string) {
  lightboxSrc.value = src
  lightboxOpen.value = true
}

const showCommits = ref(false)

// Edit mode
const editing = ref(false)
const editTitle = ref('')
const editBody = ref('')
const editBase = ref('')

const branchOptions = computed(() => {
  if (props.branches.length === 0 && props.pr?.baseRefName) {
    return [props.pr.baseRefName]
  }
  if (props.pr?.baseRefName && !props.branches.includes(props.pr.baseRefName)) {
    return [props.pr.baseRefName, ...props.branches]
  }
  return props.branches
})

function startEditing() {
  if (!props.pr) return
  editTitle.value = props.pr.title
  // The description as written: what is shown has its images at signed addresses that expire
  editBody.value = props.pr.rawBody ?? props.pr.body ?? ''
  editBase.value = props.pr.baseRefName
  editing.value = true
  emit('start-editing')
}

function cancelEditing() {
  editing.value = false
}

function save() {
  if (!props.pr) return
  const changes: { title?: string; body?: string; base?: string } = {}
  if (editTitle.value !== props.pr.title) changes.title = editTitle.value
  if (editBody.value !== (props.pr.rawBody ?? props.pr.body ?? '')) changes.body = editBody.value
  if (editBase.value !== props.pr.baseRefName) changes.base = editBase.value
  if (Object.keys(changes).length > 0) {
    emit('save', changes)
  } else {
    editing.value = false
  }
}

// The edit is left once GitHub has taken it, and kept when it refused it, so nothing typed is lost
watch(() => props.answered, (answer) => {
  if (answer?.write === 'update-pr' && answer.ok && answer.target === props.pr?.number) {
    editing.value = false
  }
})

// An edit belongs to the pull request it was started on
watch(() => props.pr?.number, () => {
  editing.value = false
})

const statusLabel = computed(() => {
  if (!props.pr) return ''
  if (props.pr.isDraft) return 'Draft'
  return props.pr.state === 'OPEN' ? 'Open' : props.pr.state
})

const statusBadgeClass = computed(() => {
  if (!props.pr) return ''
  if (props.pr.isDraft) return 'bg-neutral-700 text-neutral-300'
  if (props.pr.state === 'OPEN') return 'bg-green-900/50 text-green-400'
  if (props.pr.state === 'MERGED') return 'bg-purple-900/50 text-purple-400'
  return 'bg-red-900/50 text-red-400'
})

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60))
      if (diffMins <= 0) return 'just now'
      return `${diffMins}m ago`
    }
    return `${diffHours}h ago`
  }
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
</script>

<style scoped>
:deep(.pr-markdown) {
  font-size: 0.6875rem;
  line-height: 1.5;
  color: rgb(212 212 212);
}
:deep(.pr-markdown .tiptap) {
  padding: 0;
}
:deep(.pr-markdown img) {
  max-height: 200px;
  width: auto;
  object-fit: contain;
}
:deep(.pr-markdown h1),
:deep(.pr-markdown h2),
:deep(.pr-markdown h3) {
  font-size: 0.8rem;
  font-weight: 600;
  margin: 0.5rem 0 0.25rem;
}
</style>
