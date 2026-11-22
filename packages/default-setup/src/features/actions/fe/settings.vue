<template>
  <div class="max-w-3xl">
    <!-- Action Categories Section -->
    <CollapsibleSection label="Action Categories" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Organize your actions into categories with custom colors for better workflow management
      </p>
      <div class="space-y-4">
        <div 
          v-for="(category, index) in categories" 
          :key="index"
          class="group"
        >
          <div class="flex items-center gap-3">
            <!-- Color picker -->
            <ColorPicker
              v-model="category.color"
              @change="debouncedSave"
            />
            
            <!-- Category name input -->
            <input
              v-model="category.name"
              type="text"
              placeholder="Category name"
              class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
              @input="debouncedSave"
            />
            
            <!-- Remove button -->
            <button
              @click="removeCategory(index)"
              class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-400 hover:text-red-400 hover:border-red-500/50 transition-all"
              :disabled="categories.length <= 1"
              title="Remove category"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Add category button -->
        <button
          @click="addCategory"
          class="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 transition-all flex items-center gap-1.5"
        >
          <Plus class="w-3.5 h-3.5" />
          Add Category
        </button>
      </div>
    </CollapsibleSection>

    <!-- Import Actions Section -->
    <CollapsibleSection label="Import Actions" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Import actions from an exported JSON file
      </p>

      <div class="space-y-4">
        <button
          @click="selectAndImportActions"
          :disabled="isImporting"
          class="px-4 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm font-medium hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload class="w-4 h-4" />
          {{ isImporting ? 'Importing...' : 'Select JSON File...' }}
        </button>

        <!-- Success message -->
        <div v-if="importStatus === 'success'" class="p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
          <div class="flex items-start gap-3">
            <CheckCircle class="w-5 h-5 text-emerald-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-emerald-400 mb-1">
                Successfully imported {{ importedCount }} action{{ importedCount !== 1 ? 's' : '' }}
              </h4>
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

    <!-- Export Actions Section -->
    <CollapsibleSection label="Export Actions" :default-open="false" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Export all actions to a JSON file
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
          @click="exportActionsToFile"
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
                Successfully exported {{ exportedActionCount }} action{{ exportedActionCount !== 1 ? 's' : '' }}
              </h4>
              <p class="text-sm text-neutral-400">{{ exportedFilePath }}</p>
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
import { Plus, X, Upload, Download, FolderOpen, CheckCircle, XCircle } from 'lucide-vue-next'
import { useSettingsDraft, useState } from '@apackdev/sdk/fe'
import type { ActionsState } from './state.ts'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'

import { computed, ref } from 'vue'

import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'
import ColorPicker from '@apackdev/ui/design/ColorPicker'
import { useDebounce } from '@apackdev/ui/composables/useDebounce'
import type { Category } from '#generated/types.ts'

interface Props {
  settings?: SettingsOf<'actions'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'actions'>]
}>()

const categories = useSettingsDraft(() => props.settings?.categories ?? [])

// Save function
const saveCategories = () => {
  emit('update-setting', {
    path: ['categories'],
    value: categories.value
  })
}

// Use the debounce composable for saving categories
const { debounced: debouncedSave } = useDebounce(() => {
  saveCategories()
}, 500)

// Category management
const addCategory = () => {
  const newCategory: Category = {
    name: '',
    color: '#6B7280' // Default gray color
  }
  categories.value.push(newCategory)
  saveCategories()
}

const removeCategory = (index: number) => {
  if (categories.value.length > 1) {
    categories.value.splice(index, 1)
    saveCategories()
  }
}

// The import and the export are the surface's machine's: it makes each, and holds how the last one ended. What an
// earlier visit to this form left is not shown again
const { state: surface, send } = useState<ActionsState>()
send({ type: 'ACTIONS.FORGET_IMPORT' })
send({ type: 'ACTIONS.FORGET_EXPORT' })

// How the last import ended, shown until another is picked
const imported = computed(() => surface.value.data.imported)
const isImporting = computed(() => surface.value.data.making.importActions)
const importStatus = computed(() => (imported.value === undefined ? 'idle' : imported.value.ok ? 'success' : 'error'))
const applyErrors = computed(() => {
  if (imported.value === undefined) return []
  return imported.value.ok ? imported.value.value.errors ?? [] : imported.value.failure.message.split('\n')
})
const importedCount = computed(() => (imported.value?.ok ? imported.value.value.count : 0))

// How the last export ended, shown until another is made
const exportDirectory = ref<string>('')
const exported = computed(() => surface.value.data.exported)
const isExporting = computed(() => surface.value.data.making.exportActions)
const exportStatus = computed(() => (exported.value === undefined ? 'idle' : exported.value.ok ? 'success' : 'error'))
const exportErrors = computed(() => (exported.value?.ok === false ? [exported.value.failure.message] : []))
const exportedFilePath = computed(() => (exported.value?.ok ? exported.value.value.filePath : ''))
const exportedActionCount = computed(() => (exported.value?.ok ? exported.value.value.actionCount : 0))

// Import - file picker, then the machine's ask
const selectAndImportActions = async () => {
  send({ type: 'ACTIONS.FORGET_IMPORT' })

  const filePath = await window.electronAPI?.fileUtils.selectPath({
    type: 'file'
  })

  if (!filePath || Array.isArray(filePath)) return

  if (!filePath.endsWith('.json')) return

  try {
    const content = await window.electronAPI?.fileUtils.readFile(filePath)
    if (!content) return

    let actions: any
    try {
      actions = JSON.parse(content)
    } catch {
      return
    }

    send({ type: 'ACTIONS.IMPORT', actions })
  } catch {
    // Silently fail for file reading errors
  }
}

// Export
const selectExportDirectory = async () => {
  const dir = await window.electronAPI?.fileUtils.selectPath({ type: 'directory' })
  if (dir && typeof dir === 'string') exportDirectory.value = dir
}

const exportActionsToFile = async () => {
  if (!exportDirectory.value) return
  send({ type: 'ACTIONS.EXPORT', directory: exportDirectory.value })
}
</script>