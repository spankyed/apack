<template>
  <div class="max-w-3xl">
    <CollapsibleSection label="Notes" :default-open="true" class="mb-8">
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <label for="show-collapse-icon" class="text-sm font-medium text-neutral-300">
              Show collapse icon
            </label>
            <p class="text-xs text-neutral-500 mt-0.5">
              Show a collapse chevron in place of a note's icon for notes with children
            </p>
          </div>
          <input
            id="show-collapse-icon"
            v-model="showCollapseIcon"
            type="checkbox"
            @change="saveShowCollapseIconSetting"
            class="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
          />
        </div>
      </div>
    </CollapsibleSection>

    <CollapsibleSection label="Task List" :default-open="true" class="mb-8">
      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <label class="text-sm font-medium text-neutral-300 min-w-[120px]">
            Panel Position:
          </label>
          <div class="flex gap-1">
            <button
              v-for="option in positionOptions"
              :key="option.value"
              @click="updatePosition(option.value)"
              :class="[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                panelPosition === option.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-300 border border-neutral-700/50'
              ]"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- Import Notes Section -->
    <CollapsibleSection label="Import Notes" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Import notes from an export folder
      </p>

      <div class="space-y-4">
        <button
          @click="selectAndImportNotes"
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
                Successfully imported {{ importedCount }} note{{ importedCount !== 1 ? 's' : '' }}
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

    <!-- Export Notes Section -->
    <CollapsibleSection label="Export Notes" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        {{ exportFormat === 'markdown'
          ? 'Export notes as markdown files with frontmatter'
          : 'Export all notes to a JSON file (full-fidelity round-trip)'
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
          @click="exportNotesToFile"
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
                Successfully exported {{ exportedItemCount }} note{{ exportedItemCount !== 1 ? 's' : '' }}
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
import { Upload, Download, FolderOpen, CheckCircle, XCircle } from 'lucide-vue-next'
import { useSettingsDraft, useState } from '@apackdev/sdk/fe'
import type { NotesState } from './state.ts'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'

import { computed, ref } from 'vue'

import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'

interface Props {
  settings: SettingsOf<'notes'>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'notes'>]
}>()

const positionOptions = [
  { value: 'left' as const, label: 'Left' },
  { value: 'right' as const, label: 'Right' },
]

const panelPosition = useSettingsDraft(() => props.settings.tasklistPanelPosition)
const showCollapseIcon = useSettingsDraft(() => props.settings.showCollapseIcon)

const saveShowCollapseIconSetting = () => {
  emit('update-setting', {
    path: ['showCollapseIcon'],
    value: showCollapseIcon.value
  })
}

const updatePosition = (value: 'left' | 'right') => {
  panelPosition.value = value
  emit('update-setting', {
    path: ['tasklistPanelPosition'],
    value
  })
}

// The import and the export are the surface's machine's: it makes each, and holds how the last one ended. What an
// earlier visit to this form left is not shown again
const { state: surface, send } = useState<NotesState>()
send({ type: 'NOTES.FORGET_IMPORT' })
send({ type: 'NOTES.FORGET_EXPORT' })

// How the last import ended, shown until another is picked
const imported = computed(() => surface.value.data.imported)
const isImporting = computed(() => surface.value.data.making.importNotes)
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
const isExporting = computed(() => surface.value.data.making.exportNotes)
const exportStatus = computed(() => (exported.value === undefined ? 'idle' : exported.value.ok ? 'success' : 'error'))
const exportErrors = computed(() => (exported.value?.ok === false ? [exported.value.failure.message] : []))
const exportedFilePath = computed(() => (exported.value?.ok ? exported.value.value.filePath : ''))
const exportedItemCount = computed(() => (exported.value?.ok ? exported.value.value.itemCount : 0))

// Import - directory picker, then the machine's ask
const selectAndImportNotes = async () => {
  send({ type: 'NOTES.FORGET_IMPORT' })

  const directory = await window.electronAPI?.fileUtils.selectPath({
    type: 'directory'
  })

  if (!directory || Array.isArray(directory)) return

  send({ type: 'NOTES.IMPORT', directory })
}

// Export
const selectExportDirectory = async () => {
  const dir = await window.electronAPI?.fileUtils.selectPath({ type: 'directory' })
  if (dir && typeof dir === 'string') exportDirectory.value = dir
}

const exportNotesToFile = async () => {
  if (!exportDirectory.value) return
  send({ type: 'NOTES.EXPORT', directory: exportDirectory.value, format: exportFormat.value })
}
</script>
