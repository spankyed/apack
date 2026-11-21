<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="translate-x-full opacity-0"
    enter-to-class="translate-x-0 opacity-100"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="translate-x-0 opacity-100"
    leave-to-class="translate-x-full opacity-0"
  >
    <div
      v-if="node"
      data-onboarding-id="brain-step-details"
      class="absolute inset-y-0 right-0 z-20 flex w-96 flex-col border-l border-neutral-800/50 bg-neutral-900 shadow-2xl"
      @click.stop
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-neutral-800/50 px-4 py-3">
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-neutral-100 truncate flex-shrink" :title="node.label">{{ node.label }}</h3>
          <span :class="statusClasses" class="text-xs flex-shrink-0">
            {{ node.status }}
          </span>
          <span v-if="node.stepNodeType" class="text-xs text-neutral-400 flex-shrink-0">
            {{ node.stepNodeType }}
          </span>
          <span v-if="node.eventType" class="text-xs text-neutral-400 flex-shrink-0 font-mono">
            {{ node.eventType }}
          </span>
        </div>
        <button
          @click="$emit('close')"
          class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors flex-shrink-0"
          aria-label="Close details"
        >
          <X :size="18" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex flex-1 flex-col overflow-y-auto">
        <!-- Main content area with flex-1 to take available space -->
        <div class="flex-1 p-4">
          <!-- Runtime Error -->
          <section v-if="runtimeError" class="mb-4">
            <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-red-300">
              Runtime Error
            </h4>
            <div class="rounded border border-red-800/60 bg-red-950/30 p-3">
              <div class="text-sm text-red-100">{{ runtimeError.message }}</div>
              <div v-if="runtimeError.source || runtimeError.phase" class="mt-2 flex gap-2 text-[11px] text-red-200/70">
                <span v-if="runtimeError.source">{{ runtimeError.source }}</span>
                <span v-if="runtimeError.phase">{{ runtimeError.phase }}</span>
              </div>
            </div>
          </section>

          <!-- Input Parameters -->
          <section v-if="hasInputParams" class="mb-4">
            <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Input Parameters
            </h4>
            <div class="rounded bg-black/30 border border-white/5 p-3">
              <DataRenderer :data="inputParams" :default-expanded="true" />
            </div>
          </section>

          <!-- Output Result -->
          <section v-if="hasOutput" class="mb-4">
            <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Output Result
            </h4>
            <div class="rounded bg-black/30 border border-white/5 p-3">
              <DataRenderer :data="outputResult" :default-expanded="true" />
            </div>
          </section>

          <!-- Empty state for pending/active nodes -->
          <div v-if="!hasContent && !node.startedAt" class="mt-8 text-center">
            <div class="text-sm text-neutral-500">
              {{ node.status === 'active' ? 'Step is currently executing...' : 'No additional details available' }}
            </div>
          </div>
        </div>

        <!-- View Blueprint Button (positioned above Execution Info) -->
        <div v-if="node.revealIn" class="flex justify-end px-2 pb-2">
          <button
            @click="openBlueprint"
            class="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-400 transition-colors rounded hover:bg-neutral-700/50 hover:text-blue-300"
            title="View action details"
          >
            <ExternalLink class="w-3 h-3" />
            Edit step
          </button>
        </div>

        <!-- Execution Info (sticky at bottom) -->
        <section v-if="node.startedAt || duration" class="border-t border-neutral-800/50 bg-neutral-900/50 px-4 py-3">
          <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Execution Info
          </h4>
          <div class="flex items-baseline gap-4 text-xs">
            <div v-if="node.startedAt" class="flex items-baseline gap-2">
              <span class="text-neutral-500">Started:</span>
              <span class="text-neutral-300">{{ formatTimestamp(node.startedAt) }}</span>
            </div>
            <div v-if="duration" class="flex items-baseline gap-2">
              <span class="text-neutral-500">Duration:</span>
              <span class="text-neutral-300">{{ duration }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { X, ExternalLink } from 'lucide-vue-next';
import type { RunNode } from '@apackdev/sdk/steps';
import type { EARS } from '@apackdev/sdk';
type EntityId = EARS.EntityId;
import DataRenderer from '@apackdev/ui/components/DataRenderer';
import { openSurface } from '#generated/fe.ts';

interface Props {
  /** The run node, with where its blueprint is when it has one (the brain's answer to GET_RUN_NODE_DETAILS) */
  node?: RunNode & { revealIn?: { flowId: EntityId; nodeId: EntityId } };
}

const props = defineProps<Props>();
const emit = defineEmits<{
  close: [];
}>();

const openBlueprint = () => {
  const revealIn = props.node?.revealIn;
  if (!revealIn) return;
  openSurface('flows', { type: 'NODE.REVEAL', flowId: revealIn.flowId, nodeId: revealIn.nodeId });
  emit('close');
};

const statusClasses = computed(() => {
  switch (props.node?.status) {
    case 'active':
      return 'text-emerald-400';
    case 'completed':
      return 'text-blue-400';
    case 'failed':
      return 'text-red-400';
    case 'stopped':
      return 'text-yellow-400';
    default:
      return 'text-neutral-400';
  }
});

// What the node was given, as recorded — an event's payload, a flow's or a step's input; what it returned is its
// own field, shown in the output section
const inputParams = computed(() => {
  const recorded = props.node?.kind === 'event' ? props.node.payload : props.node?.input;
  if (recorded === undefined || recorded === null) return {};
  return typeof recorded === 'object' ? recorded : { payload: recorded };
});

const outputResult = computed(() => props.node?.result);

const runtimeError = computed(() => {
  const result = outputResult.value as any;
  return result?.error && typeof result.error === 'object' ? result.error : undefined;
});

const hasInputParams = computed(() => Object.keys(inputParams.value).length > 0);
const hasOutput = computed(() => outputResult.value !== undefined);

const hasContent = computed(() => {
  return hasInputParams.value || hasOutput.value;
});

const duration = computed(() => {
  if (!props.node?.startedAt) return null;
  const start = props.node.startedAt;
  
  // Use completedAt for completed nodes, otherwise use current time
  const end = props.node?.completedAt || Date.now();
  const ms = end - start;
  
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
});

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
</script>
