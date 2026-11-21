<template>
  <div
    class="run-node-item"
    :class="{ 'has-children': hasChildren(node) }"
  >
    <div
      class="relative w-full overflow-hidden run-node-container group"
      :class="[itemClasses, isExpanded && (hasChildren(node) || hasDetails) ? 'expanded' : '']"
    >
      <!-- Clickable header area -->
      <button
        class="relative w-full run-node-header"
        :class="[glowClasses]"
        @click="handleClick"
        @dblclick="handleDoubleClick"
      >
        <!-- Main content -->
        <div class="relative z-10 flex items-center gap-2 px-3 py-2.5">
          <!-- Expand/Collapse icon -->
          <ChevronRight
            v-if="hasChildren(node) || hasDetails"
            :class="['w-3.5 h-3.5 text-neutral-500 transition-all flex-shrink-0',
                     { 'rotate-90': isExpanded, 'text-neutral-300': isExpanded }]"
          />

          <!-- Icon dot with enhanced styling -->
          <div
            class="w-1.5 h-1.5 rounded-full flex-shrink-0 ring-1 ring-offset-1 ring-offset-neutral-900/50 transition-all duration-200"
            :class="iconDotClasses"
          />

          <!-- Node label with context -->
          <div class="flex-1 min-w-0 text-left relative pr-16">
            <span class="text-xs font-medium tracking-tight truncate transition-colors duration-200 text-white/90 group-hover:text-white block">
              {{ node.label || getNodeTypeLabel() }}
            </span>
            <!-- Timestamp positioned absolutely -->
            <span v-if="node.startedAt" class="text-[10px] text-neutral-500 absolute right-0 top-1/2 -translate-y-1/2">
              {{ formatTimestamp(node.startedAt) }}
            </span>
          </div>

          <!-- Node type icon -->
          <component
            v-if="nodeIcon"
            :is="nodeIcon"
            class="w-3.5 h-3.5 transition-all duration-200"
            :class="iconComponentClasses"
          />

          <!-- Status indicator with better sizing -->
          <div
            v-if="node.status"
            class="relative flex items-center ml-1"
          >
            <div
              :class="[
                'rounded-full transition-all',
                depth === 0 ? 'w-1.5 h-1.5 ring-2 ring-offset-2 ring-offset-neutral-900' : 'w-1 h-1 ring-1 ring-offset-1 ring-offset-neutral-900',
                statusClasses,
                statusRingClasses
              ]"
            />
          </div>
        </div>
      </button>

      <!-- Inline Details Section (when expanded) -->
      <div v-if="isExpanded && hasDetails" class="run-node-details">
        <div class="mx-3 mb-3 px-4 py-3 bg-neutral-900/80 rounded-b-lg border-t border-neutral-800/50">
          <!-- Node Attributes (lazy loaded or from node itself) -->
          <div v-if="recordedDetails && Object.keys(recordedDetails).length > 0" class="mb-3">
            <div class="text-xs font-medium text-neutral-400 mb-2">Node Attributes</div>
            <DataRenderer :data="recordedDetails" :default-expanded="false" :compact="true" />
          </div>

          <!-- All info inline at the bottom with responsive breakpoints -->
          <div class="flex flex-wrap items-start gap-2 text-xs overflow-hidden"
               :class="recordedDetails && Object.keys(recordedDetails).length > 0 ? 'pt-3 border-t border-neutral-800/30' : ''">
            <!-- Left side: Step/Event/Flow Type and Entity ID -->
            <div class="flex items-center gap-x-3 min-w-[150px] mr-auto">
              <!-- Step/Event/Flow Type -->
              <span v-if="node.kind === 'flow'" class="text-purple-400 font-medium flex-shrink-0">
                flow
              </span>
              <span v-else-if="node.kind === 'step' && node.stepNodeType" class="text-blue-400 font-medium flex-shrink-0">
                {{ node.stepNodeType }}
              </span>
              <span v-else-if="node.kind === 'event' && node.eventType" class="text-purple-400 font-medium flex-shrink-0">
                {{ node.eventType }}
              </span>

              <!-- Entity ID with proper truncation -->
              <span class="text-neutral-400 font-mono truncate">{{ node.id }}</span>
            </div>

            <!-- Right side: Timing (wraps when needed) -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 flex-shrink-0">
              <div v-if="node.startedAt" class="flex items-center gap-1 whitespace-nowrap">
                <span class="text-neutral-500">Started:</span>
                <span class="text-neutral-300">{{ formatTimestamp(node.startedAt) }}</span>
              </div>

              <div v-if="node.completedAt" class="flex items-center gap-1 whitespace-nowrap">
                <span class="text-neutral-500">Completed:</span>
                <span class="text-neutral-300">{{ formatTimestamp(node.completedAt) }}</span>
              </div>

              <div v-if="node.startedAt && node.completedAt" class="flex items-center gap-1 whitespace-nowrap">
                <span class="text-neutral-500">Duration:</span>
                <span class="text-green-400 font-medium">{{ formatDuration(node.startedAt, node.completedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Children nested inside parent container -->
      <div v-if="isExpanded && hasChildren(node)" class="run-node-children">
        <RunNodeListItem
          v-for="child in (node as RunTree).children"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
          :node-details="nodeDetailsMap?.get(child.id)"
          @toggle="(nodeId) => $emit('toggle', nodeId)"
          @request-details="(nodeId) => $emit('request-details', nodeId)"
          @open-flow="(flowId) => $emit('open-flow', flowId)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ChevronRight } from 'lucide-vue-next';
import type { RunTree, RunNode } from '@apackdev/sdk/steps';
import DataRenderer from './DataRenderer.vue';
import { useNodeStyles } from './node-styles.ts'

const { getNodeConfig, getInspectionItemClasses, getPaletteIconClasses, getPaletteIconComponentClasses, getPaletteGlowClasses, getNodeStatusClasses } = useNodeStyles()

interface Props {
  node: RunNode | RunTree;
  depth?: number;
  nodeDetails?: RunNode;
  nodeDetailsMap?: ReadonlyMap<string, RunNode>;
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0
});

const emit = defineEmits<{
  'toggle': [nodeId: string];
  'request-details': [nodeId: string];
  'open-flow': [runNodeId: string];
}>();

const isExpanded = ref(false);

const hasChildren = (node: RunNode | RunTree): node is RunTree => {
  return 'children' in node && Array.isArray(node.children) && node.children.length > 0;
};

const hasDetails = computed(() => ['flow', 'step', 'event'].includes(props.node.kind));

/** What a node recorded of what it was given: an event's payload, a flow's or a step's input */
const recordedOf = (node: RunNode) => (node.kind === 'event' ? node.payload : node.input);

// What the node ran with, and what it returned beside it
const recordedDetails = computed(() => {
  const node = props.nodeDetails ?? props.node;
  const recorded = recordedOf(node);
  if (node.result === undefined) return recorded;
  return recorded !== null && typeof recorded === 'object' ? { ...recorded, result: node.result } : { input: recorded, result: node.result };
});

const effectiveNodeType = computed((): string => {
  if (!props.node) return 'neutral';

  if (props.node.kind === 'step' && props.node.stepNodeType) {
    return props.node.stepNodeType;
  }

  switch (props.node.kind) {
    case 'flow': return 'flow';
    case 'event': return 'listener';
    default: return 'action';
  }
});

const nodeIcon = computed(() => {
  const config = getNodeConfig(effectiveNodeType.value);
  return config?.icon || getNodeConfig('action')?.icon;
});

const itemClasses = computed(() => getInspectionItemClasses(effectiveNodeType.value));
const glowClasses = computed(() => getPaletteGlowClasses(effectiveNodeType.value));
const iconDotClasses = computed(() => getPaletteIconClasses(effectiveNodeType.value));
const iconComponentClasses = computed(() => getPaletteIconComponentClasses(effectiveNodeType.value));

const statusClasses = computed(() => {
  const baseClasses = getNodeStatusClasses(props.node?.status || '', 'simple');

  if (props.node?.status === 'active') {
    return `${baseClasses} animate-pulse`;
  }

  return baseClasses;
});

const statusRingClasses = computed(() => {
  switch (props.node?.status) {
    case 'active': return 'ring-green-400/30';
    case 'stopped': return 'ring-yellow-400/30';
    case 'completed': return 'ring-blue-400/30';
    case 'failed': return 'ring-red-400/30';
    default: return 'ring-neutral-400/30';
  }
});

function getNodeTypeLabel(): string {
  if (props.node.kind === 'flow') return 'Flow Node';
  if (props.node.kind === 'event') return props.node.eventType || 'Event';
  if (props.node.kind === 'step') return props.node.stepNodeType || 'Step';
  return 'Unknown Node';
}

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

function formatDuration(start: number, end: number): string {
  const duration = end - start;

  if (duration < 1000) {
    return `${duration}ms`;
  } else if (duration < 60000) {
    return `${(duration / 1000).toFixed(2)}s`;
  } else if (duration < 3600000) {
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  } else {
    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}

const handleClick = () => {
  if (hasChildren(props.node) || hasDetails.value) {
    isExpanded.value = !isExpanded.value;

    if (isExpanded.value && hasDetails.value && !props.nodeDetails && recordedOf(props.node) === undefined) {
      emit('request-details', props.node.id);
    }

    emit('toggle', props.node.id);
  }
};

const handleDoubleClick = () => {
  if (props.node.stepNodeType === 'flow') {
    emit('open-flow', props.node.id);
  }
};
</script>

<style scoped>
.run-node-item {
  user-select: none;
  margin-bottom: 0.25rem;
  width: 100%;
}

.run-node-container {
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  transition: border-color 0.2s ease, background-color 0.2s ease;

  &.expanded {
    background: rgba(255, 255, 255, 0.025);
    border-color: rgba(255, 255, 255, 0.04);
  }
}

.run-node-header {
  transform-origin: center;
  position: relative;
  text-align: left;
  width: 100%;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: filter 0.15s ease, opacity 0.15s ease;
  border-radius: 0.375rem;
}

.run-node-header:hover {
  filter: brightness(1.2);
}

.expanded .run-node-header {
  border-radius: 0.375rem 0.375rem 0 0;
}

.expanded .run-node-header:hover {
  filter: brightness(1.15);
}

.run-node-header * {
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}

.run-node-children {
  position: relative;
  padding: 0.5rem 0.75rem;
  animation: slideIn 0.15s ease-out;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.run-node-children .run-node-item:last-child {
  margin-bottom: 0;
}

.run-node-children .run-node-item {
  max-width: 100%;
}

.run-node-details {
  animation: slideIn 0.15s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.run-node-item:has(.run-node-item .run-node-item .run-node-item) .run-node-header {
  font-size: 0.6875rem;
}

.run-node-item.has-children .run-node-container {
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}
</style>
