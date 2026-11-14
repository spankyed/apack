<template>
  <section aria-label="Other Claude activity" class="mt-3 min-w-0 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
      <span class="font-medium text-neutral-300">Claude activity</span>
      <button type="button" :disabled="disabled" class="rounded border border-white/10 px-2 py-1 text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="emit('manage')">Manage in Claude</button>
    </div>
    <ul class="m-0 list-none p-0">
      <li v-for="task in tasks" :key="task.id" :data-native-managed-task-id="task.id" class="flex min-w-0 flex-wrap items-start justify-between gap-3 py-2">
        <div class="min-w-0"><span class="block break-words text-neutral-200">{{ task.name }}</span><span v-if="task.nativeTaskType" class="text-neutral-500">{{ claudeNativeManagedTaskLabels[task.nativeTaskType] }}</span></div>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span class="text-neutral-400">{{ task.status }}</span>
          <button v-if="task.nativeTaskType && task.nativeTaskType !== 'remote_agent' && task.canStop" type="button" :aria-label="'Stop ' + task.name" :disabled="disabled || task.status !== 'running' || !controls || controls.ownerId.value !== task.ownerId || controls.state.value?.status === 'pending'" class="rounded border border-red-400/20 px-2 py-1 text-red-300 hover:bg-red-400/10 disabled:opacity-40" @click="controls?.operate(task, 'stop')">{{ taskState(task)?.status === 'pending' && taskState(task)?.operation === 'stop' ? 'Stopping…' : 'Stop' }}</button>
        </div>
        <p v-if="taskState(task)?.status === 'error'" role="alert" class="basis-full text-red-300">{{ taskState(task)?.problem }}</p>
      </li>
    </ul>
  </section>
</template>
<script setup lang="ts">
import { inject } from 'vue'
import { claudeTaskControls, type ClaudeTaskIdentity } from '#extensions/blocks/display/native-task-controls.ts'
import { claudeNativeManagedTaskLabels } from '#features/code/common/native-managed-task.ts'
import type { ClaudeNativeTerminalTask } from '#features/code/common/native-terminal.ts'
defineProps<{ tasks: (ClaudeNativeTerminalTask & ClaudeTaskIdentity)[]; disabled?: boolean }>()
const emit = defineEmits<{ manage: [] }>()
const controls = inject(claudeTaskControls, undefined)
function taskState(task: ClaudeTaskIdentity) {
  const state = controls?.state.value
  return state?.ownerId === task.ownerId && state.taskId === task.id ? state : undefined
}
</script>
