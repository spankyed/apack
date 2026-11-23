<template>
  <div v-if="task.kind !== 'managed' && controls && controls.ownerId.value === task.ownerId" :key="taskKey" ref="taskControls" @keydown.esc="leaveConversation" class="mt-2 min-w-0 scroll-my-1">
    <div class="flex flex-wrap items-center gap-2">
      <button v-if="!workflow && !shell && !mcp && controls.foregroundAvailable.value" type="button" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" :disabled="pending" @click="controls.operate(task, 'foreground')">Open Agent</button>
      <NativeWorkflowDetails v-if="workflow" :details="state?.details" :pending="pending" :status="task.status" :problem="state?.status === 'error' ? state.problem : undefined" @inspect="controls.operate(task, 'inspect')" @worker="(operation, target) => controls?.operate(task, operation, undefined, target)" />
      <button v-else-if="!shell && !mcp" ref="toggle" type="button" :aria-expanded="expanded" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" :disabled="pending" @click="showConversation">{{ workflow ? expanded ? 'Hide Workflow details' : 'Workflow details' : expanded ? 'Hide Agent conversation' : 'View Agent conversation' }}</button>
      <button v-if="mcp" ref="toggle" type="button" :aria-expanded="expanded" :disabled="pending" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="showConversation">{{ expanded ? 'Hide task details' : 'Task details' }}</button>
      <button v-if="shell" ref="toggle" type="button" :aria-expanded="expanded" :disabled="pending" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="showConversation">{{ expanded ? 'Hide output' : 'View output' }}</button>
      <button v-if="workflow && task.canPause" type="button" :disabled="pending" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="controls.operate(task, 'pause_workflow')">Pause Workflow</button>
      <button v-if="workflow && task.canResume && controls.foregroundAvailable.value" type="button" :disabled="pending || !!state?.resume?.requested" class="rounded border border-white/10 px-2 py-1 text-[11px] text-blue-300 hover:bg-white/5 disabled:opacity-40" @click="controls.operate(task, 'resume_workflow')">{{ state?.resume?.requested ? 'Resume requested' : 'Resume Workflow' }}</button>
      <button type="button" class="rounded px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/10 disabled:opacity-40" :disabled="pending || !canStop" @click="controls.operate(task, 'stop')">{{ pending && state?.operation === 'stop' ? 'Stopping…' : workflow ? 'Stop Workflow' : shell ? 'Stop command' : mcp ? 'Stop task' : 'Stop Agent' }}</button>
    </div>
    <p v-if="state?.status === 'error' && !mcpDialog" role="alert" class="mt-2 text-xs text-red-300">{{ state.problem }}</p>
    <p v-if="state?.status === 'done' && state.operation === 'send' && state.sent" role="status" class="mt-2 text-[11px] text-neutral-400">Message sent to Agent</p>
    <p v-if="state?.status === 'done' && state.operation === 'input' && state.input" role="status" class="mt-2 text-[11px] text-neutral-400">{{ state.input.mode === 'resumed' ? 'Agent resumed with your reply' : 'Reply queued for Agent' }}</p>
    <section v-if="!workflow && !shell && !mcp && shown && state?.details" aria-label="Agent conversation" tabindex="0" class="mt-2 rounded border border-white/10 p-2 text-xs">
      <button v-if="state.details.canAttach && task.canStop && controls.openTeammateTerminal" type="button" class="mb-2 rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5" @click="controls.openTeammateTerminal(task)">Open teammate terminals</button>
      <p v-else-if="state.details.externalPane && state.details.status === 'running'" class="mb-2 text-[11px] text-neutral-400">Reply directly in the teammate’s terminal pane.</p>
      <form v-if="sendOperation" class="space-y-1.5 border-b border-white/10 pb-2 mb-2" @submit.prevent="sendMessage">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <label :for="messageFieldId" class="text-[11px] font-medium text-neutral-300">{{ messageLabel }}</label>
          <p v-if="state.details.canFocusInput && controls.foregroundAvailable.value" class="text-[11px] text-neutral-400">Open Agent to reply directly.</p>
        </div>
        <div class="flex items-end gap-2">
          <textarea :id="messageFieldId" v-model="draft" maxlength="16384" rows="2" class="block min-w-0 flex-1 resize-y rounded border border-white/10 bg-neutral-900/40 px-2 py-1 text-xs text-neutral-200 focus:border-blue-400/50 focus:outline-none" />
          <button type="submit" :disabled="pending || !draft.trim()" class="shrink-0 rounded bg-blue-600 px-2.5 py-1 text-[11px] text-white hover:bg-blue-500 disabled:opacity-40">{{ pending && ['send', 'input'].includes(state.operation) ? 'Sending…' : sendOperation === 'input' ? 'Reply to Agent' : 'Send to Agent' }}</button>
        </div>
      </form>
      <p v-else-if="state.details.canFocusInput && controls.foregroundAvailable.value" class="mb-2 text-[11px] text-neutral-400">Open Agent to reply directly.</p>
      <button type="button" class="mb-2 text-[11px] text-neutral-400 hover:text-neutral-200 disabled:opacity-40" :disabled="pending" @click="controls.operate(task, 'inspect')">{{ workflow ? 'Refresh details' : 'Refresh conversation' }}</button>
      <NativeAgentDetails :details="state.details" />
      <p v-if="!workflow && !state.details.messages.length" class="text-neutral-500">No conversation messages are available yet.</p>
      <article v-for="message in state.details.messages" :key="message.uuid" :data-native-agent-message="message.uuid" class="mb-3 last:mb-0">
        <template v-if="message.role === 'system'">
          <p v-if="message.compaction === 'boundary'" class="text-neutral-400">Conversation compacted</p>
          <details v-else>
            <summary class="cursor-pointer text-neutral-300">Compact summary</summary>
            <p class="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-neutral-300">{{ message.text }}</p>
          </details>
        </template>
        <template v-else>
          <div class="mb-1 text-[10px] uppercase text-neutral-500">{{ message.role }}</div>
          <pre class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-neutral-300">{{ message.text }}</pre>
        </template>
      </article>
      <p v-if="state.details.truncated" class="text-neutral-500">Conversation preview shortened.</p>
    </section>
    <dialog v-if="mcp && shown && state?.details?.mcp" ref="mcpDialog" aria-label="MCP task details"
      class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-xl border border-white/10 bg-neutral-900 p-0 text-neutral-200 shadow-xl backdrop:bg-black/60"
      @cancel.prevent="closeDetails">
      <div class="flex max-h-[calc(100dvh-2rem)] flex-col">
        <header class="shrink-0 border-b border-white/10 px-4 py-3">
          <h2 class="text-sm font-semibold">{{ state.details.name }}</h2>
        </header>
        <div class="min-h-0 overflow-y-auto p-4 text-xs">
          <NativeMcpTaskDetails :info="task.mcp ?? state.details.mcp" :status="task.status" />
          <p v-if="state.status === 'error'" role="alert" class="mt-3 text-red-300">{{ state.problem }}</p>
          <button type="button" :disabled="pending" class="mt-3 text-neutral-400 hover:text-neutral-200 disabled:opacity-40" @click="controls.operate(task,'inspect')">Refresh task details</button>
        </div>
        <footer class="flex shrink-0 justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button type="button" autofocus class="rounded px-3 py-2 text-xs hover:bg-white/10" @click="closeDetails">Close</button>
          <button type="button" class="rounded px-3 py-2 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-40"
            :disabled="pending || task.canStop !== true" @click="controls.operate(task,'stop')">{{ pending && state.operation === 'stop' ? 'Stopping…' : 'Stop task' }}</button>
        </footer>
      </div>
    </dialog>
    <section v-if="shell && shown && state?.details?.shell" aria-label="Background command output" class="mt-2 rounded border border-white/10 px-3 py-1.5 text-xs">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" :disabled="pending" class="text-neutral-400 hover:text-neutral-200 disabled:opacity-40" @click="refreshShellOutput">Refresh output</button>
        <p v-if="state.details.shell.truncated" class="text-neutral-400">Showing the latest output · {{ state.details.shell.totalBytes.toLocaleString() }} bytes total.</p>
      </div>
      <details class="my-1">
        <summary class="cursor-pointer text-neutral-400">Command details</summary>
        <p v-if="state.details.shell.cwd" class="mb-2 break-all text-neutral-500">{{ state.details.shell.cwd }}</p>
        <pre class="max-h-32 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-neutral-300">{{ state.details.shell.command }}</pre>
        <p v-if="state.details.shell.commandTruncated" class="text-neutral-500">Command preview shortened.</p>
      </details>
      <pre v-if="state.details.shell.output" ref="shellLog" tabindex="0" aria-label="Output preview" class="shell-log m-0 max-h-24 overflow-y-auto overscroll-contain whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-neutral-300 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2">{{ state.details.shell.output }}</pre>
      <p v-else class="text-neutral-500">No output yet.</p>
    </section>
  </div>
</template>
<script setup lang="ts">
import NativeAgentDetails from './NativeAgentDetails.vue'
import NativeMcpTaskDetails from './NativeMcpTaskDetails.vue'
import NativeWorkflowDetails from './NativeWorkflowDetails.vue'
import { computed, inject, ref, useId, watch } from 'vue'
import { claudeTaskControls, type ClaudeTaskIdentity } from './native-task-controls.ts'
const props = defineProps<{ task: ClaudeTaskIdentity & { status: string } }>()
const emit = defineEmits<{ 'reveal-shell-output': [element: HTMLElement] }>()
const workflow = computed(() => props.task.kind === 'workflow')
const shell = computed(() => props.task.kind === 'shell')
const mcp = computed(() => props.task.kind === 'mcp')
const canStop = computed(() => workflow.value || shell.value || mcp.value
  ? props.task.canStop === true : props.task.canStop ?? props.task.status === 'running')
const controls = inject(claudeTaskControls, undefined)
const taskKey = computed(() => JSON.stringify([props.task.ownerId, props.task.sessionId, props.task.id]))
const sessionState = computed(() => {
  const value = controls?.state.value
  return value?.ownerId === props.task.ownerId && value.sessionId === props.task.sessionId ? value : undefined
})
const state = computed(() => sessionState.value?.taskId === props.task.id ? sessionState.value : undefined)
watch(state, value => { if (value?.status === 'done' && (value.worker?.accepted || value.paused)) controls?.operate(props.task, 'inspect') })
const messageFieldId = useId()
const shown = ref(false), draft = ref(''), toggle = ref<HTMLButtonElement | null>(null)
const taskControls = ref<HTMLElement | null>(null)
const shellLog = ref<HTMLElement | null>(null)
let shellRead: { revision: number; reveal: boolean; followTail: boolean } | undefined
watch(state, value => {
  const read = shellRead
  if (!read || value?.revision !== read.revision || value.status === 'pending') return
  shellRead = undefined
  if (value.status !== 'done' || !value.details?.shell || !shown.value) return
  if (read.followTail && shellLog.value) shellLog.value.scrollTop = shellLog.value.scrollHeight
  if (read.reveal && taskControls.value) emit('reveal-shell-output', taskControls.value)
}, { flush: 'post' })
const mcpDialog = ref<HTMLDialogElement | null>(null)
watch(mcpDialog, (dialog, previous) => {
  previous?.close()
  dialog?.showModal()
}, { flush: 'post' })
function closeDetails() {
  mcpDialog.value?.close()
  shown.value = false
  shellRead = undefined
  toggle.value?.focus({ preventScroll: true })
}
const expanded = computed(() => shown.value && state.value !== undefined)
let submitted: { revision: number; text: string } | undefined
watch(taskKey, () => {
  shown.value = false
  shellRead = undefined
  draft.value = ''
  submitted = undefined
})
watch(state, value => { if (submitted && value?.status === 'done' && (value.operation === 'send' && value.sent || value.operation === 'input' && value.input) && value.revision === submitted.revision && draft.value === submitted.text) draft.value = '' })
const sendOperation = computed(() => {
  const details = state.value?.details
  if (details?.canInput) return 'input'
  if (details?.canMessage) return 'send'
})
const messageLabel = computed(() => sendOperation.value === 'input' ? 'Reply to this Agent'
  : state.value?.details?.canFocusInput !== undefined ? 'Message as team lead' : 'Message this Agent')
function sendMessage() {
  const operation = sendOperation.value
  if (!operation || !draft.value.trim() || pending.value) return
  const text = draft.value, revision = controls?.operate(props.task, operation, text)
  if (revision !== undefined) submitted = { revision, text }
}
const pending = computed(() => sessionState.value?.status === 'pending')
function leaveConversation(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented || !expanded.value) return
  event.preventDefault(); event.stopPropagation(); closeDetails()
}
function showConversation() {
  shown.value = !expanded.value
  const revision = shown.value ? controls?.operate(props.task, 'inspect') : undefined
  if (shell.value) shellRead = revision === undefined ? undefined : { revision, reveal: true, followTail: true }
}
function refreshShellOutput() {
  const log = shellLog.value
  const followTail = !log || log.scrollHeight - log.clientHeight - log.scrollTop <= 1
  const revision = controls?.operate(props.task, 'inspect')
  if (revision !== undefined) shellRead = { revision, reveal: false, followTail }
}
</script>


<style scoped>
@media (max-height: 700px) {
  .shell-log { max-height: 2.75rem; }
}
</style>
