<template>
  <form :style="promptThemeStyle" class="native-agent-composer mx-4 mb-4 min-w-0 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#202022]" aria-label="Agent message" @submit.prevent="submit" @keydown.capture="leaveEditor">
    <StatusLine :native-status="statusText" :native-ui="ui" :native-focus="focus" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)" @scroll="emit('scroll', $event)" @focus-report="emit('focus-report', $event)" @return-focus="editorRef?.editor?.commands.focus()" />
    <TiptapEditor ref="editorRef" mode="input" variant="chat" :disable-images="true" :model-value="draft" :disabled="disabled" placeholder="Message this Agent" editor-class="native-agent-editor max-h-40 min-h-20 overflow-y-auto px-4 py-3 text-sm leading-6 outline-none" @update:model-value="updateDraft" @submit="submit" />
    <div v-if="offers.length" role="group" aria-label="Claude suggestions" class="max-h-32 overflow-y-auto border-t border-white/10">
      <button v-for="(row, index) in offers" :key="index" type="button" class="block w-full px-4 py-2 text-left text-xs text-neutral-300 hover:bg-white/5" @mousedown.prevent @click="bridge?.selectCompletion(index, row.offerId)">{{ row.label ?? row.text }}</button>
    </div>
    <p v-if="problem || nativeProblem" role="alert" class="px-4 pb-2 text-xs text-red-300">{{ problem || nativeProblem }}</p>
    <div class="flex items-center justify-between gap-3 px-4 pb-3">
      <span class="truncate text-[11px] text-neutral-500">{{ disabled ? 'Agent input unavailable' : 'Enter to send · Shift+Enter for a new line' }}</span>
      <button type="submit" class="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40" :disabled="disabled || submitting || !draft.trim()">{{ submitting ? 'Sending…' : 'Send to Agent' }}</button>
    </div>
  </form>
</template>
<script setup lang="ts">
import type { ClaudeNativeAgentInputReview } from '#features/code/common/native-terminal.ts'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import StatusLine from './StatusLine.vue'
import { claudePromptThemeStyle } from './native-ui-paint.ts'
import { bindClaudePromptEditor } from './native-prompt-editor.ts'
import type { Editor } from '@tiptap/core'
import { captureClaudeAgentDraft, restoreClaudeAgentDraft, normalizeClaudeAgentDraftText, type ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'
import { setClaudeCompletionOffer } from '#extensions/tiptap/claude-completions.ts'
import { nativePromptEditors } from '#extensions/tiptap/native-prompt-scope.ts'
import type { ClaudePromptHostRequest, ClaudePromptHostResponse, ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRequest, ClaudePromptCompletionReply, ClaudePromptCompletionRow, ClaudeUiFieldEvent, ClaudeUiMountState, ClaudeUiFocusReply, ClaudeUiFocusEvent, ClaudeUiScrollEvent } from '#generated/types.ts'
const props = defineProps<{ draft: string; draftSnapshot?: ClaudeAgentDraftSnapshot; disabled: boolean; mountId?: string; attachmentId?: string; promptRevision?: number; prompt?: ClaudePromptReply; hostRequest?: ClaudePromptHostRequest; completions?: ClaudePromptCompletionReply; completionRevision?: number; ui?: ClaudeUiMountState; focus?: ClaudeUiFocusReply; statusText?: string; send(text: string): Promise<ClaudeNativeAgentInputReview | { commandPending: true } | void> }>()
const emit = defineEmits<{ leave: []; draft: [text: string]; 'draft-snapshot': [snapshot: ClaudeAgentDraftSnapshot]; pending: [value: boolean]; edit: [value: ClaudePromptEdit]; complete: [value: ClaudePromptCompletionRequest]; host: [value: ClaudePromptHostResponse]; press: [id: string, href?: string]; field: [value: ClaudeUiFieldEvent]; scroll: [value: ClaudeUiScrollEvent]; 'focus-report': [value: ClaudeUiFocusEvent] }>()
const editorRef = ref<InstanceType<typeof TiptapEditor>>(), problem = ref<string>(), nativeProblem = ref<string>(), submitting = ref(false)
const offers = ref<(ClaudePromptCompletionRow & { offerId: string })[]>([])
const promptThemeStyle = computed(() => claudePromptThemeStyle(props.ui?.promptPalette))
let bridge: ReturnType<typeof bindClaudePromptEditor> | undefined, alive = true, adoptedEditor: Editor | undefined
watch([() => editorRef.value?.editor, () => props.mountId, () => props.attachmentId], ([editor, mountId], _old, cleanup) => {
  bridge?.dispose(); bridge = undefined; offers.value = []
  if (!editor) return
  nativePromptEditors.add(editor); cleanup(() => nativePromptEditors.delete(editor))
  if (adoptedEditor !== editor) {
    const saved = props.draftSnapshot
    const adopt = () => { adoptedEditor = editor; if (saved) restoreClaudeAgentDraft(editor, saved, props.draft) }
    if (editor.isInitialized) adopt()
    else { editor.on('create', adopt); cleanup(() => editor.off('create', adopt)) }
  }

  if (!mountId) return
  bridge = bindClaudePromptEditor(editor, value => emit('edit', value), value => { nativeProblem.value = value }, props.promptRevision, {
    initialRevision: props.completionRevision, request: value => emit('complete', value), update: (rows, id) => {
      offers.value = id ? rows.map(row => ({ ...row, offerId: id })) : []
      const owner = bridge
      setClaudeCompletionOffer(editor, id && rows.length ? { id, rows: rows.map((row, index) => ({ ...row, select: () => owner?.selectCompletion(index, id) ?? false })), dismiss: () => owner?.dismissCompletions() } : undefined)
    },
  }, { canSuggest: () => !props.disabled && !submitting.value && document.hasFocus() })
}, { flush: 'post' })
watch(() => props.prompt, value => { if (value) bridge?.receive(value) })
watch(() => props.completions, value => { if (value) bridge?.receiveCompletions(value) })
watch(() => props.hostRequest, request => {
  if (!request) return
  const available = !props.disabled && !submitting.value && Date.now() < request.expiresAt && document.hasFocus() && !!bridge
  if (request.kind === 'read') { const box = available ? bridge?.readDraft() : undefined; emit('host', { requestId: request.requestId, kind: 'read', ...(box ? { box } : {}) }) }
  else if (request.kind === 'fill') emit('host', { requestId: request.requestId, kind: 'fill', filled: available && (bridge?.fillDraft(request.input, request.revision) ?? false) })
  else emit('host', { requestId: request.requestId, kind: 'suggest', shown: available && (bridge?.showSuggestion(request.text, request.revision) ?? false) })
})
function updateDraft(text: string) {
  const editor = editorRef.value?.editor
  emit('draft', editor ? normalizeClaudeAgentDraftText(editor.state.doc, text) : text)
}
function leaveEditor(event: KeyboardEvent) {
  const editor = editorRef.value?.editor
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || editor?.view.composing || !editor?.view.dom.contains(event.target as Node)) return
  event.preventDefault(); event.stopPropagation()
  if (offers.value.length) bridge?.dismissCompletions()
  else if (!submitting.value) emit('leave')
}
async function submit() {
  if (props.disabled || submitting.value || !bridge) return
  const editor = editorRef.value?.editor, active = bridge
  if (!editor) return
  submitting.value = true; emit('pending', true); problem.value = undefined
  try {
    if (!await active.settle() || bridge !== active || props.disabled || !alive) throw Error('Agent input changed. Send again.')
    const text = active.readDraft()?.text ?? ''
    if (!text.trim()) return
    const doc = editor.state.doc
    const review = await props.send(text)
    if (review && 'commandPending' in review) return
    if (review) {
      const applied = alive && !editor.isDestroyed && editor.state.doc === doc && bridge === active && active.fillDraft({ mode: 'replace', text: review.text }, active.revision)
      if (alive) problem.value = applied ? `Removed ${review.removed} invisible character${review.removed === 1 ? '' : 's'}. Review the message before sending.` : 'The earlier message contained invisible characters. Your newer draft was kept; review it before sending.'
      return
    }
    if (alive && !editor.isDestroyed && editor.state.doc === doc) { editor.chain().setMeta('claude-prompt-by', 'app').clearContent(true).run(); emit('draft', '') }
  } catch (error) { if (alive) problem.value = error instanceof Error ? error.message : 'Agent message could not be sent' }
  finally { submitting.value = false; emit('pending', false) }
}
defineExpose({ focus: () => editorRef.value?.editor?.commands.focus() })
onBeforeUnmount(() => {
  const editor = editorRef.value?.editor
  if (editor && adoptedEditor === editor) { const snapshot = captureClaudeAgentDraft(editor); if (snapshot) emit('draft-snapshot', snapshot) }
  alive = false; bridge?.dispose()
})
</script>

<style scoped>
@media (max-height: 700px) {
  .native-agent-composer { margin-bottom: .75rem; }
  .native-agent-composer :deep(.native-agent-editor) { min-height: 4rem; max-height: 6rem; padding-block: .5rem; }
}
</style>
