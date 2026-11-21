<template>
  <div class="relative flex h-full overflow-hidden bg-neutral-900">
    <!-- Left Panel: Watched Events (Optional) -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="-translate-x-full opacity-0"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="translate-x-0 opacity-100"
      leave-to-class="-translate-x-full opacity-0"
    >
      <div v-if="brain.data.showLeftPanel" class="flex flex-col border-r w-72 border-neutral-800/50 bg-neutral-900">
        <div class="px-5 py-3.5 border-b border-neutral-800/50 bg-neutral-900/30">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-semibold tracking-wider uppercase text-neutral-500">Watched Events</h3>
            <span v-if="brain.data.possibleEvents && brain.data.possibleEvents.length > 0" class="text-xs text-neutral-500">
              {{ brain.data.possibleEvents.length }} event{{ brain.data.possibleEvents.length !== 1 ? 's' : '' }}
            </span>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto">
          <EventsList
            :events="brain.data.possibleEvents"
            :pulsing-event-type="brain.data.pulsingEventType"
            @event-click="handleEventClick"
          />
        </div>
      </div>
    </Transition>

    <!-- Paused Banner -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="-translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-full opacity-0"
    >
      <div v-if="brain.data.brainIsPaused" class="absolute top-0 left-0 right-0 z-10 flex items-center justify-center gap-3 px-4 py-1.5 bg-amber-900/80 border-b border-amber-700/50 text-amber-200 text-xs">
        <span>Brain Paused — Events Queued</span>
        <button
          class="px-2 py-0.5 text-xs font-medium rounded bg-amber-700/60 hover:bg-amber-600/60 text-amber-100 transition-colors"
          @click.stop="handleResume"
        >
          Resume
        </button>
      </div>
    </Transition>

    <!-- Runtime Error Banner -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="-translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-full opacity-0"
    >
      <div
        v-if="brain.data.latestRuntimeError"
        :class="[
          'absolute left-0 right-0 z-20 flex items-center justify-between gap-3 border-b border-red-700/50 bg-red-950/90 px-4 py-2 text-xs text-red-100',
          brain.data.brainIsPaused ? 'top-8' : 'top-0'
        ]"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold">Brain runtime error</span>
            <span v-if="brain.data.latestRuntimeError.nodeLabel || brain.data.latestRuntimeError.actionLabel" class="truncate text-red-200/80">
              {{ brain.data.latestRuntimeError.nodeLabel || brain.data.latestRuntimeError.actionLabel }}
            </span>
          </div>
          <div class="truncate text-red-100/80">
            {{ brain.data.latestRuntimeError.message }}
          </div>
        </div>
        <button
          class="shrink-0 rounded px-2 py-1 text-red-100/80 transition-colors hover:bg-red-900/70 hover:text-white"
          @click.stop="handleDismissRuntimeError"
        >
          Dismiss
        </button>
      </div>
    </Transition>

    <!-- Center: RunNode Graph (Always visible) -->
    <div class="relative flex-1 overflow-hidden bg-neutral-900" @click="handleCanvasClick">
      <RunNodeGraph
        :run-node-tree="brain.data.runNodeTree"
        :flow-run-node-id="brain.data.flowRunNodeId"
        :can-go-back="canGoBack"
        :animations-enabled="brain.data.animationsEnabled"
        :selected-node-id="brain.data.selectedStepNode?.id"
        @node-click="handleNodeClick"
        @flow-navigate="handleFlowNavigate"
        @back-click="handleBackClick"
      />

      <!-- Brain Stopped Overlay -->
      <div v-if="brain.data.brainIsDead && brain.data.runNodeTree && brain.data.runNodeTree.length" class="absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/60 backdrop-blur-[1px]">
        <div class="text-center">
          <div class="flex items-center justify-center w-14 h-14 mx-auto mb-4 rounded-full bg-neutral-800/80 border border-neutral-700/50">
            <svg class="w-7 h-7 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636l-12.728 12.728m0-12.728l12.728 12.728" />
            </svg>
          </div>
          <p class="text-sm font-medium text-neutral-300">Brain Stopped</p>
          <p class="mt-1 text-xs text-neutral-500">This is the last known state</p>
          <button
            class="mt-4 px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
            @click.stop="handleStart"
          >
            Start Brain
          </button>
        </div>
      </div>
    </div>

    <!-- Step Node Details Panel (Slide-out) -->
    <StepNodeDetails
      :node="brain.data.selectedStepNode"
      @close="handleCloseDetails"
    />
  </div>
</template>

<script setup lang="ts">
import { useState } from '@apackdev/sdk/fe'

import { computed, onMounted, onUnmounted } from 'vue'
import { type BrainState } from '#features/brain/fe/state.ts';
import RunNodeGraph from './components/RunNodeGraph.vue';
import EventsList from './components/EventsList.vue';
import StepNodeDetails from './components/StepNodeDetails.vue';
import { tell } from '#generated/events.ts';

const { state: brain, send } = useState<BrainState>();

// Selectors for state
const canGoBack = computed(() => (brain.value.data.flowHierarchy?.length ?? 0) > 1);

// UI state selectors

// Event handlers
const handleNodeClick = (nodeId: string) => {
  if (brain.value.data.brainIsDead) return;
  send({ type: 'NODE.CLICK', nodeId });
};

const handleFlowNavigate = (runNodeId: string) => {
  if (brain.value.data.brainIsDead) return;
  send({ type: 'FLOW.NAVIGATE', runNodeId });
};

const handleBackClick = () => {
  if (brain.value.data.brainIsDead) return;
  send({ type: 'BACK.CLICK' });
};

const handleStart = () => {
  tell('brain', {
    type: 'START_BRAIN',
  });
};

const handleEventClick = (eventType: string) => {
  send({ type: 'EVENT.CLICK', eventType });
};

const handleCloseDetails = () => {
  send({ type: 'CLOSE_DETAILS' });
};

const handleResume = () => {
  send({ type: 'RESUME_BRAIN' });
};

const handleDismissRuntimeError = () => {
  send({ type: 'DISMISS_RUNTIME_ERROR' });
};

const handleCanvasClick = (event: MouseEvent) => {
  // Only close if we have a selected node and the click is directly on the canvas
  // The StepNodeDetails panel has @click.stop to prevent propagation
  if (brain.value.data.selectedStepNode) {
    handleCloseDetails();
  }
};

// Keyboard shortcuts
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && brain.value.data.selectedStepNode) {
    handleCloseDetails();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>
