<template>
  <div v-for="shown in [frame]" ref="drawing" :key="JSON.stringify([shown?.messageId, shown?.id, shown?.revision, shown?.draftActionId])" class="question-drawing" :class="{ 'with-extension': wrapped }" :tabindex="wrapped ? 0 : -1" :role="wrapped ? 'region' : undefined" :aria-label="wrapped ? 'Claude Code question and context' : undefined" @keydown="key" @focusin="revealAnswer" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave">
    <NativeUiNode v-if="shown?.body.status === 'live' && shown.shownInput && shown.token" :node="shown.body.tree" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><NativeQuestionPanel :key="JSON.stringify([shown.messageId, shown.id, shown.revision, shown.draftActionId])" :card="shown.shownInput" :presentation="shown.presentation" :countdown-seconds="shown.countdownSeconds" :render-token="shown.token" :cancel-label="cancelLabel" :can-reject="canReject" :can-clarify="canClarify" @reject="reject(shown)" :disabled="!!disabled || !!shown.pending" :pending="pending || !!shown.pending" :error="error ?? shown.problem" @started="token => started(shown, token)" @respond="(answer, decision, images) => respond(shown, answer, decision, images)" @pause="pause(shown)" /></template>
    </NativeUiNode>
    <section v-else role="status" class="p-4 text-xs text-neutral-400">{{ shown?.body.status === 'error' ? shown.body.message : 'Loading native question…' }}</section>
  </div>
</template>
<script setup lang="ts">
import { computed, provide, ref, watch, onBeforeUnmount } from 'vue'
import type { ClaudeUiQuestionFrame, ClaudeUiQuestionAnswerIdentity, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeQuestionAnswer, ClaudeQuestionImage } from '#features/code/common/native-question.ts'
import NativeUiNode from './NativeUiNode.vue'
import NativeQuestionPanel from './NativeQuestionPanel.vue'
import { useClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
const props = defineProps<{ frame?: ClaudeUiQuestionFrame; cancelLabel?: string; canReject?: boolean; canClarify?: boolean; disabled?: boolean; pending?: boolean; error?: string }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent]; started: [token: string, identity: ClaudeUiQuestionAnswerIdentity]; respond: [answer: ClaudeQuestionAnswer, identity: ClaudeUiQuestionAnswerIdentity, decision?: 'clarify', images?: ClaudeQuestionImage[]]; reject: [identity: ClaudeUiQuestionAnswerIdentity]; pause: [identity: ClaudeUiQuestionAnswerIdentity]; 'return-focus': [] }>()
const drawing = ref<HTMLElement[]>([])
const wrapped = computed(() => props.frame?.body.status === 'live' && props.frame.body.tree.kind === 'box')
let draftFrame: ClaudeUiQuestionAnswerIdentity | undefined
const sameQuestion = (a?: ClaudeUiQuestionFrame, b?: ClaudeUiQuestionFrame) => !!a && !!b && a.messageId === b.messageId && a.id === b.id && a.revision === b.revision && a.draftActionId === b.draftActionId
watch([() => props.frame?.messageId, () => props.frame?.id, () => props.frame?.revision, () => props.frame?.draftActionId], () => { draftFrame = undefined })
function started(shown: ClaudeUiQuestionFrame | undefined, token?: string) {
  if (!shown || !token || !sameQuestion(props.frame, shown)) return
  draftFrame = {messageId: shown.messageId, token}; emit('started', token, draftFrame)
}
function rendered(shown?: ClaudeUiQuestionFrame): ClaudeUiQuestionAnswerIdentity | undefined {
  if (!shown || !sameQuestion(props.frame, shown)) return
  return draftFrame?.messageId === shown.messageId ? draftFrame : shown.token ? {messageId: shown.messageId, token: shown.token} : undefined
}
function respond(shown: ClaudeUiQuestionFrame | undefined, answer: ClaudeQuestionAnswer, decision?: 'clarify', images?: ClaudeQuestionImage[]) { const identity = rendered(shown); if (identity) emit('respond', answer, identity, decision, images) }
function reject(shown?: ClaudeUiQuestionFrame) { const identity=rendered(shown);if(identity)emit('reject',identity) }
function pause(shown?: ClaudeUiQuestionFrame) { const identity = rendered(shown); if (identity) emit('pause', identity) }
const hover = useClaudeHoverSurface(); provide(claudeHoverSurface, hover)
watch(() => props.frame?.body, () => hover.invalidate(), { flush: 'post' })
function key(event: KeyboardEvent) { if (!event.isComposing && event.currentTarget instanceof HTMLElement) pressClaudeUiHotkey(event, event.currentTarget) }
function revealAnswer(event: FocusEvent) {
  if (!wrapped.value || !(event.currentTarget instanceof HTMLElement) || !(event.target instanceof HTMLInputElement)) return
  const option = event.target.closest('.option')
  const panel = option?.closest('.native-question-panel')
  const header = panel?.querySelector(':scope > .question-context')
  const footer = panel?.querySelector(':scope > footer')
  if (!option || !header || !footer) return
  // Browser focus scrolls the small input. Keep its label and description clear of the sticky edges.
  const drawing = event.currentTarget
  const viewport = drawing.getBoundingClientRect(), row = option.getBoundingClientRect()
  const top = Math.max(viewport.top, header.getBoundingClientRect().bottom)
  const bottom = Math.min(viewport.bottom, footer.getBoundingClientRect().top)
  if (bottom <= top) return
  if (row.top < top) drawing.scrollTop -= Math.ceil(top - row.top)
  else if (row.bottom > bottom) drawing.scrollTop += Math.ceil(Math.min(row.bottom - bottom, row.top - top))
}
onBeforeUnmount(() => {
  if (document.hasFocus() && drawing.value.some(element => element.contains(document.activeElement))) emit('return-focus')
  hover.dispose()
})
</script>
<style scoped>
.question-drawing { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; outline:none; }
.question-drawing > :deep(.native-box) { display:flex; flex-direction:column; height:100%; min-height:0; }

/* Keep a single scroll area for the native context and answers, with the
   question and its actions at the edges of the viewport. */
.question-drawing.with-extension { overflow-y:auto; scroll-padding-block:6rem 3.5rem; }
.question-drawing.with-extension:focus-visible { outline:2px solid currentColor; outline-offset:-2px; }
.question-drawing.with-extension > :deep(.native-box) { flex:none; height:auto; min-height:100%; }
.question-drawing.with-extension :deep(.native-question-panel) { flex:1 0 auto; height:auto; overflow:visible; }
.question-drawing.with-extension :deep(.native-question-panel > .body) { overflow:visible; }
.question-drawing.with-extension :deep(.native-question-panel > .question-context) { position:sticky; top:0; z-index:1; }
.question-drawing.with-extension :deep(.native-question-panel > footer) { position:sticky; bottom:0; z-index:1; background:#232323; }
</style>
