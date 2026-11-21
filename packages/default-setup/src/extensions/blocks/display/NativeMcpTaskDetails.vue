<template>
  <div>
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
      <template v-if="info.serverName"><dt class="text-neutral-500">Server</dt><dd class="m-0 break-words text-neutral-200">{{ info.serverName }}</dd></template>
      <template v-if="info.toolName"><dt class="text-neutral-500">Tool</dt><dd class="m-0 break-words text-neutral-200">{{ info.toolName }}</dd></template>
      <template v-if="info.serverTaskId"><dt class="text-neutral-500">Server task</dt><dd class="m-0 break-all text-neutral-300">{{ info.serverTaskId }}</dd></template>
      <dt class="text-neutral-500">Status</dt><dd class="m-0 break-words text-neutral-200">{{ status === 'killed' ? 'Stopped' : info.status.replaceAll('_', ' ') }}</dd>
      <template v-if="info.statusMessage"><dt class="text-neutral-500">Progress</dt><dd class="m-0 whitespace-pre-wrap break-words text-neutral-300">{{ info.statusMessage }}</dd></template>
      <dt class="text-neutral-500">Elapsed</dt><dd class="m-0 text-neutral-300">{{ elapsed }}s</dd>
      <template v-if="info.pollIntervalMs !== undefined"><dt class="text-neutral-500">Polling</dt><dd class="m-0 text-neutral-300">Every {{ (info.pollIntervalMs / 1000).toLocaleString() }}s</dd></template>
    </dl>
    <p v-if="info.truncated" class="mt-3 text-neutral-500">Some task details are shortened.</p>
    <p v-if="status === 'running' && info.status === 'input_required'" role="status" class="mt-3 text-amber-200">Waiting for your answer in the MCP question.</p>
    <p v-if="status === 'running' && info.protocol === 'sep2663'" class="mt-3 text-neutral-400">This task runs on the server and can continue after you leave this session.</p>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ClaudeNativeMcpTaskInfo } from '#features/code/common/native-mcp-task.ts'
const props = defineProps<{ info: ClaudeNativeMcpTaskInfo; status: string }>()
const now = ref(Date.now())
const elapsed = computed(() => Math.floor(Math.max(0, (props.info.endTime ?? now.value) - props.info.startTime) / 1000))
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { if (props.status === 'running') now.value = Date.now() }, 1000) })
watch(() => props.status, () => { now.value = Date.now() })
onUnmounted(() => clearInterval(timer))
</script>
