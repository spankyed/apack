<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="px-3 py-3 border-b border-neutral-800">
      <button
        @click="exitRunView"
        class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors w-full"
      >
        <ArrowLeft class="w-4 h-4" />
        Back to Database
      </button>
    </div>
    
    <!-- Flow List -->
    <div class="flex-1 p-2 overflow-y-auto">
      <div v-if="database.data.flowRuns.length === 0 && !isLoadingRuns" class="px-4 py-8 text-center">
        <p class="text-xs text-neutral-500">No flow runs yet</p>
        <p class="mt-1 text-xs text-neutral-600">Run a flow to see it here</p>
      </div>
      
      <div v-else-if="isLoadingRuns && database.data.flowRuns.length === 0" class="px-4 py-8 text-center">
        <div class="inline-flex items-center justify-center w-8 h-8 mb-2">
          <Loader2 class="w-5 h-5 animate-spin text-neutral-500" />
        </div>
        <p class="text-xs text-neutral-500">Loading flows...</p>
      </div>
      
      <div v-else class="space-y-1">
        <div
          v-for="flow in database.data.flowRuns"
          :key="flow.id"
          :class="[
            'group px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150',
            database.data.currentFlowId === flow.id
              ? 'bg-blue-900/30 text-blue-300 border border-blue-800/50'
              : 'hover:bg-neutral-800/50 text-neutral-400'
          ]"
          @click="selectFlow(flow.id)"
          :title="'Click to view events'"
        >
          <!-- Flow header -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 min-w-0">
              <GitBranch 
                :class="[
                  'w-3.5 h-3.5 flex-shrink-0',
                  database.data.currentFlowId === flow.id ? 'text-blue-400' : 'text-neutral-500'
                ]" 
              />
              <span class="text-sm font-medium truncate">
                {{ flow.label || 'Unnamed Flow' }}
              </span>
            </div>
            <StatusIndicator :status="flow.status" />
          </div>
          
          <!-- Flow metadata -->
          <div class="flex items-center gap-3 mt-1.5 text-xs">
            <span class="text-neutral-600">
              {{ formatTimestamp(flow.startedAt) }}
            </span>
            <span v-if="flow.completedAt" class="text-neutral-600">
              {{ formatDuration(flow.startedAt, flow.completedAt) }}
            </span>
          </div>
          
          <!-- Flow ID (shown on hover) -->
          <div 
            class="mt-1 text-xs transition-opacity duration-200 opacity-0 group-hover:opacity-100 text-neutral-600"
          >
            {{ flow.id }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { computed } from 'vue'
import { isLoadingRuns as readingRuns, type DatabaseState } from '../../state.ts'
import { GitBranch, Loader2, ArrowLeft } from 'lucide-vue-next'
import type { RunStatus } from '@apackdev/sdk/steps'

const databaseActor: DatabaseState = useSurface()

// State selectors
const { state: database, send } = useState(databaseActor)
const isLoadingRuns = computed(() => readingRuns(database.value.data.making))

// Actions
function selectFlow(flowId: string) {
  send({ type: 'RUNS.SELECT_FLOW', flowId })
}

function exitRunView() {
  send({ type: 'VIEW_MODE.TOGGLE' })
}

// Formatting helpers
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // If today, show time
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
  }
  
  // If within 7 days, show day of week
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }
  
  // Otherwise show date
  return date.toLocaleDateString('en-US', { 
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function formatDuration(start: number, end: number): string {
  const duration = end - start
  
  if (duration < 1000) {
    return `${duration}ms`
  } else if (duration < 60000) {
    return `${(duration / 1000).toFixed(1)}s`
  } else if (duration < 3600000) {
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`
  } else {
    return `${Math.floor(duration / 3600000)}h ${Math.floor((duration % 3600000) / 60000)}m`
  }
}
</script>

<script lang="ts">
// Status Indicator Component (inline for simplicity)
import { defineComponent, h } from 'vue'

export const StatusIndicator = defineComponent({
  props: {
    status: {
      type: String as () => RunStatus,
      required: true
    }
  },
  setup(props) {
    const statusConfig = {
      active: { color: 'bg-yellow-500', pulse: true },
      stopped: { color: 'bg-gray-500', pulse: false },
      completed: { color: 'bg-green-500', pulse: false },
      failed: { color: 'bg-red-500', pulse: false },
    }
    
    const config = statusConfig[props.status] || statusConfig.completed
    
    return () => h('div', {
      class: 'relative flex items-center'
    }, [
      config.pulse && h('div', {
        class: `absolute w-2 h-2 rounded-full ${config.color} animate-ping opacity-75`
      }),
      h('div', {
        class: `relative w-2 h-2 rounded-full ${config.color}`
      })
    ])
  }
})
</script>