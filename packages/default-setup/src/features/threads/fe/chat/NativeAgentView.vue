<template>
  <section ref="selectionRoot" v-show="active" aria-label="Focused Agent conversation" class="native-agent-view flex min-h-0 min-w-0 flex-1 flex-col" @keydown.esc="escape">
    <header class="mx-4 mb-2 flex shrink-0 items-start justify-between gap-3 border-b border-white/10 pb-3 pt-2">
      <div class="min-w-0"><p class="native-agent-eyebrow mb-1 text-[10px] uppercase tracking-widest text-neutral-500">Agent conversation</p><h2 class="truncate text-sm font-medium text-neutral-200">{{ name }}</h2><p class="mt-1 text-[11px] text-neutral-500">{{ state?.agent?.status === 'killed' ? 'Stopped' : state?.agent?.status ?? 'Connecting' }}<template v-if="state?.agent?.metadata?.model"> · {{ state.agent.metadata.model }}</template></p></div>
      <div class="flex shrink-0 flex-wrap justify-end gap-2">
      <button type="button" class="rounded-lg px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-40" :disabled="pending || returning || stopping || commandActive || !selectedOwner || selectedTask?.status !== 'running'" @click="stopAgent">{{ stopping ? 'Stopping…' : 'Stop Agent' }}</button>
      <button type="button" class="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40" :disabled="pending || returning || stopping || commandActive || !selectedOwner" @click="returnToParent">{{ returning ? 'Returning…' : 'Back to conversation' }}</button>
      </div>
    </header>
    <details v-if="state?.agent?.metadata" class="mx-4 mb-2 shrink-0 text-xs text-neutral-400"><summary class="cursor-pointer py-1">Agent details</summary><div class="max-h-36 overflow-y-auto overscroll-contain py-2"><NativeAgentDetails :details="state.agent" :show-handback="false" /></div></details>
    <p v-if="problem || state?.agentProblem || state?.status === 'error'" role="alert" class="mx-4 mb-2 text-xs text-red-300">{{ problem || state?.agentProblem || (state?.status === 'error' ? state.message : '') }}</p>
    <NativeCommandPanel v-if="panelActive && state?.agentInput?.panel && selectedOwner" :key="state.agentInput.panel.id" :name="state.agentInput.panel.commandName" :owner-id="selectedOwner.ownerId" :output="terminal?.output ?? []" @input="panelInput" @close="panelInput()" @resize="panelResize" />
    <div v-show="!panelActive && !outputActive" class="relative min-h-0 flex-1">
    <div ref="transcriptViewport" style="overflow-anchor: none" class="h-full overflow-y-auto overscroll-contain px-4 py-3" role="region" tabindex="0" aria-label="Agent transcript">
      <div ref="transcriptContent">
      <p v-if="!state?.agent && state?.status !== 'error'" class="text-sm text-neutral-500">Loading Agent conversation…</p>
      <article v-for="message in state?.agent?.messages ?? []" :key="message.uuid" :data-native-agent-message="message.uuid" class="mb-5 min-w-0 last:mb-0">
        <p class="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">{{ message.role === 'user' ? 'You' : name }}</p>
        <NativeTranscriptMessage v-if="frames.get(message.uuid)" :frame="frames.get(message.uuid)!" @press="press" @field="field" />
        <TiptapEditor v-else mode="viewer" variant="chat" :model-value="message.text" />
      </article>
      <NativeAgentHandback v-if="state?.agent?.handback" :report="state.agent.handback" />
      <p v-if="state?.agent?.truncated" class="text-xs text-neutral-500">Conversation preview shortened.</p>
      </div>
    </div>
    <ScrollToBottomFob :visible="!transcriptScroll.following.value" aria-label="Jump to latest Agent message" @click="transcriptScroll.latest()" />
    </div>
    <section v-if="outputActive && state?.agentInput?.output" aria-label="Native command output" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <span class="text-xs text-neutral-400">/{{ state.agentInput.output.commandName }}</span>
        <button type="button" class="shrink-0 rounded-lg px-2 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-neutral-200" @click="dismissOutput">Back to messages</button>
      </header>
      <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
        <pre :class="state.agentInput.output.text.includes('\n') ? 'whitespace-pre' : 'whitespace-pre-wrap break-words'" class="text-xs leading-relaxed text-neutral-300">{{ state.agentInput.output.text }}</pre>
      </div>
    </section>
    <p v-if="state?.agentInput?.status === 'blocked'" role="status" class="mx-4 mb-2 text-xs text-amber-200">{{ state.agentInput.problem }}</p>
    <section v-if="commandActive && state?.agentInput?.command" ref="commandPanel" aria-label="Native command confirmation" class="mx-4 mb-3 shrink-0 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3">
      <p class="text-sm text-neutral-200 [overflow-wrap:anywhere]">{{ state.agentInput.command.title }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button ref="cancelCommand" type="button" :disabled="commandSending" class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="decideCommand('cancel')">Cancel</button>
        <button type="button" :disabled="commandSending" class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40" @click="decideCommand('confirm')">{{ state.agentInput.command.confirmLabel }}</button>
      </div>
    </section>
    <NativeAgentComposer v-show="!panelActive" ref="agentComposer" :draft="draft" :draft-snapshot="draftSnapshot" :disabled="!active || !selectedOwner || returning || stopping || commandActive || !state?.agent?.canInput || state.status === 'disconnected' || state.status === 'connecting'" :mount-id="uiMount" :attachment-id="snapshot?.attachmentId" :prompt-revision="snapshot?.promptRevision" :prompt="snapshot?.prompt" :host-request="snapshot?.promptHostRequest" :completion-revision="snapshot?.completionRevision" :completions="snapshot?.completions" :ui="state" :focus="snapshot?.focus" :status-text="statusText" :send="send"
      @draft-snapshot="value => emit('draft-snapshot', target, value)" @leave="returnToParent" @draft="emit('draft', target, $event)" @pending="setPending" @edit="edit" @complete="complete" @host="host" @press="press" @field="field" @scroll="scroll" @focus-report="focus" />
  </section>
</template>
<script setup lang="ts">
import { provideClaudeUiSelection } from './native-ui-selection.ts'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { usePlugin } from '@apackdev/sdk/fe'
import { queueClaudeUiRetirement } from './native-ui-retirement.ts'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import ScrollToBottomFob from '@apackdev/ui/design/ScrollToBottomFob'
import { useClaudeAgentScroll, type ClaudeAgentScrollPosition } from './native-agent-scroll.ts'
import NativeAgentHandback from '#extensions/blocks/display/NativeAgentHandback.vue'
import NativeAgentDetails from '#extensions/blocks/display/NativeAgentDetails.vue'
import NativeAgentComposer from './NativeAgentComposer.vue'
import type { ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'
import NativeCommandPanel from './NativeCommandPanel.vue'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import type { ThreadsState } from '../state.ts'
import type { ClaudeNativeAgentInputReview, ClaudeNativeAgentUiTarget } from '#features/code/common/native-terminal.ts'
import type { ClaudePromptEdit, ClaudePromptCompletionRequest, ClaudePromptHostResponse, ClaudeUiFieldEvent, ClaudeUiScrollEvent, ClaudeUiFocusEvent } from '#generated/types.ts'
const props = defineProps<{ threadId: string; target: ClaudeNativeAgentUiTarget; name: string; statusText?: string; draft: string; draftSnapshot?: ClaudeAgentDraftSnapshot; active: boolean; scrollPosition?: ClaudeAgentScrollPosition }>()
const emit = defineEmits<{ draft: [target: ClaudeNativeAgentUiTarget, text: string]; 'draft-snapshot': [target: ClaudeNativeAgentUiTarget, snapshot: ClaudeAgentDraftSnapshot]; pending: [value: boolean]; returning: [value: boolean]; returned: []; scrollPosition: [target: ClaudeNativeAgentUiTarget, position: ClaudeAgentScrollPosition] }>()
const transcriptViewport = ref<HTMLElement>(), transcriptContent = ref<HTMLElement>()
const scrollTarget = props.target
const transcriptScroll = useClaudeAgentScroll({ viewport: transcriptViewport, content: transcriptContent, active: () => props.active, initial: props.scrollPosition, save: position => emit('scrollPosition', scrollTarget, position) })
const actor: ThreadsState = usePlugin(), uiMount = ref<string>(), terminalMount = crypto.randomUUID()
const context = useSelector(actor, state => state.context)
const snapshot = computed(() => uiMount.value ? context.value.nativeUiViews[uiMount.value] : undefined)
const state = computed(() => snapshot.value?.state)
const selectionRoot = ref<HTMLElement | null>(null)
const pageSelection = provideClaudeUiSelection(() => selectionRoot.value)
watch(() => JSON.stringify([uiMount.value, state.value?.agent?.messages.filter(message => message.role === 'user').at(-1)?.uuid]), pageSelection.clear)

const frames = computed(() => new Map(state.value?.transcriptMessages?.map(frame => [frame.uuid, frame])))
const terminal = computed(() => context.value.nativeTerminalViews[terminalMount])
const selectedOwner = computed(() => {
  const owner = terminal.value?.state, selected = owner?.view
  return owner?.status === 'live' && owner.ownerId === props.target.ownerId && owner.sessionId === props.target.sessionId && selected?.kind === 'agent' && selected.taskId === props.target.taskId && selected.revision === props.target.revision ? owner : undefined
})
const selectedTask = computed(() => selectedOwner.value?.tasks.find(task => task.id === props.target.taskId))
const agentComposer = ref<InstanceType<typeof NativeAgentComposer>>(), commandPanel = ref<HTMLElement>(), cancelCommand = ref<HTMLButtonElement>(), commandSending = ref(false)
const dismissedOutput = ref<string>()
const outputActive = computed(() => state.value?.agentInput?.status === 'command_output' && !!state.value.agentInput.output && state.value.agentInput.output.messageId !== dismissedOutput.value)
function dismissOutput() { dismissedOutput.value = state.value?.agentInput?.output?.messageId; void nextTick(() => transcriptViewport.value?.focus({ preventScroll: true })) }
const panelActive = computed(() => state.value?.agentInput?.status === 'panel')
const commandActive = computed(() => panelActive.value || commandSending.value || state.value?.agentInput?.status === 'confirmation' || state.value?.agentInput?.status === 'deciding')
let commandFocusOwned = false
let commandDraft: { revision: number; text: string } | undefined
const pending = ref(false), returning = ref(false), stopping = ref(false), problem = ref<string>()
let heartbeat: ReturnType<typeof setInterval> | undefined, revision = 0, returnRevision = 0, stopRevision = 0
let submission: { revision: number; text: string; scrollIntent: number; resolve(review?: ClaudeNativeAgentInputReview | { commandPending: true }): void; reject(error: Error): void } | undefined
const identity = () => ({ threadId: props.threadId, mountId: uiMount.value! })
const terminalIdentity = () => ({ threadId: props.threadId, mountId: terminalMount })
function renew() { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_MOUNT', ...identity(), nativeView: props.target }); actor.send({ type: 'CLAUDE_TERMINAL_MOUNT', ...terminalIdentity() }) }
function detach() {
  if (heartbeat) clearInterval(heartbeat); heartbeat = undefined
  if (uiMount.value) {
    const snapshot = actor.getSnapshot()
    const resumeKey = snapshot.context.nativeUiViews[uiMount.value]?.resumeKey
    if (resumeKey) queueClaudeUiRetirement({ ...identity(), resumeKey })
    if (snapshot.status !== 'stopped') actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity() })
  }
  uiMount.value = undefined
  submission?.reject(Error('Agent view changed before acknowledgment')); submission = undefined
}
watch(() => props.active, active => { detach(); if (active) { uiMount.value = crypto.randomUUID(); renew(); heartbeat = setInterval(renew, 10000) } }, { immediate: true })
function setPending(value: boolean) { pending.value = value; emit('pending', value || returning.value || stopping.value || commandActive.value) }
function send(text: string): Promise<ClaudeNativeAgentInputReview | { commandPending: true } | void> {
  if (!uiMount.value || commandActive.value || stopping.value || returning.value || !selectedOwner.value || submission || !text.trim() || text.length > 16384) return Promise.reject(Error('Agent input must contain 1 to 16384 characters'))
  problem.value = undefined
  const request = ++revision
  return new Promise((resolve, reject) => { submission = { revision: request, text, scrollIntent: transcriptScroll.intentRevision(), resolve, reject }; actor.send({ type: 'CLAUDE_UI_AGENT_INPUT', ...identity(), revision: request, text }) })
}
watch(() => state.value?.agentInput, value => {
  if (value?.status === 'command_done' || value?.status === 'error') {
    commandSending.value = false
    const restoreFocus = commandFocusOwned || commandPanel.value?.contains(document.activeElement)
    commandFocusOwned = false
    if (commandDraft?.revision === value.revision) {
      if (value.status === 'command_done' && value.decision === 'confirm' && props.draft === commandDraft.text) emit('draft', props.target, '')
      commandDraft = undefined
    }
    if (value.status === 'error' && !submission) problem.value = value.problem
    emit('pending', pending.value || returning.value || stopping.value)
    if (restoreFocus) void nextTick(() => { if (props.active && document.activeElement === document.body) agentComposer.value?.focus() })
  }
  if (!submission || value?.revision !== submission.revision || value.status === 'pending') return
  const request = submission; submission = undefined
  if (value.status === 'done' && value.receipt) { if (props.draft === request.text) emit('draft', props.target, ''); transcriptScroll.latest(request.scrollIntent); request.resolve() }
  else if (value.status === 'panel' && value.panel) { if (props.draft === request.text) emit('draft', props.target, ''); request.resolve() }
  else if (value.status === 'command_output' && value.output) { if (props.draft === request.text) emit('draft', props.target, ''); request.resolve() }
  else if (value.status === 'confirmation' && value.command) { commandDraft = { revision: request.revision, text: request.text }; request.resolve({ commandPending: true }); void nextTick(() => cancelCommand.value?.focus({ preventScroll: true })) }
  else if (value.status === 'review' && value.review) request.resolve(value.review)
  else if (value.status === 'blocked') request.resolve({ commandPending: true })
  else request.reject(Error(value.problem ?? 'Agent input was refused'))
})
function returnToParent() {
  const owner = selectedOwner.value
  if (!owner || pending.value || returning.value || stopping.value || commandActive.value) return
  returning.value = true; emit('returning', true); emit('pending', true); problem.value = undefined
  returnRevision = Math.max(returnRevision, stopRevision, terminal.value?.task?.revision ?? 0) + 1
  actor.send({ type: 'CLAUDE_TERMINAL_TASK', ...terminalIdentity(), ownerId: owner.ownerId, taskId: props.target.taskId, revision: returnRevision, operation: 'background' })
}
function stopAgent() {
  const owner = selectedOwner.value
  if (!owner || selectedTask.value?.status !== 'running' || pending.value || returning.value || stopping.value || commandActive.value) return
  stopping.value = true; emit('pending', true); problem.value = undefined
  stopRevision = Math.max(returnRevision, stopRevision, terminal.value?.task?.revision ?? 0) + 1
  actor.send({ type: 'CLAUDE_TERMINAL_TASK', ...terminalIdentity(), ownerId: owner.ownerId, taskId: props.target.taskId, revision: stopRevision, operation: 'stop' })
}
watch(terminal, view => {
  const result = view?.task
  if (stopping.value && result?.revision === stopRevision && result.ownerId === props.target.ownerId && result.taskId === props.target.taskId && result.operation === 'stop' && result.status !== 'pending') {
    stopping.value = false; emit('pending', pending.value || returning.value)
    if (result.status === 'error') problem.value = result.problem ?? 'Agent could not be stopped'
  }
  if (!returning.value || result?.revision !== returnRevision || result.ownerId !== props.target.ownerId || result.taskId !== props.target.taskId || result.operation !== 'background' || result.status === 'pending') return
  if (result.status === 'done' && result.view?.taskId === null && view?.state?.view?.kind === 'main') { returning.value = false; emit('returning', false); emit('pending', false); emit('returned') }
  else if (result.status === 'error') { returning.value = false; problem.value = result.problem; emit('returning', false); emit('pending', false) }
})
function decideCommand(decision: 'confirm' | 'cancel') {
  const input = state.value?.agentInput
  if (!uiMount.value || commandSending.value || input?.status !== 'confirmation' || !input.command) return
  commandFocusOwned = !!commandPanel.value?.contains(document.activeElement)
  commandSending.value = true; emit('pending', true); problem.value = undefined
  actor.send({ type: 'CLAUDE_UI_COMMAND_DECISION', ...identity(), revision: input.revision, commandId: input.command.id, decision })
}
watch(panelActive, (value, previous) => { if (previous && !value) void nextTick(() => { if (props.active) agentComposer.value?.focus() }) })
function panelInput(text?: string) {
  const input = state.value?.agentInput
  if (uiMount.value && input?.status === 'panel' && input.panel) actor.send({ type: 'CLAUDE_UI_COMMAND_PANEL', ...identity(), revision: input.revision, panelId: input.panel.id, ...(text !== undefined ? { text } : {}) })
}
function panelResize(size: { columns: number; rows: number }) {
  const ownerId = selectedOwner.value?.ownerId
  if (panelActive.value && ownerId) actor.send({ type: 'CLAUDE_TERMINAL_RESIZE', ...terminalIdentity(), ownerId, ...size })
}
watch(commandActive, value => emit('pending', value || pending.value || returning.value || stopping.value))
function escape(event: KeyboardEvent) { if (!event.isComposing && !event.defaultPrevented && !pending.value) { event.preventDefault(); event.stopPropagation(); if (commandActive.value) decideCommand('cancel'); else returnToParent() } }
function press(actionId: string, href?: string) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_PRESS', ...identity(), actionId, ...(href ? { href } : {}) }) }
function field(value: ClaudeUiFieldEvent) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_FIELD', ...identity(), ...value }) }
function scroll(value: ClaudeUiScrollEvent) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_SCROLL', ...identity(), ...value }) }
function focus(value: ClaudeUiFocusEvent) { if (uiMount.value) actor.send({ type: 'CLAUDE_UI_FOCUS', ...identity(), ...value }) }
function edit(value: ClaudePromptEdit) { if (uiMount.value) actor.send({ type: 'CLAUDE_PROMPT_EDIT', ...identity(), ...value }) }
function complete(value: ClaudePromptCompletionRequest) { if (uiMount.value) actor.send({ type: 'CLAUDE_PROMPT_AUTOCOMPLETE', ...identity(), ...value }) }
function host(value: ClaudePromptHostResponse) { if (uiMount.value) actor.send({ type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...identity(), ...value }) }
onBeforeUnmount(() => { detach(); actor.send({ type: 'CLAUDE_TERMINAL_UNMOUNT', ...terminalIdentity() }); emit('pending', false); emit('returning', false) })
</script>

<style scoped>
@media (max-height: 700px) {
  .native-agent-view > header { padding-top: .25rem; padding-bottom: .5rem; margin-bottom: .25rem; }
  .native-agent-eyebrow { display: none; }
  .native-agent-view > details { margin-bottom: 0; }
}
</style>
