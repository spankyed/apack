<template>
  <div class="flex flex-col h-full bg-neutral-900/50 backdrop-blur-sm">
    <!-- Event List -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="database.data.flowEvents.length === 0 && !isLoadingRuns" class="flex flex-col items-center justify-center h-full px-4 text-center">
        <div class="flex items-center justify-center w-12 h-12 mb-3 rounded-lg bg-neutral-800/30">
          <svg class="w-6 h-6 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p class="text-sm text-neutral-400">No events in this flow</p>
      </div>
      
      <div v-else class="p-4">
        <div class="space-y-1">
          <RunNodeListItem
            v-for="event in database.data.flowEvents"
            :key="event.id"
            :node="event"
            :node-details="database.data.nodeDetails.get(event.id)"
            :node-details-map="database.data.nodeDetails"
            :depth="0"
            @toggle="toggleNode"
            @request-details="requestNodeDetails"
            @open-flow="openFlow"
          />
        </div>
        
        <!-- Load More Button -->
        <div v-if="database.data.runPagination.hasMore" class="flex justify-center mt-4">
          <button
            @click="loadMore"
            :disabled="isLoadingRuns"
            class="px-4 py-2 text-sm font-medium text-blue-400 bg-blue-900/20 hover:bg-blue-900/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Loader2 v-if="isLoadingRuns" class="w-4 h-4 animate-spin" />
            <span>{{ isLoadingRuns ? 'Loading...' : 'Load More Events' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { computed } from 'vue'
import { isLoadingRuns as readingRuns, type DatabaseState } from '../../state.ts'
import { Loader2 } from 'lucide-vue-next'
import RunNodeListItem from '@apackdev/ui/components/RunNodeListItem'

const databaseActor: DatabaseState = useSurface()

// State selectors
const { state: database, send } = useState(databaseActor)
const isLoadingRuns = computed(() => readingRuns(database.value.data.making))

// Actions
function toggleNode(nodeId: string) {
  send({ type: 'RUNS.EXPAND_NODE', nodeId })
}

function requestNodeDetails(nodeId: string) {
  // Request node details if not already loaded
  if (!database.value.data.nodeDetails.has(nodeId)) {
    send({ type: 'RUNS.EXPAND_NODE', nodeId })
  }
}

function loadMore() {
  send({ type: 'RUNS.LOAD_MORE' })
}

function openFlow(flowId: string) {
  // Send event to select the flow that was double-clicked
  send({ type: 'RUNS.SELECT_FLOW', flowId })
}
</script>