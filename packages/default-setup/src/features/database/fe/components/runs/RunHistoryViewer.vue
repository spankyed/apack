<template>
  <div class="flex w-full h-full overflow-hidden bg-neutral-850">
    <!-- Flow Selector Panel -->
    <div 
      ref="flowPanel"
      class="relative flex-shrink-0 overflow-hidden border-r shadow-sm bg-neutral-900 border-neutral-800"
      :style="{ width: flowPanelWidth + 'px' }"
    >
      <RunSelector />
      
      <!-- Resize Handle -->
      <div
        class="absolute top-0 right-0 w-1 h-full cursor-col-resize group hover:bg-neutral-600/20"
        @mousedown="startResizeFlow"
      >
        <div class="absolute inset-y-0 right-0 w-4 -mr-2"></div>
      </div>
    </div>
    
    <!-- The selected run -->
    <div class="flex flex-col flex-1 min-w-0">
      <!-- Header -->
      <div class="px-4 py-3 border-b border-neutral-800 bg-neutral-900">
        <div class="flex items-center justify-between">
          <div v-if="database.data.currentFlowId" class="flex items-center gap-2">
            <span class="text-sm text-neutral-400">
              Flow: <span class="font-medium text-neutral-200">{{ currentFlowLabel }}</span>
            </span>
          </div>
          <div v-else class="text-sm text-neutral-500">
            No flow selected
          </div>

          <div class="flex items-center gap-2">
            <button
              @click="refreshFlows"
              :disabled="isLoadingRuns"
              class="p-2 transition-colors rounded-lg hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh runs"
            >
              <RefreshCw
                :class="[
                  'w-4 h-4 text-neutral-400',
                  isLoadingRuns && 'animate-spin'
                ]"
              />
            </button>
          </div>
        </div>
      </div>
      
      <!-- Event List or Empty State -->
      <div class="flex-1 overflow-hidden">
        <RunEventList v-if="database.data.currentFlowId" />
        <div v-else class="flex items-center justify-center h-full">
          <div class="px-6 py-8 text-center">
            <div class="flex items-center justify-center w-12 h-12 mx-auto mb-3 rounded-full bg-neutral-800/50">
              <History class="w-6 h-6 text-neutral-500" />
            </div>
            <p class="text-sm font-medium text-neutral-400">No flow selected</p>
            <p class="mt-1 text-xs text-neutral-500">Select a flow from the left panel to view the events it ran</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref, computed } from 'vue'
import { isLoadingRuns as readingRuns, type DatabaseState } from '../../state.ts'
import { RefreshCw, History } from 'lucide-vue-next'
import RunSelector from './RunSelector.vue'
import RunEventList from './RunEventList.vue'

const databaseActor: DatabaseState = useSurface()

// State selectors
const { state: database, send } = useState(databaseActor)
const isLoadingRuns = computed(() => readingRuns(database.value.data.making))

// Computed properties
const currentFlowLabel = computed(() => {
  if (!database.value.data.currentFlowId) return null
  const flow = database.value.data.flowRuns.find(f => f.id === database.value.data.currentFlowId)
  return flow?.label || 'Unknown Flow'
})

// Panel sizing
const flowPanelWidth = ref(280)
const minFlowPanelWidth = 200
const maxFlowPanelWidth = 400

// Resize functionality
let isResizingFlow = false
let startX = 0
let startWidth = 0

function startResizeFlow(e: MouseEvent) {
  isResizingFlow = true
  startX = e.clientX
  startWidth = flowPanelWidth.value
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function handleMouseMove(e: MouseEvent) {
  if (isResizingFlow) {
    const diff = e.clientX - startX
    const newWidth = Math.max(minFlowPanelWidth, Math.min(maxFlowPanelWidth, startWidth + diff))
    flowPanelWidth.value = newWidth
  }
}

function handleMouseUp() {
  isResizingFlow = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// Actions
function refreshFlows() {
  send({ type: 'RUNS.REQUEST_FLOWS' })
}
</script>