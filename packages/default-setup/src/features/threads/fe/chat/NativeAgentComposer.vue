<template>
  <form :style="promptThemeStyle" :class="{ 'native-agent-composer--tools': toolsExpanded }" class="native-agent-composer mx-4 mb-4 flex min-h-28 min-w-0 shrink flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#202022]" aria-label="Agent message" @submit.prevent="submit" @keydown.capture="leaveEditor">
    <div class="native-agent-body flex min-h-0 flex-1 flex-col overflow-clip" :class="{ 'native-agent-body--tools': toolsExpanded }">
    <StatusLine class="shrink-0" @tools-expanded="toolsExpanded = $event" :native-status="statusText" :native-ui="ui" :native-focus="focus" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)" @scroll="emit('scroll', $event)" @focus-report="emit('focus-report', $event)" @return-focus="editorRef?.editor?.commands.focus()" />
    <div class="native-agent-draft-scroll min-h-10 flex-1 overflow-y-auto overscroll-contain" data-native-agent-draft-viewport>
    <TiptapEditor class="shrink-0" ref="editorRef" mode="input" variant="chat" :disable-images="true" :model-value="draft" :disabled="disabled" placeholder="Message this Agent" editor-class="native-agent-editor min-h-20 px-4 py-3 text-sm leading-6 outline-none" @update:model-value="updateDraft" @submit="submit" />
    <p v-if="problem || nativeProblem" role="alert" class="px-4 pb-2 text-xs text-red-300">{{ problem || nativeProblem }}</p>
    </div>
    <NativePromptCompletions :editor="editorRef?.editor" :rows="offers" :disabled="disabled || submitting" @select="(index, id) => bridge?.selectCompletion(index, id)" @dismiss="bridge?.dismissCompletions()" />
    </div>
    <div class="native-agent-actions flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-2">
      <div class="flex min-w-0 items-center gap-2">
        <button v-if="openSettings" type="button" aria-label="Claude settings" title="Claude settings" :disabled="disabled || submitting" class="shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-white/5 hover:text-neutral-200 disabled:opacity-40" @click="openNativeSettings"><Settings2 :size="16" /></button>
        <span class="truncate text-[11px] text-neutral-500">{{ disabled ? 'Agent input unavailable' : 'Enter to send · Shift+Enter for a new line' }}</span>
      </div>
      <button type="submit" class="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40" :disabled="disabled || submitting || !draft.trim()">{{ submitting ? 'Sending…' : 'Send to Agent' }}</button>
    </div>
  </form>
</template>
<script setup lang="ts">
import type { ClaudeNativeAgentInputReview } from '#features/code/common/native-terminal.ts'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { Settings2 } from 'lucide-vue-next'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import StatusLine from './StatusLine.vue'
import NativePromptCompletions from './NativePromptCompletions.vue'
import { claudePromptThemeStyle } from './native-ui-paint.ts'
import { useClaudeUiSelection, replyClaudeUiSelection } from './native-ui-selection.ts'
import { copyClaudeUiText } from './native-ui-clipboard.ts'
import { bindClaudePromptEditor } from './native-prompt-editor.ts'
import type { Editor } from '@tiptap/core'
import { captureClaudeAgentDraft, restoreClaudeAgentDraft, normalizeClaudeAgentDraftText, type ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'
import { setEditorCompletionOffer } from '@apackdev/sdk/fe'
import { holdEditorCommandSuggestions } from '@apackdev/sdk/fe'
import { nativePromptEditors } from '#extensions/tiptap/native-prompt-scope.ts'
import type { ClaudePromptHostRequest, ClaudePromptHostResponse, ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRequest, ClaudePromptCompletionReply, ClaudePromptCompletionRow, ClaudeUiFieldEvent, ClaudeUiMountState, ClaudeUiFocusReply, ClaudeUiFocusEvent, ClaudeUiScrollEvent } from '#generated/types.ts'
const props = defineProps<{ draft: string; draftSnapshot?: ClaudeAgentDraftSnapshot; disabled: boolean; mountId?: string; attachmentId?: string; promptRevision?: number; prompt?: ClaudePromptReply; hostRequest?: ClaudePromptHostRequest; completions?: ClaudePromptCompletionReply; completionRevision?: number; ui?: ClaudeUiMountState; focus?: ClaudeUiFocusReply; statusText?: string; send(text: string): Promise<ClaudeNativeAgentInputReview | { commandPending: true } | void>; openSettings?: () => Promise<void> }>()
const emit = defineEmits<{ leave: []; draft: [text: string]; 'draft-snapshot': [snapshot: ClaudeAgentDraftSnapshot]; pending: [value: boolean]; edit: [value: ClaudePromptEdit]; complete: [value: ClaudePromptCompletionRequest]; host: [value: ClaudePromptHostResponse]; press: [id: string, href?: string]; field: [value: ClaudeUiFieldEvent]; scroll: [value: ClaudeUiScrollEvent]; 'focus-report': [value: ClaudeUiFocusEvent] }>()
const toolsExpanded = ref(false)
const editorRef = ref<InstanceType<typeof TiptapEditor>>(), problem = ref<string>(), nativeProblem = ref<string>(), submitting = ref(false)
const offers = ref<(ClaudePromptCompletionRow & { offerId: string })[]>([])
const promptThemeStyle = computed(() => claudePromptThemeStyle(props.ui?.promptPalette))
let bridge: ReturnType<typeof bindClaudePromptEditor> | undefined, alive = true, adoptedEditor: Editor | undefined
let committedState: Editor['state'] | undefined
watch([() => editorRef.value?.editor, () => props.mountId, () => props.attachmentId], ([editor, mountId], _old, cleanup) => {
  bridge?.dispose(); bridge = undefined; offers.value = []
  if (!editor) return
  nativePromptEditors.add(editor)
  const releaseCommands = holdEditorCommandSuggestions(editor)
  cleanup(() => { nativePromptEditors.delete(editor); releaseCommands() })
  if (adoptedEditor !== editor) {
    const saved = props.draftSnapshot, initialDocument = editor.state.doc
    const adopt = () => { adoptedEditor = editor; if (saved) restoreClaudeAgentDraft(editor, saved, props.draft, initialDocument); committedState = editor.state }
    if (editor.isInitialized) adopt()
    else { editor.on('create', adopt); cleanup(() => editor.off('create', adopt)) }
  }

  const remember = () => { if (adoptedEditor === editor && !editor.view.composing) committedState = editor.state }
  const composed = () => queueMicrotask(() => {
    if (!alive || editor.isDestroyed || adoptedEditor !== editor || editorRef.value?.editor !== editor) return
    const snapshot = captureClaudeAgentDraft(editor)
    if (snapshot) { committedState = editor.state; emit('draft', snapshot.text) }
  })
  const compositionDom = editor.view.dom
  let pointerFocus = false, focusActive = true
  const pointer = () => { pointerFocus = compositionDom.ownerDocument.activeElement !== compositionDom }
  const blur = () => { pointerFocus = false }
  const focus = () => {
    const fromPointer = pointerFocus; pointerFocus = false
    if (fromPointer || adoptedEditor !== editor || editor.isDestroyed || editor.view.composing) return
    const retained = editor.state
    // Browser focus may install a default DOM caret after its focus event. Align it before the next input task.
    queueMicrotask(() => {
      if (!focusActive || !alive || editor.isDestroyed || editorRef.value?.editor !== editor || editor.view.composing
        || compositionDom.ownerDocument.activeElement !== compositionDom || editor.state.doc !== retained.doc) return
      if (!editor.state.selection.eq(retained.selection) || editor.state.storedMarks !== retained.storedMarks) {
        editor.view.dispatch(editor.state.tr.setSelection(retained.selection).setStoredMarks(retained.storedMarks)
          .setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false))
      }
      editor.view.focus()
    })
  }
  editor.on('transaction', remember)
  compositionDom.addEventListener('compositionend', composed)
  compositionDom.addEventListener('pointerdown', pointer, true)
  compositionDom.addEventListener('pointercancel', blur)
  compositionDom.addEventListener('blur', blur)
  compositionDom.addEventListener('focus', focus, true)
  cleanup(() => {
    focusActive = false
    editor.off('transaction', remember)
    compositionDom.removeEventListener('compositionend', composed)
    compositionDom.removeEventListener('pointerdown', pointer, true)
    compositionDom.removeEventListener('pointercancel', blur)
    compositionDom.removeEventListener('blur', blur)
    compositionDom.removeEventListener('focus', focus, true)
  })

  if (!mountId) return
  bridge = bindClaudePromptEditor(editor, value => emit('edit', value), value => { nativeProblem.value = value }, props.promptRevision, {
    initialRevision: props.completionRevision, request: value => emit('complete', value), update: (rows, id) => {
      offers.value = id ? rows.map(row => ({ ...row, offerId: id })) : []
      const owner = bridge
      setEditorCompletionOffer(editor, id && rows.length ? { id, rows: rows.map((row, index) => ({ ...row, select: () => owner?.selectCompletion(index, id) ?? false })), dismiss: () => owner?.dismissCompletions() } : undefined)
    },
  }, { canSuggest: () => !props.disabled && !submitting.value && document.hasFocus() })
}, { flush: 'post' })
watch(() => props.prompt, value => { if (value) bridge?.receive(value) })
watch(() => props.completions, value => { if (value) bridge?.receiveCompletions(value) })
const pageSelection = useClaudeUiSelection()
watch(() => props.hostRequest, request => {
  if (!request) return
  if (request.kind === 'selection') {
    const owner = bridge, attachment = props.attachmentId
    void replyClaudeUiSelection(request.replyUrl, pageSelection, request.expiresAt, () => alive && !!owner && bridge === owner && props.attachmentId === attachment && props.hostRequest === request)
      .then(submitted => emit('host', { requestId: request.requestId, kind: 'selection', submitted }))
    return
  }
  if (request.kind === 'copy') {
    const owner = bridge, attachment = props.attachmentId
    void copyClaudeUiText(request.text, request.expiresAt, () => alive && !!owner && bridge === owner && props.attachmentId === attachment && props.hostRequest === request)
      .then(copied => emit('host', { requestId: request.requestId, kind: 'copy', copied }))
    return
  }
  const available = !props.disabled && !submitting.value && Date.now() < request.expiresAt && document.hasFocus() && !!bridge
  if (request.kind === 'read') { const box = available ? bridge?.readDraft() : undefined; emit('host', { requestId: request.requestId, kind: 'read', ...(box ? { box } : {}) }) }
  else if (request.kind === 'fill') emit('host', { requestId: request.requestId, kind: 'fill', filled: available && (bridge?.fillDraft(request.input, request.revision) ?? false) })
  else emit('host', { requestId: request.requestId, kind: 'suggest', shown: available && (bridge?.showSuggestion(request.text, request.revision) ?? false) })
})
function updateDraft(text: string) {
  const editor = editorRef.value?.editor
  if (editor?.view.composing) return
  emit('draft', editor ? normalizeClaudeAgentDraftText(editor.state.doc, text) : text)
}
function leaveEditor(event: KeyboardEvent) {
  const editor = editorRef.value?.editor
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || editor?.view.composing || !editor?.view.dom.contains(event.target as Node)) return
  event.preventDefault(); event.stopPropagation()
  if (offers.value.length) bridge?.dismissCompletions()
  else if (!submitting.value) emit('leave')
}
async function openNativeSettings() {
  const active = bridge, open = props.openSettings
  if (props.disabled || submitting.value || !active || !open) return
  const revision = active.revision
  submitting.value = true; emit('pending', true); problem.value = undefined
  try {
    if (!await active.settle() || active.revision !== revision || bridge !== active || props.disabled || !alive) throw Error('Agent input changed. Open settings again.')
    await open()
  } catch (error) { if (alive && bridge === active) problem.value = error instanceof Error ? error.message : 'Claude settings could not be opened' }
  finally { submitting.value = false; emit('pending', false) }
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
  if (editor && adoptedEditor === editor) { const snapshot = captureClaudeAgentDraft(editor, editor.view.composing ? committedState : undefined); if (snapshot) { if (snapshot.text !== props.draft) emit('draft', snapshot.text); emit('draft-snapshot', snapshot) } }
  alive = false; bridge?.dispose()
})
</script>

<style scoped>
.native-agent-composer { max-height: max(7rem, calc(var(--agent-available-height, 32rem) - 10rem)); }
.native-agent-composer--tools { max-height: max(7rem, calc(var(--agent-available-height, 32rem) - 11rem)); }
.native-agent-composer :deep([data-testid="composer-session-strip"]) { padding: .5rem 1rem; }
.native-agent-body--tools { display: block; overflow-y: auto; overscroll-behavior: contain; }
.native-agent-body--tools .native-agent-draft-scroll { overflow: visible; }
/* The draft viewport owns scrolling; inherited input-theme overflow must not add another. */
.native-agent-composer :deep(.native-agent-editor .ProseMirror) { min-height: 24px; max-height: none; overflow: visible; padding: 0; }
.native-agent-composer :deep(.native-strip--open) { min-height: 0; }
@media (max-height: 700px) {
  .native-agent-composer { margin-bottom: .75rem; }
  /* Rich drafts need reading space without hiding native status or the transcript. */
  .native-agent-composer:has(.native-agent-editor :is(h1, h2, h3, pre, ul, ol, blockquote)):not(.native-agent-composer--tools) {
    max-height: max(7rem, calc(var(--agent-available-height, 32rem) - 8.5rem));
    margin-bottom: 0;
  }
  .native-agent-composer:has(.native-agent-editor :is(h1, h2, h3, pre, ul, ol, blockquote)):not(.native-agent-composer--tools) :deep([data-testid="composer-session-strip"]) { padding-block: .25rem; }
  .native-agent-composer:has(.native-agent-editor :is(h1, h2, h3, pre, ul, ol, blockquote)):not(.native-agent-composer--tools) .native-agent-actions { padding-block: .25rem; }
  .native-agent-composer :deep(.native-agent-editor) { min-height: 2.5rem; padding-block: .5rem; }
}
</style>
