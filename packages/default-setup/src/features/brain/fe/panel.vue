<template>
  <!-- RunNode Tree Display -->
  <div class="h-full brain-panel bg-neutral-900/50 backdrop-blur-sm">
    <!-- Brain Dead State (no nodes) -->
    <div v-if="brain.data.brainIsDead && (!runNodeTree || runNodeTree.length === 0)" class="flex items-center justify-center h-full">
      <div class="px-6 py-8 text-center">
        <div class="flex items-center justify-center w-12 h-12 mx-auto mb-3 rounded-full bg-neutral-800/50">
          <svg class="w-6 h-6 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636l-12.728 12.728m0-12.728l12.728 12.728" />
          </svg>
        </div>
        <p class="text-sm font-medium text-neutral-400">Brain Stopped</p>
        <p class="mt-1 text-xs text-neutral-500 mb-4">{{ brain.data.startError ?? 'The brain is currently inactive' }}</p>
        <button
          @click="startBrain"
          class="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
        >
          Start Brain
        </button>
      </div>
    </div>
    <!-- Brain Dead State (with stale nodes) -->
    <div v-else-if="brain.data.brainIsDead" class="run-node-tree">
      <div class="px-4 pt-4 pb-3 border-b border-neutral-800 bg-neutral-900/30">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold tracking-wider uppercase text-neutral-500">Run Events</h3>
          <span class="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded bg-neutral-700/50 text-neutral-400">Stopped</span>
        </div>
      </div>
      <div class="flex-1 p-4 opacity-50 pointer-events-none overflow-y-auto run-node-scroll">
        <div class="space-y-1">
          <RunNodeListItem
            v-for="node in displayedNodes"
            :key="node.id"
            :node="node"
            :depth="0"
          />
        </div>
      </div>
    </div>
    <!-- Normal RunNode Tree Display -->
    <div v-else-if="runNodeTree && runNodeTree.length > 0" class="run-node-tree">
      <div class="px-4 pt-4 pb-3 border-b border-neutral-800 bg-neutral-900/30">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold tracking-wider uppercase text-neutral-500">Run Events</h3>
          <span class="text-xs text-neutral-500">
            <template v-if="displayedNodes.length < runNodeTree.length">
              {{ displayedNodes.length }} of {{ runNodeTree.length }} event{{ runNodeTree.length !== 1 ? 's' : '' }}
            </template>
            <template v-else>
              {{ runNodeTree.length }} event{{ runNodeTree.length !== 1 ? 's' : '' }}
            </template>
          </span>
        </div>
      </div>
      <div class="flex-1 p-4 overflow-y-auto run-node-scroll" @scroll="onScroll">
        <div class="space-y-1">
          <RunNodeListItem
            v-for="node in displayedNodes"
            :key="node.id"
            :node="node"
            :depth="0"
            @open-flow="$emit('flow-navigate', $event)"
          />
        </div>
      </div>
    </div>
    <div v-else class="flex items-center justify-center h-full">
      <div class="px-6 py-8 text-center">
        <div class="flex items-center justify-center w-12 h-12 mx-auto mb-3 rounded-full bg-neutral-800/50">
          <svg class="w-6 h-6 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p class="text-sm font-medium text-neutral-400">No event data</p>
        <p class="mt-1 text-xs text-neutral-500">Run a flow to see its events</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState } from '@apackdev/sdk/fe'

import { computed, ref, watch } from 'vue'
import type { BrainState } from '#features/brain/fe/state.ts'
import RunNodeListItem from '@apackdev/ui/components/RunNodeListItem'
import type { RunTree } from '@apackdev/sdk/steps'
import { tell } from '#generated/events.ts'

const { state: brain } = useState<BrainState>();

// Infinite scroll: show 50 items at a time
const PAGE_SIZE = 50;
const displayCount = ref(PAGE_SIZE);

// Reset display count only on flow navigation (not on every RUN_NODE_SPAWNED)
watch(() => brain.value.data.flowRunNodeId, () => {
  displayCount.value = PAGE_SIZE;
});

// Convert normalized tree back to RunTree[] format, reversed (newest first)
const runNodeTree = computed((): RunTree[] => {
  if (!brain.value.data.normalizedTree) return [];

  function buildNode(id: string): RunTree {
    const node = brain.value.data.normalizedTree!.byId[id];
    const childIds = brain.value.data.normalizedTree!.childrenById[id] || [];

    return {
      ...node,
      children: childIds.map(childId => buildNode(childId))
    } as RunTree;
  }

  return brain.value.data.normalizedTree.rootIds.slice().reverse().map(id => buildNode(id));
});

// Paginated slice for display
const displayedNodes = computed(() => {
  return runNodeTree.value.slice(0, displayCount.value);
});

// Infinite scroll handler
const onScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  // Load more when within 100px of the bottom
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    if (displayCount.value < runNodeTree.value.length) {
      displayCount.value = Math.min(displayCount.value + PAGE_SIZE, runNodeTree.value.length);
    }
  }
};

// Start brain method
const startBrain = () => {
  tell('brain', {
    type: 'START_BRAIN',
  });
};

defineEmits<{
  'flow-navigate': [flowId: string];
}>();
</script>

<style lang="scss" scoped>
.brain-panel {
  display: flex;
  flex-direction: column;
}

.run-node-tree {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.run-node-scroll {
  scroll-behavior: smooth;

  /* Custom scrollbar styling */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.1);
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;

    &:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  }
}
</style>