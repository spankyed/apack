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
      <button type="button" class="rounded px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/10 disabled:opacity-40" :disabled="pending || (workflow || shell || mcp ? task.canStop !== true : task.status !== 'running')" @click="controls.operate(task, 'stop')">{{ pending && state?.operation === 'stop' ? 'Stopping…' : workflow ? 'Stop Workflow' : shell ? 'Stop command' : mcp ? 'Stop task' : 'Stop Agent' }}</button>
    </div>
    <p v-if="state?.status === 'error' && !mcpDialog" role="alert" class="mt-2 text-xs text-red-300">{{ state.problem }}</p>
    <section v-if="!workflow && !shell && !mcp && shown && state?.details" :aria-label="workflow ? 'Workflow details' : 'Agent conversation'" tabindex="0" class="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded border border-white/10 p-2 text-xs">
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
      <form v-if="state.details.canInput || state.details.canMessage" class="mt-3 border-t border-white/10 pt-3" @submit.prevent="sendMessage">
        <label class="block text-[11px] text-neutral-400">{{ state.details.canInput ? 'Reply to this Agent' : 'Message this Agent' }}
          <textarea v-model="draft" :aria-label="state.details.canInput ? 'Reply to this Agent' : 'Message this Agent'" maxlength="16384" rows="2" class="mt-1 block w-full resize-y rounded border border-white/10 bg-neutral-900/40 px-2 py-1.5 text-xs text-neutral-200 focus:border-blue-400/50 focus:outline-none" />
        </label>
        <button type="submit" :disabled="pending || !draft.trim()" class="mt-2 rounded bg-blue-600 px-2.5 py-1 text-[11px] text-white hover:bg-blue-500 disabled:opacity-40">{{ pending && ['send', 'input'].includes(state.operation) ? 'Sending…' : state.details.canInput ? 'Reply to Agent' : 'Send to Agent' }}</button>
      </form>
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
    <section v-if="shell && shown && state?.details?.shell" aria-label="Background command output" tabindex="0" class="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded border border-white/10 px-3 py-1.5 text-xs">
      <button type="button" :disabled="pending" class="mb-1 text-neutral-400 hover:text-neutral-200 disabled:opacity-40" @click="controls.operate(task,'inspect')">Refresh output</button>
      <details class="mb-1">
        <summary class="cursor-pointer text-neutral-400">Command details</summary>
      <p v-if="state.details.shell.cwd" class="mb-2 break-all text-neutral-500">{{ state.details.shell.cwd }}</p>
      <pre class="mb-3 whitespace-pre-wrap [overflow-wrap:anywhere] text-neutral-300">{{ state.details.shell.command }}</pre>
      <p v-if="state.details.shell.commandTruncated" class="text-neutral-500">Command preview shortened.</p>
      </details>
      <pre v-if="state.details.shell.output" class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-neutral-300">{{ state.details.shell.output }}</pre>
      <p v-else class="text-neutral-500">No output yet.</p>
      <p v-if="state.details.shell.truncated" class="mt-2 text-neutral-500">Showing the latest output · {{ state.details.shell.totalBytes.toLocaleString() }} bytes total.</p>
    </section>
    <p v-if="state?.status === 'done' && state.operation === 'send' && state.sent" role="status" class="mt-2 text-[11px] text-neutral-400">Message sent to Agent</p>
    <p v-if="state?.status === 'done' && state.operation === 'input' && state.input" role="status" class="mt-2 text-[11px] text-neutral-400">{{ state.input.mode === 'resumed' ? 'Agent resumed with your reply' : 'Reply queued for Agent' }}</p>
  </div>
</template>
<script setup lang="ts">
import NativeAgentDetails from './NativeAgentDetails.vue'
import NativeMcpTaskDetails from './NativeMcpTaskDetails.vue'
import NativeWorkflowDetails from './NativeWorkflowDetails.vue'
import { computed, inject, ref, watch } from 'vue'
import { claudeTaskControls, type ClaudeTaskIdentity } from './native-task-controls.ts'
const props = defineProps<{ task: ClaudeTaskIdentity & { status: string } }>()
const emit = defineEmits<{ 'reveal-shell-output': [element: HTMLElement] }>()
const workflow = computed(() => props.task.kind === 'workflow')
const shell = computed(() => props.task.kind === 'shell')
const mcp = computed(() => props.task.kind === 'mcp')
const controls = inject(claudeTaskControls, undefined)
const taskKey = computed(() => JSON.stringify([props.task.ownerId, props.task.sessionId, props.task.id]))
const sessionState = computed(() => {
  const value = controls?.state.value
  return value?.ownerId === props.task.ownerId && value.sessionId === props.task.sessionId ? value : undefined
})
const state = computed(() => sessionState.value?.taskId === props.task.id ? sessionState.value : undefined)
watch(state, value => { if (value?.status === 'done' && (value.worker?.accepted || value.paused)) controls?.operate(props.task, 'inspect') })
const shown = ref(false), draft = ref(''), toggle = ref<HTMLButtonElement | null>(null)
const taskControls = ref<HTMLElement | null>(null)
let revealShellRevision: number | undefined
watch(state, value => {
  if (!value || value.revision !== revealShellRevision || value.status === 'pending') return
  revealShellRevision = undefined
  if (value.status === 'done' && value.details?.shell && shown.value && taskControls.value) emit('reveal-shell-output', taskControls.value)
}, { flush: 'post' })
const mcpDialog = ref<HTMLDialogElement | null>(null)
watch(mcpDialog, (dialog, previous) => {
  previous?.close()
  dialog?.showModal()
}, { flush: 'post' })
function closeDetails() {
  mcpDialog.value?.close()
  shown.value = false
  revealShellRevision = undefined
  toggle.value?.focus({ preventScroll: true })
}
const expanded = computed(() => shown.value && state.value !== undefined)
let submitted: { revision: number; text: string } | undefined
watch(taskKey, () => {
  shown.value = false
  revealShellRevision = undefined
  draft.value = ''
  submitted = undefined
})
watch(state, value => { if (submitted && value?.status === 'done' && (value.operation === 'send' && value.sent || value.operation === 'input' && value.input) && value.revision === submitted.revision && draft.value === submitted.text) draft.value = '' })
function sendMessage() {
  if (!draft.value.trim() || pending.value) return
  const text = draft.value, revision = controls?.operate(props.task, state.value?.details?.canInput ? 'input' : 'send', text)
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
  if (shell.value) revealShellRevision = revision
}
</script>
