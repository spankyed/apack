<template>
  <div v-for="shown in [frame]" :key="JSON.stringify([shown?.messageId, shown?.id, shown?.revision, shown?.draftActionId])" class="question-drawing" tabindex="-1" @keydown="key" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave">
    <NativeUiNode v-if="shown?.body.status === 'live' && shown.shownInput && shown.token" :node="shown.body.tree" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><NativeQuestionPanel :key="JSON.stringify([shown.messageId, shown.id, shown.revision, shown.draftActionId])" :card="shown.shownInput" :presentation="shown.presentation" :render-token="shown.token" :cancel-label="cancelLabel" :can-reject="canReject" @reject="reject(shown)" :disabled="disabled || !!shown.pending" :pending="!!shown.pending" :error="error ?? shown.problem" @started="token => started(shown, token)" @respond="answer => respond(shown, answer)" @pause="pause(shown)" /></template>
    </NativeUiNode>
    <section v-else role="status" class="p-4 text-xs text-neutral-400">{{ shown?.body.status === 'error' ? shown.body.message : 'Loading native question…' }}</section>
  </div>
</template>
<script setup lang="ts">
import { provide, watch, onBeforeUnmount } from 'vue'
import type { ClaudeUiQuestionFrame, ClaudeUiQuestionAnswerIdentity, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeQuestionAnswer } from '#features/code/common/native-question.ts'
import NativeUiNode from './NativeUiNode.vue'
import NativeQuestionPanel from './NativeQuestionPanel.vue'
import { useClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
const props = defineProps<{ frame?: ClaudeUiQuestionFrame; cancelLabel?: string; canReject?: boolean; disabled: boolean; error?: string }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent]; started: [token: string, identity: ClaudeUiQuestionAnswerIdentity]; respond: [answer: ClaudeQuestionAnswer, identity: ClaudeUiQuestionAnswerIdentity]; reject: [identity: ClaudeUiQuestionAnswerIdentity]; pause: [identity: ClaudeUiQuestionAnswerIdentity] }>()
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
function respond(shown: ClaudeUiQuestionFrame | undefined, answer: ClaudeQuestionAnswer) { const identity = rendered(shown); if (identity) emit('respond', answer, identity) }
function reject(shown?: ClaudeUiQuestionFrame) { const identity=rendered(shown);if(identity)emit('reject',identity) }
function pause(shown?: ClaudeUiQuestionFrame) { const identity = rendered(shown); if (identity) emit('pause', identity) }
const hover = useClaudeHoverSurface(); provide(claudeHoverSurface, hover)
watch(() => props.frame?.body, () => hover.invalidate(), { flush: 'post' })
function key(event: KeyboardEvent) { if (!event.isComposing && event.currentTarget instanceof HTMLElement) pressClaudeUiHotkey(event, event.currentTarget) }
onBeforeUnmount(() => hover.dispose())
</script>
<style scoped>
.question-drawing { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; outline:none; }
.question-drawing > :deep(.native-box) { display:flex; flex-direction:column; height:100%; min-height:0; }
</style>
