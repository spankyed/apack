<template>
  <div class="max-w-3xl">
    <!-- Tags Management Section -->
    <CollapsibleSection label="Document Tags" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Manage the tags available for organizing documents
      </p>
      <div class="space-y-3">
        <div
          v-for="(tag, index) in tags"
          :key="`tag-${index}`"
          class="group flex items-center gap-3"
        >
          <ColorPicker
            v-model="tag.color"
            @change="saveTags"
          />

          <!-- Tag Name -->
          <input
            v-model="tag.name"
            type="text"
            placeholder="Tag name"
            class="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white placeholder-neutral-600 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
            @input="debouncedSave"
          />

          <!-- Remove Button -->
          <button
            @click="removeTag(index)"
            class="px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-400 hover:text-red-400 hover:border-red-500/50 transition-all"
            :disabled="tags.length <= 1"
            title="Remove tag"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Add Tag Button -->
        <button
          @click="addTag"
          class="px-3 py-1.5 text-sm text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/50 transition-all flex items-center gap-1.5"
        >
          <Plus class="w-3.5 h-3.5" />
          Add Tag
        </button>
      </div>
    </CollapsibleSection>

    <!-- Import Library Section -->
    <CollapsibleSection label="Import Library" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Import library items from an export folder
      </p>

      <div class="space-y-4">
        <button
          @click="selectAndImportLibrary"
          :disabled="isImporting"
          class="px-4 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-neutral-300 text-sm font-medium hover:bg-neutral-700 hover:border-neutral-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload class="w-4 h-4" />
          {{ isImporting ? 'Importing...' : 'Select Export Folder...' }}
        </button>

        <!-- Success message -->
        <div v-if="importStatus === 'success'" class="p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-lg">
          <div class="flex items-start gap-3">
            <CheckCircle class="w-5 h-5 text-emerald-500 mt-0.5" />
            <div class="flex-1">
              <h4 class="text-sm font-medium text-emerald-400 mb-1">
                Successfully imported {{ importedCount }} item{{ importedCount !== 1 ? 's' : '' }}
              </h4>
              <ul v-if="applyErrors.length" class="text-sm text-neutral-400 list-disc list-inside">
                <li v-for="(error, idx) in applyErrors" :key="idx">{{ error }}</li>
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

    <!-- Export Library Section -->
    <CollapsibleSection label="Export Library" :default-open="false" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        {{ exportFormat === 'markdown'
          ? 'Export library as flat markdown files with a media/ folder'
          : 'Export all library items to a JSON file (full-fidelity round-trip)'
        }}
      </p>

      <div class="space-y-4">
        <!-- Format toggle -->
        <div class="flex items-center gap-1 p-1 bg-neutral-800 rounded-lg w-fit">
          <button
            @click="exportFormat = 'markdown'"
            :class="[
              'px-3 py-1.5 text-sm rounded-md transition-all',
              exportFormat === 'markdown'
                ? 'bg-neutral-700 text-white font-medium'
                : 'text-neutral-400 hover:text-neutral-300'
            ]"
          >
            Markdown
          </button>
          <button
            @click="exportFormat = 'json'"
            :class="[
              'px-3 py-1.5 text-sm rounded-md transition-all',
              exportFormat === 'json'
                ? 'bg-neutral-700 text-white font-medium'
                : 'text-neutral-400 hover:text-neutral-300'
            ]"
          >
            JSON
          </button>
        </div>

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
          @click="exportLibraryToFile"
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
                Successfully exported {{ exportedItemCount }} item{{ exportedItemCount !== 1 ? 's' : '' }}
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
import type { LibraryActor } from './state.ts'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'

import { computed, ref } from 'vue'

import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'
import ColorPicker, { DEFAULT_COLORS } from '@apackdev/ui/design/ColorPicker'
import { useDebounce } from '@apackdev/ui/composables/useDebounce'

interface LibraryTagOption {
  name: string
  color?: string
}

interface Props {
  settings?: SettingsOf<'library'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'library'>]
}>()

const tags = useSettingsDraft(() => props.settings?.tags ?? [])

// Save function
const saveTags = () => {
  emit('update-setting', {
    path: ['tags'],
    value: tags.value
  })
}

// Use the debounce composable for text input
const { debounced: debouncedSave } = useDebounce(() => {
  saveTags()
}, 500)

// Tag management
const addTag = () => {
  const newTag: LibraryTagOption = {
    name: `New Tag ${Date.now()}`,
    color: DEFAULT_COLORS[tags.value.length % DEFAULT_COLORS.length]
  }
  tags.value.push(newTag)
  saveTags()
}

const removeTag = (index: number) => {
  if (tags.value.length > 1) {
    tags.value.splice(index, 1)
    saveTags()
  }
}

// The import and the export are the surface's machine's: it makes each, and holds how the last one ended. What an
// earlier visit to this form left is not shown again
const { state: surface, send } = useState<LibraryActor>()
send({ type: 'FORGET_IMPORT' })
send({ type: 'FORGET_EXPORT' })

// How the last import ended, shown until another is picked
const imported = computed(() => surface.value.data.imported)
const isImporting = computed(() => surface.value.data.making.importLibrary)
const importStatus = computed(() => (imported.value === undefined ? 'idle' : imported.value.ok ? 'success' : 'error'))
const applyErrors = computed(() => {
  if (imported.value === undefined) return []
  return imported.value.ok ? imported.value.value.errors ?? [] : imported.value.failure.message.split('\n')
})
const importedCount = computed(() => (imported.value?.ok ? imported.value.value.count : 0))

// How the last export ended, shown until another is made
const exportFormat = ref<'markdown' | 'json'>('markdown')
const exportDirectory = ref<string>('')
const exported = computed(() => surface.value.data.exported)
const isExporting = computed(() => surface.value.data.making.exportLibrary)
const exportStatus = computed(() => (exported.value === undefined ? 'idle' : exported.value.ok ? 'success' : 'error'))
const exportErrors = computed(() => (exported.value?.ok === false ? [exported.value.failure.message] : []))
const exportedFilePath = computed(() => (exported.value?.ok ? exported.value.value.filePath : ''))
const exportedItemCount = computed(() => (exported.value?.ok ? exported.value.value.itemCount : 0))

// Import - directory picker, then the machine's ask
const selectAndImportLibrary = async () => {
  send({ type: 'FORGET_IMPORT' })

  const directory = await window.electronAPI?.fileUtils.selectPath({
    type: 'directory'
  })

  if (!directory || Array.isArray(directory)) return

  send({ type: 'IMPORT', directory })
}

// Export
const selectExportDirectory = async () => {
  const dir = await window.electronAPI?.fileUtils.selectPath({ type: 'directory' })
  if (dir && typeof dir === 'string') exportDirectory.value = dir
}

const exportLibraryToFile = async () => {
  if (!exportDirectory.value) return
  send({ type: 'EXPORT', directory: exportDirectory.value, format: exportFormat.value })
}
</script>
