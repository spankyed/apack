<template>
  <div class="max-w-3xl">
    <!-- Brain Status Section -->
    <CollapsibleSection label="Brain Status" :default-open="true" class="mb-8">
      <div class="space-y-4">
        <!-- Brain is Dead/Killed Status -->
        <div v-if="brainIsDead" class="p-4 bg-neutral-800/50 border border-neutral-600/30 rounded-lg">
          <div class="flex items-start gap-3 mb-4">
            <Power class="w-5 h-5 text-neutral-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-neutral-400 mb-1">
                Brain Stopped
              </h4>
              <p class="text-sm text-neutral-500">
                {{ startError ?? 'The brain system is currently inactive. Start it to begin dialog execution.' }}
              </p>
            </div>
          </div>
          
          <div class="mt-4 pt-4 border-t border-neutral-700/30">
            <button 
              @click="handleRestart"
              data-onboarding-id="settings-restart-brain-button"
              class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <PlayCircle class="w-4 h-4" />
              Start Brain
            </button>
          </div>
        </div>

        <!-- Combined Status and Restart Section -->
        <div v-else-if="needsRestart" class="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
          <div class="flex items-start gap-3 mb-4">
            <AlertTriangle class="w-5 h-5 text-amber-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-amber-400 mb-1">
                Root Flow Changed
              </h4>
              <p class="text-sm text-neutral-400">
                Restart the brain to apply the changes and ensure the brain system utilizes the latest flow configuration.
              </p>
            </div>
          </div>
          
          <div class="mt-4 pt-4 border-t border-amber-700/30">
            <div class="flex gap-2">
              <button 
                @click="handleRestart"
                data-onboarding-id="settings-restart-brain-button"
                class="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <RefreshCw class="w-4 h-4" />
                Restart Brain
              </button>
              <button 
                @click="handleKill"
                data-onboarding-id="settings-kill-brain-button"
                class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Power class="w-4 h-4" />
                Kill Brain
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="!brainIsDead" class="p-4 bg-neutral-900/50 rounded-lg border border-neutral-700/50">
          <div class="flex items-start gap-3 mb-3">
            <CheckCircle class="w-5 h-5 text-green-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-green-400 mb-1">
                Brain Running
              </h4>
              <p class="text-sm text-neutral-400">
                The brain system is active and executing the current root flow.
              </p>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-neutral-700/30">
            <p class="text-sm text-neutral-500 mb-3">
              Caution: this will stop everything that's currently running.
            </p>
            <div class="flex gap-2">
              <button 
                @click="handleRestart"
                data-onboarding-id="settings-restart-brain-button"
                class="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <RefreshCw class="w-4 h-4" />
                Restart Brain
              </button>
              <button 
                v-if="!brainIsDead"
                @click="handleKill"
                data-onboarding-id="settings-kill-brain-button"
                class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Power class="w-4 h-4" />
                Kill Brain
              </button>
              <button 
                v-else
                @click="handleRestart"
                class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <PlayCircle class="w-4 h-4" />
                Start Brain
              </button>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- Inspect Mode Section -->
    <CollapsibleSection label="Inspect Mode" :default-open="false" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Enable inspect mode to see detailed brain execution information in the inspection panel
      </p>

      <div class="flex items-center gap-3">
        <label class="text-sm font-medium text-neutral-300 min-w-[120px]">
          Inspect Mode:
        </label>
        <button
          @click="toggleInspect"
          :class="[
            'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            inspectEnabled
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-300 border border-neutral-700/50'
          ]"
        >
          {{ inspectEnabled ? 'Enabled' : 'Disabled' }}
        </button>
      </div>
    </CollapsibleSection>
  </div>
</template>

<script setup lang="ts">
import { RefreshCw, AlertTriangle, Power, CheckCircle, PlayCircle } from 'lucide-vue-next'
import type { SettingsOf } from '#generated/settings-fe.ts'
import { useSurface } from '@apackdev/sdk/fe'
import { ref, computed } from 'vue'
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'

import { sendToSystem } from '#generated/events.ts'
import { useSelector } from '@xstate/vue'
import type { BrainState } from '#features/brain/fe/state.ts'
import { useView } from '#generated/fe.ts'

interface Props {
  settings?: SettingsOf<'brain'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

// Get brain state from brain state machine
const brainActor: BrainState = useSurface();
const brainIsDead = useSelector(brainActor, (state) => state.context.brainIsDead)
const startError = useSelector(brainActor, (state) => state.context.startError)
const runningRootFlowId = useSelector(brainActor, (state) => state.context.runningRootFlowId)
// The root flow is the flows feature's (the flow with the root role), as its list view reads it
const flowList = useView('flows', 'list')
const rootFlowId = computed(() => flowList.data?.rootFlowId)

// Compute if restart is needed by comparing root flow IDs
const needsRestart = computed(() => {
  const flowsRootId = rootFlowId.value
  const brainRunningId = runningRootFlowId.value
  
  // Need restart if:
  // 1. Brain is running (not dead) AND
  // 2. Flows has a root ID AND
  // 3. It's different from what's running
  return brainRunningId !== undefined && flowsRootId && flowsRootId !== brainRunningId
})

// State
const inspectEnabled = ref<boolean>(false)

// Methods
const handleRestart = () => {
  // If brain is dead, send START_BRAIN, otherwise RESTART_BRAIN
  if (brainIsDead.value) {
    sendToSystem('brain', {
      type: 'START_BRAIN',
    })
  } else {
    sendToSystem('brain', {
      type: 'RESTART_BRAIN',
    })
  }
}

const handleKill = () => {
  // Send kill event to backend brain system
  sendToSystem('brain', {
    type: 'KILL_BRAIN',
  })
}

const toggleInspect = () => {
  inspectEnabled.value = !inspectEnabled.value
  // Send toggle inspect event to backend
  sendToSystem('brain', {
    type: 'TOGGLE_INSPECT',
  })
}
</script>