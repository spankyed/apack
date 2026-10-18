<template>
  <div v-if="controls && controls.ownerId.value === task.ownerId" class="mt-2 min-w-0">
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40" :disabled="pending" @click="showConversation">{{ shown ? 'Hide Agent conversation' : 'View Agent conversation' }}</button>
      <button type="button" class="rounded px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/10 disabled:opacity-40" :disabled="pending || task.status !== 'running'" @click="controls.operate(task, 'stop')">{{ pending && state?.operation === 'stop' ? 'Stopping…' : 'Stop Agent' }}</button>
    </div>
    <p v-if="state?.status === 'error'" role="alert" class="mt-2 text-xs text-red-300">{{ state.problem }}</p>
    <section v-if="shown && state?.details" aria-label="Agent conversation" tabindex="0" class="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded border border-white/10 p-2 text-xs">
      <button type="button" class="mb-2 text-[11px] text-neutral-400 hover:text-neutral-200 disabled:opacity-40" :disabled="pending" @click="controls.operate(task, 'inspect')">Refresh conversation</button>
      <p v-if="!state.details.messages.length" class="text-neutral-500">No conversation messages are available yet.</p>
      <article v-for="(message, index) in state.details.messages" :key="index" class="mb-3 last:mb-0">
        <div class="mb-1 text-[10px] uppercase text-neutral-500">{{ message.role }}</div>
        <pre class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-neutral-300">{{ message.text }}</pre>
      </article>
      <p v-if="state.details.truncated" class="text-neutral-500">Conversation preview shortened.</p>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { claudeTaskControls, type ClaudeTaskIdentity } from './native-task-controls.ts'
const props = defineProps<{ task: ClaudeTaskIdentity & { status: string } }>()
const controls = inject(claudeTaskControls, undefined)
const state = computed(() => { const value = controls?.state.value; return value?.ownerId === props.task.ownerId && value.taskId === props.task.id ? value : undefined })
const shown = ref(false)
const pending = computed(() => controls?.state.value?.status === 'pending')
function showConversation() { shown.value = !shown.value; if (shown.value) controls?.operate(props.task, 'inspect') }
</script>
