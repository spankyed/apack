<template>
  <div class="max-w-3xl">
    <!-- Root Flow Selection Section -->
    <CollapsibleSection label="Root Flow" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Select which flow should be the root flow for dialog execution
      </p>

      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <label class="text-sm font-medium text-neutral-300 min-w-[120px]">
            Root Flow:
          </label>
          <select
            data-onboarding-id="settings-root-flow"
            v-model="selectedRootFlowId"
            @change="handleRootFlowChange"
            class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
          >
            <option value="">None</option>
            <option
              v-for="flow in flows"
              :key="flow.id"
              :value="flow.id"
            >
              {{ flow.label || flow.id }}
            </option>
          </select>
        </div>

        <!-- Brain Restart Notice -->
        <div v-if="needsRestart && currentRootFlow" class="mt-6 p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
          <div class="flex items-start gap-3">
            <AlertTriangle class="w-5 h-5 text-amber-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-amber-400 mb-1">
                Root flow changed - Brain restart required
              </h4>
              <p class="text-sm text-neutral-400 mb-3">
                The root flow has been updated. Please restart the application from Brain settings to apply the changes.
              </p>
              <button
                @click="goToBrainSettings"
                class="px-3 py-1.5 bg-amber-600/20 text-amber-400 border border-amber-600/30 rounded-lg hover:bg-amber-600/30 hover:border-amber-600/50 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Brain class="w-4 h-4" />
                Go to Brain Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- Flow Preview Section -->
    <CollapsibleSection label="Flow Preview" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Configure how flows are opened when clicking from the list
      </p>

      <div class="space-y-4">
        <label class="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            v-model="enableFlowPreview"
            @change="handleFlowPreviewChange"
            class="w-4 h-4 mt-0.5 rounded border-neutral-700 bg-neutral-800 text-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 transition-all cursor-pointer"
          />
          <div class="flex-1">
            <div class="text-sm font-medium text-neutral-300 group-hover:text-neutral-100 transition-colors">
              Enable flow preview on single click
            </div>
            <div class="text-xs text-neutral-500 mt-0.5">
              When enabled, single-click previews a flow with overlay. Double-click or click overlay to edit. When disabled, single-click opens the editor directly.
            </div>
          </div>
        </label>
      </div>
    </CollapsibleSection>

    <!-- Import Flows Section -->
    <CollapsibleSection label="Import Flows" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Import flows from an exported DSL JSON file
      </p>

      <div class="space-y-4">
        <button
          @click="selectAndImportDSL"
          :disabled="isImporting"
          class="px-4 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm font-medium hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload class="w-4 h-4" />
          {{ isImporting ? 'Importing...' : 'Select DSL File...' }}
        </button>

        <!-- Success message -->
        <div v-if="importStatus === 'success'" class="p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
          <div class="flex items-start gap-3">
            <CheckCircle class="w-5 h-5 text-emerald-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-emerald-400 mb-1">
                Successfully imported {{ importedFlowNames.length }} flow{{ importedFlowNames.length !== 1 ? 's' : '' }}
              </h4>
              <ul v-if="importedFlowNames.length > 0" class="text-sm text-neutral-400 list-disc list-inside">
                <li v-for="name in importedFlowNames" :key="name">{{ name }}</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Error message -->
        <div v-if="importStatus === 'error'" class="p-4 bg-red-900/20 border border-red-700/50 rounded-lg">
          <div class="flex items-start gap-3">
            <XCircle class="w-5 h-5 text-red-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-red-400 mb-1">
                Import failed
              </h4>
              <ul class="text-sm text-neutral-400 list-disc list-inside">
                <li v-for="(error, idx) in applyErrors" :key="idx">{{ error }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- Export Flows Section -->
    <CollapsibleSection label="Export Flows" :default-open="false" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Export all flows to a DSL JSON file
      </p>

      <div class="space-y-4">
        <!-- Directory picker row -->
        <div class="flex items-center gap-2">
          <input
            type="text"
            :value="exportDirectory"
            readonly
            placeholder="Select output directory..."
            class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white text-sm focus:outline-none cursor-default placeholder-neutral-500"
          />
          <button
            @click="selectExportDirectory"
            class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-1.5"
          >
            <FolderOpen class="w-4 h-4" />
            Browse
          </button>
        </div>

        <!-- Export button -->
        <button
          @click="exportFlows"
          :disabled="isExporting || !exportDirectory"
          class="px-4 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm font-medium hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download class="w-4 h-4" />
          {{ isExporting ? 'Exporting...' : 'Export' }}
        </button>

        <!-- Success message -->
        <div v-if="exportStatus === 'success'" class="p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
          <div class="flex items-start gap-3">
            <CheckCircle class="w-5 h-5 text-emerald-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-emerald-400 mb-1">
                Successfully exported {{ exportedFlowCount }} flow{{ exportedFlowCount !== 1 ? 's' : '' }}
              </h4>
              <p class="text-sm text-neutral-400">{{ exportedFilePath }}</p>
              <p v-if="skippedFlows.length > 0" class="text-sm text-amber-400 mt-1">
                Not exported, having no trigger yet: {{ skippedFlows.join(', ') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Error message -->
        <div v-if="exportStatus === 'error'" class="p-4 bg-red-900/20 border border-red-700/50 rounded-lg">
          <div class="flex items-start gap-3">
            <XCircle class="w-5 h-5 text-red-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-red-400 mb-1">
                Export failed
              </h4>
              <ul class="text-sm text-neutral-400 list-disc list-inside">
                <li v-for="(error, idx) in exportErrors" :key="idx">{{ error }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle, Brain, Upload, Download, FolderOpen, CheckCircle, XCircle } from 'lucide-vue-next'
import { useSettingsDraft, useSurface } from '@apackdev/sdk/fe'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'
import { untypedOpenSurface } from '@apackdev/sdk/fe'
import { resolveName } from '@apackdev/sdk/ids'

const HOST_SETTINGS = resolveName('settings', 'host')
import { useSurfaceState } from '#generated/fe.ts'
import { ref, computed, watch } from 'vue'
import { useView } from '#generated/fe.ts'
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'

import { useSelector } from '@xstate/vue'
import { type FlowsState } from './state.ts'
import { ref as featureRef } from '#generated/ref.ts'

interface Props {
  settings?: SettingsOf<'flows'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'flows'>]
}>()

// State
const enableFlowPreview = useSettingsDraft(() => props.settings?.enableFlowPreview ?? true)

// Get flows actor and state via selectors
const flowsActor: FlowsState = useSurface()
// The flows, and the root flow among them (the flow with the root role, not a setting): the list view
const flowList = useView('flows', 'list')
const flows = computed(() => flowList.data?.flows ?? [])
const rootFlowId = computed(() => flowList.data?.rootFlowId)
const selectedRootFlowId = ref<string>(rootFlowId.value || '')
const isImporting = useSelector(flowsActor, (state) => state.context.dslImport.status === 'importing')
const importStatus = useSelector(flowsActor, (state) => state.context.dslImport.status)
const applyErrors = useSelector(flowsActor, (state) => state.context.dslImport.errors)
const importedFlowNames = useSelector(flowsActor, (state) => state.context.dslImport.importedFlowNames)

// Export state
const exportDirectory = ref<string>('')
const isExporting = useSelector(flowsActor, (state) => state.context.dslExport.status === 'exporting')
const exportStatus = useSelector(flowsActor, (state) => state.context.dslExport.status)
const exportErrors = useSelector(flowsActor, (state) => state.context.dslExport.errors)
const exportedFilePath = useSelector(flowsActor, (state) => state.context.dslExport.filePath)
const exportedFlowCount = useSelector(flowsActor, (state) => state.context.dslExport.flowCount)
// A flow with no trigger cannot be written as DSL, so it is named here rather than missing from the file
const skippedFlows = useSelector(flowsActor, (state) => state.context.dslExport.skipped)

const runningRootFlowId = useSurfaceState('brain', (s) => s.runningRootFlowId)

// Check if restart is needed by comparing root flow IDs
const needsRestart = computed(() => {
  const flowsRootId = rootFlowId.value
  const brainRunningId = runningRootFlowId.value

  // Need restart if:
  // 1. Brain is running (not dead/undefined) AND
  // 2. Flows has a root ID AND
  // 3. It's different from what's running
  return brainRunningId !== undefined && flowsRootId && flowsRootId !== brainRunningId
})

const currentRootFlow = computed(() => {
  if (!selectedRootFlowId.value) return null
  return flows.value.find(f => f.id === selectedRootFlowId.value)
})

// Follow the root flow the flows system reports
watch(rootFlowId, (newValue) => {
  selectedRootFlowId.value = newValue || ''
})

// Methods
const handleFlowPreviewChange = () => {
  emit('update-setting', {
    path: ['enableFlowPreview'],
    value: enableFlowPreview.value
  })
}

const handleRootFlowChange = () => {
  flowsActor.send({ type: 'ROOT_FLOW.SET', flowId: selectedRootFlowId.value || null })
}

const goToBrainSettings = () => {
  // Show the brain's settings beside these, in the settings surface
  untypedOpenSurface(HOST_SETTINGS, { type: 'FEATURE.SELECT', featureId: featureRef('brain') })
}

// DSL Import - file picker and emit to state machine
const selectAndImportDSL = async () => {
  // Reset status first
  flowsActor.send({ type: 'DSL.RESET_STATUS' })

  // Open file picker (Electron API is OK in component)
  const filePath = await window.electronAPI?.fileUtils.selectPath({
    type: 'file'
  })

  if (!filePath || Array.isArray(filePath)) return

  // Only accept .json files
  if (!filePath.endsWith('.json')) {
    // For simple validation errors, we can't send to state machine
    // because this happens before we have DSL. Just return silently.
    return
  }

  try {
    // Read file content (Electron API is OK in component)
    const content = await window.electronAPI?.fileUtils.readFile(filePath)
    if (!content) {
      return
    }

    // Parse JSON (simple transform is OK in component)
    let dsl: any
    try {
      dsl = JSON.parse(content)
    } catch {
      return
    }

    // Extract flow names and emit to state machine - state machine handles the rest
    flowsActor.send({
      type: 'DSL.IMPORT',
      dsl,
      flowNames: Object.keys(dsl)
    })
  } catch {
    // Silently fail for file reading errors - no state to update
  }
}

// DSL Export
const selectExportDirectory = async () => {
  const dir = await window.electronAPI?.fileUtils.selectPath({ type: 'directory' })
  if (dir && typeof dir === 'string') exportDirectory.value = dir
}

const exportFlows = () => {
  if (!exportDirectory.value) return
  flowsActor.send({ type: 'DSL.RESET_EXPORT_STATUS' })
  flowsActor.send({ type: 'DSL.EXPORT', directory: exportDirectory.value })
}
</script>
