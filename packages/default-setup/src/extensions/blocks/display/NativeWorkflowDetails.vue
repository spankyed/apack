<template>
  <PopoverRoot v-model:open="open" @update:open="opened">
    <PopoverTrigger as-child><button ref="trigger" type="button" :disabled="pending" class="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-40">Workflow details</button></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent side="top" align="start" :side-offset="8" :collision-padding="12" aria-label="Workflow details" @keydown.esc="escape" :style="{ maxHeight: previewHeight + 'px' }" class="z-50 w-[min(36rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-neutral-900 p-4 text-xs text-neutral-300 shadow-2xl outline-none">
        <header class="sticky top-0 z-10 -mx-4 -mt-4 mb-3 border-b border-white/10 bg-neutral-900 px-4 py-3 flex items-start justify-between gap-4"><div><h3 class="m-0 text-sm font-medium text-neutral-100">{{ details?.name ?? 'Workflow' }}</h3><p class="mt-1 text-neutral-400">{{ details?.status === 'killed' ? 'Stopped' : details?.status ?? status }}</p></div><PopoverClose as-child><button type="button" aria-label="Close Workflow details" class="rounded px-2 py-1 text-neutral-400 hover:bg-white/5">Close</button></PopoverClose></header>
        <p v-if="problem" role="alert" class="text-red-300">{{ problem }}</p>
        <p v-if="!details" role="status">Loading Workflow details…</p>
        <template v-else>
          <div class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-neutral-400"><span v-if="details.workflow">{{ details.workflow.agentCount }} {{ details.workflow.agentCount === 1 ? 'agent' : 'agents' }} · {{ details.workflow.phaseCount }} {{ details.workflow.phaseCount === 1 ? 'phase' : 'phases' }}</span><span v-if="details.metadata?.elapsedMs !== undefined">{{ Math.floor(details.metadata.elapsedMs / 1000) }}s elapsed</span><span v-if="details.metadata?.tokenCount !== undefined">{{ details.metadata.tokenCount }} tokens</span><span v-if="details.metadata?.toolUseCount !== undefined">{{ details.metadata.toolUseCount }} tools</span></div>
          <p v-if="details.metadata?.error" role="alert" class="whitespace-pre-wrap text-red-300 [overflow-wrap:anywhere]">{{ details.metadata.error }}</p>
          <section v-if="phases.length" aria-label="Workflow phases" class="mb-3"><h4 class="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Phases</h4><ol class="m-0 space-y-1 pl-4"><li v-for="phase in phases" :key="phase.index">{{ phase.title }}<span v-if="phase.kind" class="ml-2 text-neutral-500">{{ phase.kind }}</span></li></ol></section>
          <section v-if="agents.length" aria-label="Workflow workers" class="mb-3"><h4 class="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Workers</h4><article v-for="agent in agents" :key="agent.index" class="mb-2 rounded border border-white/10 p-2"><div class="flex justify-between gap-3"><span class="font-medium">{{ agent.label }}</span><span class="text-neutral-400">{{ agent.skipped ? 'skipped' : agent.state }}<span v-if="agent.cached"> · cached</span></span></div><div v-if="agent.agentId && agent.controlToken" class="mt-2 flex gap-3"><button type="button" :aria-label="'Restart ' + agent.label" :disabled="pending" class="text-blue-300 disabled:opacity-40" @click="emit('worker', 'retry_worker', { agentId: agent.agentId!, token: agent.controlToken! })">Restart</button><button type="button" :aria-label="'Skip ' + agent.label" :disabled="pending" class="text-neutral-400 disabled:opacity-40" @click="emit('worker', 'skip_worker', { agentId: agent.agentId!, token: agent.controlToken! })">Skip</button></div><p v-if="agent.phaseTitle || agent.model" class="mt-1 text-neutral-500">{{ [agent.phaseTitle, agent.model].filter(Boolean).join(' · ') }}</p><pre v-if="agent.error || agent.resultPreview" class="mt-2 whitespace-pre-wrap font-mono [overflow-wrap:anywhere]" :class="agent.error ? 'text-red-300' : 'text-neutral-300'">{{ agent.error ?? agent.resultPreview }}</pre></article></section>
          <section v-if="logs.length" aria-label="Workflow logs" class="mb-3"><h4 class="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Logs</h4><pre class="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{{ logs.join('\n') }}</pre></section>
          <section v-if="details.workflow?.output !== undefined" aria-label="Workflow result" class="mb-3"><h4 class="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Result</h4><pre class="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{{ details.workflow.output }}</pre></section>
          <p v-if="details.workflow?.outputUnavailable" role="status">Result preview unavailable. Open the native interface to inspect this result.</p><p v-if="details.workflow?.truncated" role="status" class="text-neutral-500">Preview shortened.</p>
          <details class="mb-3 text-neutral-500"><summary>Run identity</summary><dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1"><dt>Task</dt><dd class="m-0 break-all">{{ details.taskId }}</dd><dt>Workflow</dt><dd class="m-0 break-all">{{ details.workflow?.name }}</dd><dt>Run</dt><dd class="m-0 break-all">{{ details.workflow?.runId }}</dd></dl></details>
          <button type="button" :disabled="pending" class="text-[11px] text-neutral-400 hover:text-neutral-200 disabled:opacity-40" @click="emit('inspect')">{{ pending ? 'Refreshing…' : 'Refresh details' }}</button>
        </template>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent, PopoverClose } from 'reka-ui'
import type { ClaudeNativeTaskDetails, ClaudeNativeWorkflowWorkerTarget } from '#features/code/common/native-terminal.ts'
const props = defineProps<{ details?: ClaudeNativeTaskDetails; pending: boolean; status: string; problem?: string }>()
const emit = defineEmits<{ inspect: []; worker: [operation: 'skip_worker' | 'retry_worker', target: ClaudeNativeWorkflowWorkerTarget] }>(), open = ref(false), trigger = ref<HTMLButtonElement | null>(null), previewHeight = ref(448)
function measure() { if (trigger.value) previewHeight.value = Math.max(1, Math.min(448, trigger.value.getBoundingClientRect().top - 20)) }
function escape(event: KeyboardEvent) { if (event.isComposing || event.defaultPrevented) return; event.preventDefault(); event.stopPropagation(); open.value = false }
function opened(value: boolean) { if (value) { measure(); emit('inspect') } }
onMounted(() => { window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true) })
const phases = computed(() => props.details?.workflow?.progress.filter(event => event.type === 'workflow_phase') ?? [])
const agents = computed(() => props.details?.workflow?.progress.filter(event => event.type === 'workflow_agent') ?? [])
const logs = computed(() => props.details?.workflow?.logs.length ? props.details.workflow.logs : props.details?.workflow?.progress.filter(event => event.type === 'workflow_log' && event.message).map(event => event.message!) ?? [])
let timer: ReturnType<typeof setInterval> | undefined
watch([open, () => props.status], ([shown, status]) => { if (timer) clearInterval(timer); timer = shown && status === 'running' ? setInterval(() => { if (!props.pending) emit('inspect') }, 1500) : undefined })
onBeforeUnmount(() => { if (timer) clearInterval(timer); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) })
</script>
