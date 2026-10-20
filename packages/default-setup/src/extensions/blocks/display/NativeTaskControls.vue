<template>
  <div v-if="controls && controls.ownerId.value === task.ownerId" @keydown.esc="leaveConversation" class="mt-2 min-w-0">
    <div class="flex flex-wrap items-center gap-2">
      <button v-if="!workflow && controls.foregroundAvailable.value" type="button" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" :disabled="pending" @click="controls.operate(task, 'foreground')">Open Agent</button>
      <NativeWorkflowDetails v-if="workflow" :details="state?.details" :pending="pending" :status="task.status" :problem="state?.status === 'error' ? state.problem : undefined" @inspect="controls.operate(task, 'inspect')" />
      <button v-else ref="toggle" type="button" :aria-expanded="shown" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" :disabled="pending" @click="showConversation">{{ workflow ? shown ? 'Hide Workflow details' : 'Workflow details' : shown ? 'Hide Agent conversation' : 'View Agent conversation' }}</button>
      <button type="button" class="rounded px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/10 disabled:opacity-40" :disabled="pending || task.status !== 'running'" @click="controls.operate(task, 'stop')">{{ pending && state?.operation === 'stop' ? 'Stopping…' : workflow ? 'Stop Workflow' : 'Stop Agent' }}</button>
    </div>
    <p v-if="state?.status === 'error'" role="alert" class="mt-2 text-xs text-red-300">{{ state.problem }}</p>
    <section v-if="!workflow && shown && state?.details" :aria-label="workflow ? 'Workflow details' : 'Agent conversation'" tabindex="0" class="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded border border-white/10 p-2 text-xs">
      <button type="button" class="mb-2 text-[11px] text-neutral-400 hover:text-neutral-200 disabled:opacity-40" :disabled="pending" @click="controls.operate(task, 'inspect')">{{ workflow ? 'Refresh details' : 'Refresh conversation' }}</button>
      <NativeAgentDetails :details="state.details" />
      <p v-if="!workflow && !state.details.messages.length" class="text-neutral-500">No conversation messages are available yet.</p>
      <article v-for="message in state.details.messages" :key="message.uuid" class="mb-3 last:mb-0">
        <div class="mb-1 text-[10px] uppercase text-neutral-500">{{ message.role }}</div>
        <pre class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-neutral-300">{{ message.text }}</pre>
      </article>
      <p v-if="state.details.truncated" class="text-neutral-500">Conversation preview shortened.</p>
      <form v-if="state.details.canInput || state.details.canMessage" class="mt-3 border-t border-white/10 pt-3" @submit.prevent="sendMessage">
        <label class="block text-[11px] text-neutral-400">{{ state.details.canInput ? 'Reply to this Agent' : 'Message this Agent' }}
          <textarea v-model="draft" :aria-label="state.details.canInput ? 'Reply to this Agent' : 'Message this Agent'" maxlength="16384" rows="2" class="mt-1 block w-full resize-y rounded border border-white/10 bg-neutral-900/40 px-2 py-1.5 text-xs text-neutral-200 focus:border-blue-400/50 focus:outline-none" />
        </label>
        <button type="submit" :disabled="pending || !draft.trim()" class="mt-2 rounded bg-blue-600 px-2.5 py-1 text-[11px] text-white hover:bg-blue-500 disabled:opacity-40">{{ pending && ['send', 'input'].includes(state.operation) ? 'Sending…' : state.details.canInput ? 'Reply to Agent' : 'Send to Agent' }}</button>
      </form>
    </section>
    <p v-if="state?.status === 'done' && state.operation === 'send' && state.sent" role="status" class="mt-2 text-[11px] text-neutral-400">Message sent to Agent</p>
    <p v-if="state?.status === 'done' && state.operation === 'input' && state.input" role="status" class="mt-2 text-[11px] text-neutral-400">{{ state.input.mode === 'resumed' ? 'Agent resumed with your reply' : 'Reply queued for Agent' }}</p>
  </div>
</template>
<script setup lang="ts">
import NativeAgentDetails from './NativeAgentDetails.vue'
import NativeWorkflowDetails from './NativeWorkflowDetails.vue'
import { computed, inject, ref, watch } from 'vue'
import { claudeTaskControls, type ClaudeTaskIdentity } from './native-task-controls.ts'
const props = defineProps<{ task: ClaudeTaskIdentity & { status: string } }>()
const workflow = computed(() => props.task.kind === 'workflow')
const controls = inject(claudeTaskControls, undefined)
const state = computed(() => { const value = controls?.state.value; return value?.ownerId === props.task.ownerId && value.taskId === props.task.id ? value : undefined })
const shown = ref(false), draft = ref(''), toggle = ref<HTMLButtonElement | null>(null)
let submitted: { revision: number; text: string } | undefined
watch(state, value => { if (submitted && value?.status === 'done' && (value.operation === 'send' && value.sent || value.operation === 'input' && value.input) && value.revision === submitted.revision && draft.value === submitted.text) draft.value = '' })
function sendMessage() {
  if (!draft.value.trim() || pending.value) return
  const text = draft.value, revision = controls?.operate(props.task, state.value?.details?.canInput ? 'input' : 'send', text)
  if (revision !== undefined) submitted = { revision, text }
}
const pending = computed(() => controls?.state.value?.status === 'pending')
function leaveConversation(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented || !shown.value) return
  event.preventDefault(); event.stopPropagation(); shown.value = false; toggle.value?.focus({ preventScroll: true })
}
function showConversation() { shown.value = !shown.value; if (shown.value) controls?.operate(props.task, 'inspect') }
</script>
