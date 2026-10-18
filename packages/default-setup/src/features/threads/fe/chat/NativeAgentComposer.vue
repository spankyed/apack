<template>
  <form class="mx-4 mb-4 min-w-0 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#202022]" aria-label="Agent message" @submit.prevent="submit">
    <StatusLine :native-status="statusText" :native-ui="ui" :native-focus="focus" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)" @scroll="emit('scroll', $event)" @focus-report="emit('focus-report', $event)" @return-focus="editorRef?.editor?.commands.focus()" />
    <TiptapEditor ref="editorRef" mode="input" variant="chat" :disable-images="true" :model-value="draft" :disabled="disabled" placeholder="Message this Agent" editor-class="max-h-40 min-h-20 overflow-y-auto px-4 py-3 text-sm leading-6 outline-none" @update:model-value="emit('draft', $event)" @submit="submit" />
    <div v-if="offers.length" role="group" aria-label="Claude suggestions" class="max-h-32 overflow-y-auto border-t border-white/10">
      <button v-for="(row, index) in offers" :key="index" type="button" class="block w-full px-4 py-2 text-left text-xs text-neutral-300 hover:bg-white/5" @mousedown.prevent @click="bridge?.selectCompletion(index, row.offerId)">{{ row.label ?? row.text }}</button>
    </div>
    <p v-if="problem" role="alert" class="px-4 pb-2 text-xs text-red-300">{{ problem }}</p>
    <div class="flex items-center justify-between gap-3 px-4 pb-3">
      <span class="truncate text-[11px] text-neutral-500">{{ disabled ? 'Connecting to Agent input' : 'Enter to send · Shift+Enter for a new line' }}</span>
      <button type="submit" class="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40" :disabled="disabled || submitting || !draft.trim()">{{ submitting ? 'Sending…' : 'Send to Agent' }}</button>
    </div>
  </form>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import StatusLine from './StatusLine.vue'
import { bindClaudePromptEditor } from './native-prompt-editor.ts'
import { setClaudeCompletionOffer } from '#extensions/tiptap/claude-completions.ts'
import { nativePromptEditors } from '#extensions/tiptap/native-prompt-scope.ts'
import type { ClaudePromptHostRequest, ClaudePromptHostResponse, ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRequest, ClaudePromptCompletionReply, ClaudePromptCompletionRow, ClaudeUiFieldEvent, ClaudeUiMountState, ClaudeUiFocusReply, ClaudeUiFocusEvent, ClaudeUiScrollEvent } from '#generated/types.ts'
const props = defineProps<{ draft: string; disabled: boolean; mountId?: string; promptRevision?: number; prompt?: ClaudePromptReply; hostRequest?: ClaudePromptHostRequest; completions?: ClaudePromptCompletionReply; completionRevision?: number; ui?: ClaudeUiMountState; focus?: ClaudeUiFocusReply; statusText?: string; send(text: string): Promise<void> }>()
const emit = defineEmits<{ draft: [text: string]; pending: [value: boolean]; edit: [value: ClaudePromptEdit]; complete: [value: ClaudePromptCompletionRequest]; host: [value: ClaudePromptHostResponse]; press: [id: string, href?: string]; field: [value: ClaudeUiFieldEvent]; scroll: [value: ClaudeUiScrollEvent]; 'focus-report': [value: ClaudeUiFocusEvent] }>()
const editorRef = ref<InstanceType<typeof TiptapEditor>>(), problem = ref<string>(), submitting = ref(false)
const offers = ref<(ClaudePromptCompletionRow & { offerId: string })[]>([])
let bridge: ReturnType<typeof bindClaudePromptEditor> | undefined, alive = true
watch([() => editorRef.value?.editor, () => props.mountId], ([editor, mountId], _old, cleanup) => {
  bridge?.dispose(); bridge = undefined; offers.value = []
  if (!editor) return
  nativePromptEditors.add(editor); cleanup(() => nativePromptEditors.delete(editor))
  if (!mountId) return
  bridge = bindClaudePromptEditor(editor, value => emit('edit', value), value => { problem.value = value }, props.promptRevision, {
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
    await props.send(text)
    if (alive && !editor.isDestroyed && editor.state.doc === doc) { editor.chain().setMeta('claude-prompt-by', 'app').clearContent(true).run(); emit('draft', '') }
  } catch (error) { if (alive) problem.value = error instanceof Error ? error.message : 'Agent message could not be sent' }
  finally { submitting.value = false; emit('pending', false) }
}
onBeforeUnmount(() => { alive = false; bridge?.dispose() })
</script>
