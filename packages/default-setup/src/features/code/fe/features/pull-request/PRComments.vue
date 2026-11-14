<template>
  <div class="flex flex-col border-t border-neutral-800">
    <!-- Tab switcher -->
    <div class="flex items-center gap-0.5 px-3 py-2">
      <button
        @click="$emit('set-tab', 'discussion')"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
        :class="tab === 'discussion'
          ? 'text-neutral-200 bg-neutral-700/50'
          : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'"
      >
        <MessageSquare :size="12" />
        <span>Discussion</span>
        <span v-if="comments.length" class="text-xs text-neutral-500">({{ comments.length }})</span>
      </button>
      <button
        @click="$emit('set-tab', 'reviews')"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors"
        :class="tab === 'reviews'
          ? 'text-neutral-200 bg-neutral-700/50'
          : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'"
      >
        <Code :size="12" />
        <span>Reviews</span>
        <span v-if="reviewThreads.length" class="text-xs text-neutral-500">({{ reviewThreads.length }})</span>
      </button>
    </div>

    <!-- Discussion tab -->
    <div v-if="tab === 'discussion'" class="px-3 pb-3 space-y-3">
      <div v-if="comments.length === 0 && !isOpen" class="text-xs text-neutral-500 italic py-2">
        No comments yet.
      </div>

      <!-- Comment cards -->
      <div
        v-for="comment in comments"
        :key="comment.id"
        class="group rounded bg-neutral-800/40 border border-neutral-800 overflow-hidden"
      >
        <div class="flex items-center gap-2 px-3 py-1.5 bg-neutral-800/60">
          <span class="text-xs font-medium text-neutral-300">{{ comment.author.login }}</span>
          <span class="text-xs text-neutral-600 flex-1">{{ formatDate(comment.createdAt) }}</span>
          <!-- Actions for own comments (hide for pending/optimistic comments) -->
          <template v-if="comment.viewerDidAuthor && getCommentDatabaseId(comment)">
            <button
              v-if="editingCommentId !== comment.id"
              @click="startEditComment(comment)"
              class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-500 hover:text-neutral-300 transition-all"
              title="Edit"
            >
              <Pencil :size="10" />
            </button>
            <button
              @click="confirmDeleteComment(comment)"
              class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-500 hover:text-red-400 transition-all"
              title="Delete"
            >
              <Trash2 :size="10" />
            </button>
          </template>
        </div>
        <!-- Edit mode -->
        <div v-if="editingCommentId === comment.id" class="p-2 space-y-2">
          <div class="rounded bg-neutral-800 border border-neutral-700 p-2 min-h-[60px] max-h-[150px] overflow-y-auto">
            <TiptapEditor
              mode="editor"
              :modelValue="editCommentBody"
              @update:modelValue="editCommentBody = $event"
              editorClass="pr-comment-editor"
            />
          </div>
          <div class="flex items-center gap-1.5">
            <button
              @click="saveEditComment(comment)"
              :disabled="isSubmitting"
              class="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              <Loader2 v-if="isSubmitting" :size="10" class="animate-spin" />
              <span>Save</span>
            </button>
            <button
              @click="editingCommentId = null"
              class="px-2 py-0.5 text-xs rounded text-neutral-400 hover:bg-neutral-700 transition-colors"
            >Cancel</button>
          </div>
        </div>
        <!-- View mode -->
        <div v-else class="px-3 py-2">
          <TiptapEditor mode="viewer" :modelValue="comment.body" editorClass="pr-comment-viewer" />
        </div>
      </div>

      <!-- New comment input (only for open PRs) -->
      <div v-if="isOpen" class="relative rounded bg-neutral-800/40 border border-neutral-800 overflow-hidden">
        <div class="px-3 py-1.5 pb-8 min-h-[32px] max-h-[120px] overflow-y-auto">
          <TiptapEditor
            mode="editor"
            :modelValue="newCommentBody"
            @update:modelValue="newCommentBody = $event"
            placeholder="Write a comment..."
            editorClass="pr-comment-editor"
          />
        </div>
        <button
          @click="submitNewComment"
          :disabled="!newCommentBody.trim() || isSubmitting"
          class="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Loader2 v-if="isSubmitting" :size="10" class="animate-spin" />
          <Send v-else :size="10" />
          <span>Comment</span>
        </button>
      </div>
    </div>

    <!-- Reviews tab -->
    <div v-else-if="tab === 'reviews'" class="px-3 pb-3 space-y-3">
      <div v-if="reviewThreads.length === 0" class="text-xs text-neutral-500 italic py-2">
        No review comments.
      </div>

      <!-- Thread cards -->
      <div
        v-for="thread in reviewThreads"
        :key="thread.id"
        class="rounded bg-neutral-800/40 border border-neutral-800 overflow-hidden"
      >
        <!-- Thread header -->
        <div
          class="flex items-center gap-2 px-3 py-1.5 bg-neutral-800/60 cursor-pointer hover:bg-neutral-700/40 transition-colors"
          @click="toggleThread(thread.id)"
        >
          <ChevronRight
            :size="11"
            class="shrink-0 text-neutral-500 transition-transform"
            :class="{ 'rotate-90': expandedThreads.has(thread.id) }"
          />
          <div class="min-w-0 flex-1">
            <div class="text-xs text-neutral-300 truncate" :title="thread.path">
              {{ thread.path }}
            </div>
            <div class="text-[11px] text-neutral-500 truncate">
              {{ getThreadLocationLabel(thread) }}
            </div>
          </div>
          <span
            class="text-[11px] px-1.5 py-0.5 rounded-full shrink-0"
            :class="thread.isResolved
              ? 'bg-green-900/40 text-green-400'
              : 'bg-yellow-900/40 text-yellow-400'"
          >{{ thread.isResolved ? 'Resolved' : 'Unresolved' }}</span>
        </div>

        <!-- Thread comments (collapsible) -->
        <div v-if="expandedThreads.has(thread.id)" class="border-t border-neutral-800">
          <div v-if="getThreadDiffLines(thread).length" class="px-3 py-2 border-b border-neutral-800/50 bg-neutral-950/35 overflow-x-auto">
            <pre class="text-[11px] leading-5 font-mono whitespace-pre min-w-max"><span
              v-for="(line, lineIndex) in getThreadDiffLines(thread)"
              :key="lineIndex"
              class="block"
              :class="getDiffLineClass(line)"
            >{{ line.text }}</span></pre>
          </div>

          <div
            v-for="(comment, i) in thread.comments"
            :key="comment.id"
            class="group px-3 py-2"
            :class="{ 'border-t border-neutral-800/50': i > 0 }"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-medium text-neutral-300">{{ comment.author.login }}</span>
              <span class="text-xs text-neutral-600 flex-1">{{ formatDate(comment.createdAt) }}</span>
              <template v-if="comment.viewerDidAuthor && comment.databaseId > 0">
                <button
                  v-if="editingReviewCommentId !== comment.id"
                  @click="startEditReviewComment(comment)"
                  class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-500 hover:text-neutral-300 transition-all"
                  title="Edit"
                >
                  <Pencil :size="10" />
                </button>
                <button
                  @click="confirmDeleteReviewComment(comment)"
                  class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-500 hover:text-red-400 transition-all"
                  title="Delete"
                >
                  <Trash2 :size="10" />
                </button>
              </template>
            </div>
            <!-- Edit mode -->
            <div v-if="editingReviewCommentId === comment.id" class="space-y-2">
              <div class="rounded bg-neutral-800 border border-neutral-700 p-2 min-h-[60px] max-h-[150px] overflow-y-auto">
                <TiptapEditor
                  mode="editor"
                  :modelValue="editReviewCommentBody"
                  @update:modelValue="editReviewCommentBody = $event"
                  editorClass="pr-comment-editor"
                />
              </div>
              <div class="flex items-center gap-1.5">
                <button
                  @click="saveEditReviewComment(comment)"
                  :disabled="isSubmitting"
                  class="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                >
                  <Loader2 v-if="isSubmitting" :size="10" class="animate-spin" />
                  <span>Save</span>
                </button>
                <button
                  @click="editingReviewCommentId = null"
                  class="px-2 py-0.5 text-xs rounded text-neutral-400 hover:bg-neutral-700 transition-colors"
                >Cancel</button>
              </div>
            </div>
            <!-- View mode -->
            <TiptapEditor v-else mode="viewer" :modelValue="comment.body" editorClass="pr-comment-viewer" />
          </div>

          <!-- Reply form (above action row) -->
          <div v-if="replyingThreadId === thread.id" class="relative border-t border-neutral-800 rounded bg-neutral-800/40 overflow-hidden">
            <div class="px-3 py-1.5 pb-8 min-h-[32px] max-h-[100px] overflow-y-auto">
              <TiptapEditor
                mode="editor"
                :modelValue="replyBody"
                @update:modelValue="replyBody = $event"
                placeholder="Reply..."
                editorClass="pr-comment-editor"
              />
            </div>
            <div class="absolute bottom-1.5 right-1.5 flex items-center gap-1">
              <button
                @click="replyingThreadId = null"
                class="px-2 py-1 text-xs rounded text-neutral-400 hover:bg-neutral-700 transition-colors"
              >Cancel</button>
              <button
                @click="submitReply(thread)"
                :disabled="!replyBody.trim() || isSubmitting"
                class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                <Loader2 v-if="isSubmitting" :size="10" class="animate-spin" />
                <span>Reply</span>
              </button>
            </div>
          </div>

          <!-- Thread actions -->
          <div class="flex items-center gap-1.5 px-3 py-2 border-t border-neutral-800">
            <button
              @click="startReply(thread.id)"
              :disabled="isSubmitting"
              class="flex items-center gap-1 px-2 py-0.5 text-xs rounded text-neutral-400 hover:bg-neutral-700 transition-colors disabled:opacity-50"
            >
              <Reply :size="10" />
              <span>Reply</span>
            </button>

            <div class="flex-1" />

            <!-- Resolve/Unresolve -->
            <button
              @click="handleResolveToggle(thread)"
              :disabled="resolvingThreadId === thread.id"
              class="flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors disabled:opacity-50"
              :class="thread.isResolved
                ? 'text-yellow-400 hover:bg-yellow-900/30'
                : 'text-green-400 hover:bg-green-900/30'"
            >
              <Loader2 v-if="resolvingThreadId === thread.id" :size="10" class="animate-spin" />
              <CheckCircle v-else :size="10" />
              <span>{{ thread.isResolved ? 'Unresolve' : 'Resolve' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  MessageSquare, Code, Pencil, Trash2, Send, Loader2,
  ChevronRight, Reply, CheckCircle
} from 'lucide-vue-next'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import type { GhPRComment, GhReviewThread, GhReviewComment } from '#generated/types.ts'
import { getCommentDatabaseId } from './comment-id.ts'
import type { WriteAnswer } from './state.ts'

const props = defineProps<{
  comments: GhPRComment[]
  reviewThreads: GhReviewThread[]
  tab: 'discussion' | 'reviews'
  prNumber: number
  isOpen: boolean
  isSubmitting: boolean
  /** How the last write a form waits on was answered: each form lets go of its text on its own success only */
  answered?: WriteAnswer | null
}>()

const emit = defineEmits<{
  'set-tab': [tab: 'discussion' | 'reviews']
  'create-comment': [body: string]
  'edit-comment': [commentId: number, body: string]
  'delete-comment': [commentId: number]
  'reply-thread': [prNumber: number, commentId: number, body: string]
  'resolve-thread': [threadId: string]
  'unresolve-thread': [threadId: string]
  'edit-review-comment': [commentId: number, body: string]
  'delete-review-comment': [commentId: number]
}>()

// New comment
const newCommentBody = ref('')

const awaitingNewComment = ref(false)

function submitNewComment() {
  if (!newCommentBody.value.trim()) return
  emit('create-comment', newCommentBody.value)
  awaitingNewComment.value = true
}

// Edit comment
const editingCommentId = ref<string | null>(null)
const editCommentBody = ref('')

function startEditComment(comment: GhPRComment) {
  editingCommentId.value = comment.id
  editCommentBody.value = comment.body
}

function confirmDeleteComment(comment: GhPRComment) {
  const id = getCommentDatabaseId(comment)
  if (id && confirm('Delete this comment? This cannot be undone.')) {
    emit('delete-comment', id)
  }
}

function saveEditComment(comment: GhPRComment) {
  const id = getCommentDatabaseId(comment)
  if (!id) return
  emit('edit-comment', id, editCommentBody.value)
}

// Review thread state
const resolvingThreadId = ref<string | null>(null)
const expandedThreads = ref(new Set<string>())

watch(() => props.reviewThreads, () => {
  resolvingThreadId.value = null
})
const replyingThreadId = ref<string | null>(null)
const replyBody = ref('')
/** The comment a sent reply answers, while GitHub has not taken it */
const replyingTo = ref<number | null>(null)
const editingReviewCommentId = ref<string | null>(null)
const editReviewCommentBody = ref('')

function startEditReviewComment(comment: GhReviewComment) {
  editingReviewCommentId.value = comment.id
  editReviewCommentBody.value = comment.body
}

function saveEditReviewComment(comment: GhReviewComment) {
  emit('edit-review-comment', comment.databaseId, editReviewCommentBody.value)
}

function confirmDeleteReviewComment(comment: GhReviewComment) {
  if (confirm('Delete this comment? This cannot be undone.')) {
    emit('delete-review-comment', comment.databaseId)
  }
}

function toggleThread(threadId: string) {
  if (expandedThreads.value.has(threadId)) {
    expandedThreads.value.delete(threadId)
  } else {
    expandedThreads.value.add(threadId)
  }
}

function startReply(threadId: string) {
  replyingThreadId.value = threadId
  replyBody.value = ''
}

function submitReply(thread: GhReviewThread) {
  if (!replyBody.value.trim() || !thread.comments.length) return
  // Reply to the last comment in the thread
  const lastComment = thread.comments[thread.comments.length - 1]
  emit('reply-thread', props.prNumber, lastComment.databaseId, replyBody.value)
  replyingTo.value = lastComment.databaseId
}

/** The id an edit form is open on, as GitHub numbers it */
const editingCommentDatabaseId = (): number | null => {
  const comment = props.comments.find(c => c.id === editingCommentId.value)
  return comment ? getCommentDatabaseId(comment) : null
}
const editingReviewCommentDatabaseId = (): number | null =>
  props.reviewThreads.flatMap(t => t.comments).find(c => c.id === editingReviewCommentId.value)?.databaseId ?? null

// Each form keeps what was typed until GitHub has taken it, so a refused write loses nothing
watch(() => props.answered, (answer) => {
  if (!answer) return
  if (answer.write === 'create-comment' && awaitingNewComment.value && answer.target === props.prNumber) {
    awaitingNewComment.value = false
    if (answer.ok) newCommentBody.value = ''
  }
  if (!answer.ok) return
  if (answer.write === 'edit-comment' && answer.target === editingCommentDatabaseId()) editingCommentId.value = null
  if (answer.write === 'edit-review-comment' && answer.target === editingReviewCommentDatabaseId()) editingReviewCommentId.value = null
  if (answer.write === 'reply' && answer.target === replyingTo.value) {
    replyingThreadId.value = null
    replyBody.value = ''
    replyingTo.value = null
  }
})

function handleResolveToggle(thread: GhReviewThread) {
  resolvingThreadId.value = thread.id
  if (thread.isResolved) {
    emit('unresolve-thread', thread.id)
  } else {
    expandedThreads.value.delete(thread.id)
    emit('resolve-thread', thread.id)
  }
}

type DiffLine = {
  text: string
  kind: 'context' | 'added' | 'removed' | 'meta'
}

function getThreadLocationLabel(thread: GhReviewThread): string {
  if (thread.subjectType === 'FILE') return 'Comment on file'

  const startLine = thread.startLine ?? thread.originalStartLine ?? null
  const endLine = thread.line ?? thread.originalLine ?? null
  if (startLine && endLine && startLine !== endLine) {
    return `Comment on lines +${startLine} to +${endLine}`
  }
  if (endLine) return `Comment on line +${endLine}`
  return 'Comment on file'
}

function getThreadDiffLines(thread: GhReviewThread): DiffLine[] {
  const diffHunk = thread.diffHunk || thread.comments.find(comment => comment.diffHunk)?.diffHunk
  if (!diffHunk) return []

  return diffHunk.split('\n').map(text => ({
    text,
    kind: getDiffLineKind(text),
  }))
}

function getDiffLineKind(text: string): DiffLine['kind'] {
  if (text.startsWith('@@')) return 'meta'
  if (text.startsWith('+') && !text.startsWith('+++')) return 'added'
  if (text.startsWith('-') && !text.startsWith('---')) return 'removed'
  return 'context'
}

function getDiffLineClass(line: DiffLine): string {
  if (line.kind === 'added') return 'text-green-300 bg-green-950/30'
  if (line.kind === 'removed') return 'text-red-300 bg-red-950/30'
  if (line.kind === 'meta') return 'text-blue-300'
  return 'text-neutral-400'
}

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
:deep(.pr-comment-viewer) {
  font-size: 0.6875rem;
  line-height: 1.5;
  color: rgb(212 212 212);
}
:deep(.pr-comment-viewer .tiptap) {
  padding: 0;
}
:deep(.pr-comment-editor) {
  font-size: 0.6875rem;
  line-height: 1.5;
  color: rgb(212 212 212);
}
:deep(.pr-comment-editor .tiptap) {
  padding: 0;
  min-height: 24px;
}
:deep(.pr-comment-viewer img),
:deep(.pr-comment-editor img) {
  max-height: 150px;
  width: auto;
  object-fit: contain;
}
</style>
