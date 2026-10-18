<template>
  <section v-show="active" aria-label="Focused Agent conversation" class="flex min-h-0 min-w-0 flex-1 flex-col" @keydown.esc="escape">
    <header class="mx-4 mb-2 flex shrink-0 items-start justify-between gap-3 border-b border-white/10 pb-3 pt-2">
      <div class="min-w-0"><p class="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">Agent conversation</p><h2 class="truncate text-sm font-medium text-neutral-200">{{ name }}</h2><p class="mt-1 text-[11px] text-neutral-500">{{ state?.agent?.status ?? 'Connecting' }}<template v-if="state?.agent?.metadata?.model"> · {{ state.agent.metadata.model }}</template></p></div>
      <button type="button" class="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40" :disabled="pending || returning || !terminal?.state" @click="returnToParent">{{ returning ? 'Returning…' : 'Back to conversation' }}</button>
    </header>
    <p v-if="problem || state?.agentProblem || state?.status === 'error'" role="alert" class="mx-4 mb-2 text-xs text-red-300">{{ problem || state?.agentProblem || (state?.status === 'error' ? state.message : '') }}</p>
    <div class="relative min-h-0 flex-1">
    <div ref="transcriptViewport" style="overflow-anchor: none" class="h-full overflow-y-auto overscroll-contain px-4 py-3" role="region" tabindex="0" aria-label="Agent transcript">
      <div ref="transcriptContent">
      <p v-if="!state?.agent && state?.status !== 'error'" class="text-sm text-neutral-500">Loading Agent conversation…</p>
      <article v-for="message in state?.agent?.messages ?? []" :key="message.uuid" :data-native-agent-message="message.uuid" class="mb-5 min-w-0 last:mb-0">
        <p class="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">{{ message.role === 'user' ? 'You' : name }}</p>
        <NativeTranscriptMessage v-if="frames.get(message.uuid)" :frame="frames.get(message.uuid)!" @press="press" @field="field" />
        <TiptapEditor v-else mode="viewer" variant="chat" :model-value="message.text" />
      </article>
      <p v-if="state?.agent?.truncated" class="text-xs text-neutral-500">Conversation preview shortened.</p>
      </div>
    </div>
    <ScrollToBottomFob :visible="!transcriptScroll.following.value" aria-label="Jump to latest Agent message" @click="transcriptScroll.latest()" />
    </div>
    <NativeAgentComposer :draft="draft" :disabled="!active || returning || !state?.agent?.canInput || state.status === 'disconnected' || state.status === 'connecting'" :mount-id="uiMount" :prompt-revision="snapshot?.promptRevision" :prompt="snapshot?.prompt" :host-request="snapshot?.promptHostRequest" :completion-revision="snapshot?.completionRevision" :completions="snapshot?.completions" :ui="state" :focus="snapshot?.focus" :status-text="statusText" :send="send"
      @leave="returnToParent" @draft="emit('draft', target, $event)" @pending="setPending" @edit="edit" @complete="complete" @host="host" @press="press" @field="field" @scroll="scroll" @focus-report="focus" />
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { usePlugin } from '@apackdev/sdk/fe'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import ScrollToBottomFob from '@apackdev/ui/design/ScrollToBottomFob'
import { useClaudeAgentScroll, type ClaudeAgentScrollPosition } from './native-agent-scroll.ts'
import NativeAgentComposer from './NativeAgentComposer.vue'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import type { ThreadsState } from '../state.ts'
import type { ClaudeNativeAgentInputReview, ClaudeNativeAgentUiTarget } from '#features/code/common/native-terminal.ts'
import type { ClaudePromptEdit, ClaudePromptCompletionRequest, ClaudePromptHostResponse, ClaudeUiFieldEvent, ClaudeUiScrollEvent, ClaudeUiFocusEvent } from '#generated/types.ts'
const props = defineProps<{ threadId: string; target: ClaudeNativeAgentUiTarget; name: string; statusText?: string; draft: string; active: boolean; scrollPosition?: ClaudeAgentScrollPosition }>()
const emit = defineEmits<{ draft: [target: ClaudeNativeAgentUiTarget, text: string]; pending: [value: boolean]; returning: [value: boolean]; returned: []; scrollPosition: [target: ClaudeNativeAgentUiTarget, position: ClaudeAgentScrollPosition] }>()
const transcriptViewport = ref<HTMLElement>(), transcriptContent = ref<HTMLElement>()
const scrollTarget = props.target
const transcriptScroll = useClaudeAgentScroll({ viewport: transcriptViewport, content: transcriptContent, active: () => props.active, initial: props.scrollPosition, save: position => emit('scrollPosition', scrollTarget, position) })
const actor: ThreadsState = usePlugin(), uiMount = ref<string>(), terminalMount = crypto.randomUUID()
const context = useSelector(actor, state => state.context)
const snapshot = computed(() => uiMount.value ? context.value.nativeUiViews[uiMount.value] : undefined)
const state = computed(() => snapshot.value?.state)
const frames = computed(() => new Map(state.value?.transcriptMessages?.map(frame => [frame.uuid, frame])))
const terminal = computed(() => context.value.nativeTerminalViews[terminalMount])
const pending = ref(false), returning = ref(false), problem = ref<string>()
let heartbeat: ReturnType<typeof setInterval> | undefined, revision = 0, returnRevision = 0
let submission: { revision: number; text: string; scrollIntent: number; resolve(review?: ClaudeNativeAgentInputReview): void; reject(error: Error): void } | undefined
const identity = () => ({ threadId: props.threadId, mountId: uiMount.value! })
const terminalIdentity = () => ({ threadId: props.threadId, mountId: terminalMount })
function renew() { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_MOUNT', ...identity(), nativeView: props.target }); actor.send({ type: 'CLAUDE_TERMINAL_MOUNT', ...terminalIdentity() }) }
function detach() {
  if (heartbeat) clearInterval(heartbeat); heartbeat = undefined
  if (uiMount.value) actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity() })
  uiMount.value = undefined
  submission?.reject(Error('Agent view changed before acknowledgment')); submission = undefined
}
watch(() => props.active, active => { detach(); if (active) { uiMount.value = crypto.randomUUID(); renew(); heartbeat = setInterval(renew, 10000) } }, { immediate: true })
function setPending(value: boolean) { pending.value = value; emit('pending', value || returning.value) }
function send(text: string): Promise<ClaudeNativeAgentInputReview | void> {
  if (!uiMount.value || submission || !text.trim() || text.length > 16384) return Promise.reject(Error('Agent input must contain 1 to 16384 characters'))
  const request = ++revision
  return new Promise((resolve, reject) => { submission = { revision: request, text, scrollIntent: transcriptScroll.intentRevision(), resolve, reject }; actor.send({ type: 'CLAUDE_UI_AGENT_INPUT', ...identity(), revision: request, text }) })
}
watch(() => state.value?.agentInput, value => {
  if (!submission || value?.revision !== submission.revision || value.status === 'pending') return
  const request = submission; submission = undefined
  if (value.status === 'done' && value.receipt) { if (props.draft === request.text) emit('draft', props.target, ''); transcriptScroll.latest(request.scrollIntent); request.resolve() }
  else if (value.status === 'review' && value.review) request.resolve(value.review)
  else request.reject(Error(value.problem ?? 'Agent input was refused'))
})
function returnToParent() {
  const owner = terminal.value?.state
  if (!owner || owner.ownerId !== props.target.ownerId || pending.value || returning.value) return
  returning.value = true; emit('returning', true); emit('pending', true); problem.value = undefined
  returnRevision = Math.max(returnRevision, terminal.value?.task?.revision ?? 0) + 1
  actor.send({ type: 'CLAUDE_TERMINAL_TASK', ...terminalIdentity(), ownerId: owner.ownerId, taskId: props.target.taskId, revision: returnRevision, operation: 'background' })
}
watch(terminal, view => {
  const result = view?.task
  if (!returning.value || result?.revision !== returnRevision || result.ownerId !== props.target.ownerId || result.operation !== 'background' || result.status === 'pending') return
  if (result.status === 'done' && result.view?.taskId === null && view?.state?.view?.kind === 'main') { returning.value = false; emit('returning', false); emit('pending', false); emit('returned') }
  else if (result.status === 'error') { returning.value = false; problem.value = result.problem; emit('returning', false); emit('pending', false) }
})
function escape(event: KeyboardEvent) { if (!event.isComposing && !event.defaultPrevented && !pending.value) { event.preventDefault(); event.stopPropagation(); returnToParent() } }
function press(actionId: string, href?: string) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_PRESS', ...identity(), actionId, ...(href ? { href } : {}) }) }
function field(value: ClaudeUiFieldEvent) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_FIELD', ...identity(), ...value }) }
function scroll(value: ClaudeUiScrollEvent) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_SCROLL', ...identity(), ...value }) }
function focus(value: ClaudeUiFocusEvent) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_FOCUS', ...identity(), ...value }) }
function edit(value: ClaudePromptEdit) { if (uiMount.value) actor.send({ type: 'CLAUDE_PROMPT_EDIT', ...identity(), ...value }) }
function complete(value: ClaudePromptCompletionRequest) { if (uiMount.value) actor.send({ type: 'CLAUDE_PROMPT_AUTOCOMPLETE', ...identity(), ...value }) }
function host(value: ClaudePromptHostResponse) { if (uiMount.value) actor.send({ type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...identity(), ...value }) }
onBeforeUnmount(() => { detach(); actor.send({ type: 'CLAUDE_TERMINAL_UNMOUNT', ...terminalIdentity() }); emit('pending', false); emit('returning', false) })
</script>
