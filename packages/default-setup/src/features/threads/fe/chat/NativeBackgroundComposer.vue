<template>
  <div ref="root" class="background-native-composer" @keydown.capture="event => actionKey(event, root ?? null)" @focusout="event => actionKey.leave(event, root ?? null)">
    <NativeAgentComposer audience="background" :draft="draft" :draft-snapshot="draftSnapshot" :disabled="disabled || !attachment?.attachmentId || !['live', 'rendering'].includes(state?.status ?? '')"
      :mount-id="mountId" :attachment-id="attachment?.attachmentId" :prompt-revision="attachment?.promptRevision" :prompt="attachment?.prompt"
      :host-request="attachment?.promptHostRequest" :completions="attachment?.completions" :completion-revision="attachment?.completionRevision" :focus="attachment?.focus" :ui="state" :send="send"
      @leave="emit('leave')" @draft="emit('draft', $event)" @draft-snapshot="emit('draft-snapshot', $event)" @edit="edit" @complete="complete" @host="host" @press="press" @field="field" @scroll="scroll" @focus-report="focus" />
    <p v-if="state?.status === 'error'" role="alert" class="text-xs text-red-300">{{ state.message }}</p>
  </div>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, provide, ref, watch} from 'vue'
import {useSelector} from '@xstate/vue'
import {useSurface} from '@apackdev/sdk/fe'
import NativeAgentComposer from './NativeAgentComposer.vue'
import {provideClaudeUiSelection} from './native-ui-selection.ts'
import {provideClaudeHoverGroups} from './native-ui-hover.ts'
import {claudeTranscriptLayout} from './native-transcript-layout.ts'
import {queueClaudeUiRetirement} from './native-ui-retirement.ts'
import {createClaudeActionKeyHandler} from './native-action-keys.ts'
import type {ClaudeAgentDraftSnapshot} from './native-agent-draft.ts'
import type {ClaudeBackgroundUiTarget} from '#features/code/common/native-background.ts'
import type {ClaudePromptEdit, ClaudePromptCompletionRequest, ClaudePromptHostResponse, ClaudeUiFieldEvent, ClaudeUiScrollEvent, ClaudeUiFocusEvent} from '#generated/types.ts'
import type {ThreadsState} from '../state.ts'
const props = defineProps<{threadId: string; target: ClaudeBackgroundUiTarget; draft: string; draftSnapshot?: ClaudeAgentDraftSnapshot; disabled: boolean; send(text: string): Promise<void>}>()
const emit = defineEmits<{leave: []; draft: [text: string]; 'draft-snapshot': [snapshot: ClaudeAgentDraftSnapshot]}>()
const actor: ThreadsState = useSurface(), root = ref<HTMLElement>(), mountId = ref<string>()
const context = useSelector(actor, value => value.context)
const attachment = computed(() => mountId.value ? context.value.nativeUiViews[mountId.value] : undefined)
const state = computed(() => attachment.value?.state)
const selection = provideClaudeUiSelection(() => root.value ?? null)
watch(() => attachment.value?.attachmentId, selection.clear)
provideClaudeHoverGroups(() => mountId.value && attachment.value?.attachmentId && ['live', 'rendering'].includes(state.value?.status ?? '')
  ? JSON.stringify([props.threadId, mountId.value, attachment.value.attachmentId, props.target.ownerId]) : undefined)
const identity = () => ({threadId: props.threadId, mountId: mountId.value!})
let heartbeat: ReturnType<typeof setInterval> | undefined
function renew() { if (mountId.value) actor.send({type: 'CLAUDE_UI_MOUNT', ...identity(), promptFocused: document.hasFocus(), backgroundView: {...props.target}}) }
function detach() {
  if (heartbeat) clearInterval(heartbeat); heartbeat = undefined
  if (mountId.value) {
    const snapshot = actor.getSnapshot(), resumeKey = snapshot.context.nativeUiViews[mountId.value]?.resumeKey
    if (resumeKey) queueClaudeUiRetirement({...identity(), resumeKey})
    if (snapshot.status !== 'stopped') actor.send({type: 'CLAUDE_UI_UNMOUNT', ...identity()})
  }
  mountId.value = undefined
}
watch(() => JSON.stringify([props.threadId, props.target]), () => {
  detach(); mountId.value = crypto.randomUUID(); renew(); heartbeat = setInterval(renew, 10000)
}, {immediate: true})
const actionKey = createClaudeActionKeyHandler(() => ({
  scope: !props.disabled && attachment.value?.attachmentId ? `${mountId.value}:${attachment.value.attachmentId}` : undefined,
  keys: state.value?.actionKeys, result: attachment.value?.actionKeyResult,
}), request => { if (mountId.value) actor.send({type: 'CLAUDE_UI_KEY', ...identity(), ...request}) })
function press(actionId: string, href?: string) { if (mountId.value) actor.send({type: 'CLAUDE_UI_PRESS', ...identity(), actionId, ...(href ? {href} : {})}) }
function field(value: ClaudeUiFieldEvent) { if (mountId.value) actor.send({type: 'CLAUDE_UI_FIELD', ...identity(), ...value}) }
function scroll(value: ClaudeUiScrollEvent) { if (mountId.value) actor.send({type: 'CLAUDE_UI_SCROLL', ...identity(), ...value}) }
function focus(value: ClaudeUiFocusEvent) { if (mountId.value) actor.send({type: 'CLAUDE_UI_FOCUS', ...identity(), ...value}) }
function edit(value: ClaudePromptEdit) { if (mountId.value) actor.send({type: 'CLAUDE_PROMPT_EDIT', ...identity(), ...value}) }
function complete(value: ClaudePromptCompletionRequest) { if (mountId.value) actor.send({type: 'CLAUDE_PROMPT_AUTOCOMPLETE', ...identity(), ...value}) }
function host(value: ClaudePromptHostResponse) { if (mountId.value) actor.send({type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...identity(), ...value}) }
provide(claudeTranscriptLayout, event => { if (mountId.value) actor.send({type: 'CLAUDE_UI_TRANSCRIPT_LAYOUT', ...identity(), ...event}) })
onMounted(() => { window.addEventListener('focus', renew); window.addEventListener('blur', renew) })
onBeforeUnmount(() => { window.removeEventListener('focus', renew); window.removeEventListener('blur', renew); detach() })
</script>
<style scoped>
.background-native-composer {display:flex;flex:1;min-height:0;min-width:0;--agent-available-height:100%;--agent-composer-history-reserve:0px}
.background-native-composer :deep(.native-agent-composer) {flex:1;min-height:7rem;margin:0;max-height:min(24rem,100%)}
</style>
