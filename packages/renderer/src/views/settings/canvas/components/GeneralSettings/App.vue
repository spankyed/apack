<template>
  <div class="max-w-3xl">
    <!-- Header Section -->
    <div class="mb-8">
      <h2 class="text-xl font-semibold text-white mb-2">Application</h2>
      <p class="text-sm text-neutral-500">
        Import pack content, configure hotkeys, and manage app data.
      </p>
    </div>

    <!-- Hotkeys Section -->
    <div class="bg-neutral-900/50 border border-neutral-800 rounded-xl p-6 mb-6">
      <Hotkeys
        :settings="props.settings?.hotkeys"
        @update-setting="onHotkeyUpdate"
      />
    </div>

    <!-- App Cache Section -->
    <div class="bg-neutral-900/50 border border-neutral-800 rounded-xl p-6 mb-6">
      <div class="flex items-center gap-2 mb-4">
        <HardDrive class="w-4 h-4 text-neutral-400" />
        <h3 class="text-sm font-medium text-neutral-300 uppercase tracking-wider">App Cache</h3>
      </div>
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-neutral-300">App cache</p>
          <p class="text-xs text-neutral-500 mt-1">Clears frontend localStorage for cached UI state.</p>
        </div>
        <button
          v-if="!confirmingClearAppCache"
          @click="confirmingClearAppCache = true"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
        >
          <Trash2 class="w-3.5 h-3.5" />
          Clear Cache...
        </button>
        <div v-else class="flex items-center gap-2">
          <button
            @click="onClearAppCache"
            class="px-3 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            Clear
          </button>
          <button
            @click="confirmingClearAppCache = false"
            class="px-3 py-2 rounded-lg text-sm font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      <p v-if="appCacheStatus" :class="[
        'text-xs mt-3',
        appCacheStatus.kind === 'success' ? 'text-green-500' : 'text-red-400'
      ]">
        {{ appCacheStatus.message }}
      </p>
    </div>

    <!-- Data Management -->
    <div class="space-y-6">
      <div class="bg-neutral-900/50 border border-neutral-800 rounded-xl p-6">
        <div class="flex items-center gap-2 mb-4">
          <PackageOpen class="w-4 h-4 text-neutral-400" />
          <h3 class="text-sm font-medium text-neutral-300 uppercase tracking-wider">Import Pack Content</h3>
        </div>

        <p class="text-sm text-neutral-500 mb-4">
          Import compiled actions, prompts, flows, documents, commands and notes from a pack's compiled content directory.
        </p>

        <!-- Idle / previewing: show the select-directory button -->
        <button
          v-if="status === 'idle' || status === 'previewing'"
          @click="selectDirectory"
          :disabled="status === 'previewing'"
          :class="[
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            status === 'previewing'
              ? 'bg-neutral-700 text-neutral-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          ]"
        >
          {{ status === 'previewing' ? 'Reading pack...' : 'Select Compiled Directory...' }}
        </button>

        <!-- Selecting: show the picker -->
        <ImportPackContentPicker
          v-else-if="status === 'selecting' || status === 'importing'"
          :preview="preview!"
          :selection="selection"
          :expanded="expanded"
          :import-mode="importMode"
          :restart-brain="restartBrainFlag"
          :importing="status === 'importing'"
          @toggle-expand="onToggleExpand"
          @toggle-type-all="onToggleTypeAll"
          @toggle-item="onToggleItem"
          @set-mode="onSetMode"
          @toggle-restart-brain="onToggleRestartBrain"
          @confirm="onConfirm"
          @cancel="onCancel"
        />

        <!-- Result: every record imported, or some couldn't be -->
        <div
          v-if="status === 'success' && importResult"
          class="mt-4 p-3 rounded-lg border"
          :class="applyErrors.length ? 'bg-amber-900/20 border-amber-800/50' : 'bg-green-900/20 border-green-800/50'"
        >
          <p class="text-sm font-medium mb-2" :class="applyErrors.length ? 'text-amber-400' : 'text-green-400'">
            {{ applyErrors.length ? `Import finished with ${applyErrors.length} error${applyErrors.length === 1 ? '' : 's'}` : 'Import complete' }}
          </p>
          <div class="text-xs text-green-500/80 space-y-0.5">
            <p v-for="(counts, key) in importResult" :key="key">
              <span class="capitalize">{{ key }}</span> — {{ counts.created }} created, {{ counts.updated }} updated, {{ counts.skipped }} skipped
            </p>
          </div>
          <ul v-if="applyErrors.length" class="mt-2 text-xs text-amber-400/90 space-y-0.5 list-disc pl-4">
            <li v-for="(error, index) in applyErrors" :key="index" class="break-words">{{ error }}</li>
          </ul>
          <button
            @click="onReset"
            class="mt-3 text-xs text-green-500/80 hover:text-green-400 underline"
          >
            Import another pack
          </button>
        </div>

        <div v-if="status === 'error' && importError" class="mt-4 p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
          <p class="text-sm text-red-400">Import failed: {{ importError }}</p>
          <button
            @click="onReset"
            class="mt-3 text-xs text-red-500/80 hover:text-red-400 underline"
          >
            Try again
          </button>
        </div>
      </div>
    </div>

    <!-- Reset App -->
    <div class="mt-8 bg-red-900/10 border border-red-800/30 rounded-xl p-6">
      <div class="flex items-center gap-2 mb-2">
        <RotateCcw class="w-4 h-4 text-red-400" />
        <h3 class="text-sm font-medium text-red-400 uppercase tracking-wider">Reset App</h3>
      </div>
      <p class="text-sm text-neutral-500 mb-4">
        Erase all data and restore defaults. This cannot be undone.
      </p>
      <button
        v-if="!confirmingReset"
        @click="confirmingReset = true"
        class="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
      >
        Reset App...
      </button>
      <div v-else class="flex items-center gap-3">
        <span class="text-sm text-red-400">Are you sure?</span>
        <button
          @click="onResetApp"
          :disabled="settingsView.data.resetting"
          class="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {{ settingsView.data.resetting ? 'Resetting…' : 'Yes, erase everything' }}
        </button>
        <button
          @click="confirmingReset = false"
          :disabled="settingsView.data.resetting"
          class="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { computed, ref } from 'vue'
import { HardDrive, PackageOpen, RotateCcw, Trash2 } from 'lucide-vue-next'
import ImportPackContentPicker from './ImportPackContentPicker.vue'
import Hotkeys from './Hotkeys.vue'
import { errorMessage } from '@apackdev/sdk/utils/pure';
import type { SettingsEvents, SettingsState } from '@apackdev/host/fe'
import type { ApplicationHotkeys } from '@apackdev/sdk/types'
import type { SettingUpdate } from '@apackdev/sdk/fe'

/** The modes the Settings machine takes for a content import, so a widened string cannot reach its event */
type ContentImportMode = Extract<SettingsEvents, { type: 'PACK_CONTENT.SET_MODE' }>['mode']

/** The `application` slice this form draws; it passes the hotkeys on to the Hotkeys form */
interface Props {
  settings?: { hotkeys?: ApplicationHotkeys }
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update-setting': [SettingUpdate]
}>()

function onHotkeyUpdate(event: SettingUpdate) {
  emit('update-setting', {
    path: ['hotkeys', ...event.path],
    value: event.value,
    condition: event.condition
  })
}

const actor: SettingsState = useSurface()

const { state: settingsView, send } = useState(actor)

const status = computed(() => settingsView.value.data.packContentImport?.status ?? 'idle')
const preview = computed(() => settingsView.value.data.packContentImport?.preview ?? null)
const selection = computed(() => settingsView.value.data.packContentImport?.selection)
const expanded = computed(() => settingsView.value.data.packContentImport?.expanded)
const importMode = computed(() => settingsView.value.data.packContentImport?.importMode ?? 'replace-on-collision')
const restartBrainFlag = computed(() => settingsView.value.data.packContentImport?.restartBrain ?? false)
const importResult = computed(() => settingsView.value.data.packContentImport?.result)
const applyErrors = computed<string[]>(() => settingsView.value.data.packContentImport?.errors ?? [])
const importError = computed(() => settingsView.value.data.packContentImport?.error)

const confirmingClearAppCache = ref(false)
const appCacheStatus = ref<{ kind: 'success' | 'error'; message: string } | null>(null)

function onClearAppCache() {
  try {
    localStorage.clear()
    appCacheStatus.value = { kind: 'success', message: 'App cache cleared. Restart the app to reload cached UI state.' }
  } catch (error) {
    appCacheStatus.value = {
      kind: 'error',
      message: `Failed to clear app cache: ${errorMessage(error)}`
    }
  } finally {
    confirmingClearAppCache.value = false
  }
}

async function selectDirectory() {
  // selectDirectory rather than selectPath({ type: 'directory' }): the general one is declared
  // `string | string[] | null` whatever the options, and this wants one directory, as Projects.vue does
  const result = await window.electronAPI?.fileUtils?.selectDirectory?.()
  if (!result) return
  send({ type: 'PACK_CONTENT.PREVIEW', directory: result })
}

function onToggleExpand(key: string) {
  send({ type: 'PACK_CONTENT.TOGGLE_EXPAND', key })
}

function onToggleTypeAll(key: string) {
  send({ type: 'PACK_CONTENT.TOGGLE_TYPE_ALL', key })
}

function onToggleItem(payload: { key: string; item: string }) {
  send({ type: 'PACK_CONTENT.TOGGLE_ITEM', key: payload.key, item: payload.item })
}

function onSetMode(mode: ContentImportMode) {
  send({ type: 'PACK_CONTENT.SET_MODE', mode })
}

function onToggleRestartBrain() {
  send({ type: 'PACK_CONTENT.TOGGLE_RESTART_BRAIN' })
}

function onConfirm() {
  send({ type: 'PACK_CONTENT.CONFIRM_IMPORT' })
}

function onCancel() {
  send({ type: 'PACK_CONTENT.CANCEL' })
}

function onReset() {
  send({ type: 'PACK_CONTENT.RESET_STATUS' })
}

// Reset App
const confirmingReset = ref(false)

function onResetApp() {
  send({ type: 'APP.RESET' })
}
</script>
