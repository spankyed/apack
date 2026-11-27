<template>
  <div class="max-w-3xl">
    <!-- Database Hotkeys Section -->
    <CollapsibleSection label="Database Hotkeys" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Keyboard shortcuts for database operations
      </p>
      <div class="space-y-6">
        <div class="group">
          <KeyboardShortcutInput
            v-model="hotkeys.executeQuery"
            id="execute-query"
            label="Execute Query"
            @change="saveHotkey"
            container-class="flex-1"
            :show-reset-button="true"
          />
          <p class="mt-1.5 text-xs text-neutral-600">
            Run the current query or transaction in the editor
          </p>
        </div>

        <!-- Future hotkeys can be added here -->
      </div>
    </CollapsibleSection>

    <!-- Backup & Restore Section -->
    <CollapsibleSection label="Backup & Restore" :default-open="false" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Export and import database backups.
      </p>
      <button
        @click="openBackupRestore"
        class="px-4 py-2 bg-neutral-800 text-neutral-300 rounded-lg hover:bg-neutral-700 transition-colors flex items-center gap-2 text-sm font-medium border border-neutral-700/50"
      >
        <HardDriveDownload class="w-4 h-4" />
        Open Backup & Restore
      </button>
    </CollapsibleSection>

    <!-- Danger Zone Section -->
    <CollapsibleSection label="Danger Zone" :default-open="false" class="mb-8">
      <div class="space-y-4">
        <div class="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-red-900 dark:text-red-200 mb-2">
            Reset Database
          </h3>
          <p class="text-xs text-red-700 dark:text-red-300 mb-4">
            This will permanently delete all data from the database and create a new root flow. This action cannot be undone.
          </p>
          <button
            @click="handleResetDatabase"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            Reset Database
          </button>
        </div>
      </div>
    </CollapsibleSection>

    <!-- Save status will be managed by parent -->
  </div>
</template>

<script setup lang="ts">
import { HardDriveDownload } from 'lucide-vue-next'
import { useSettingsDraft } from '@apackdev/sdk/fe'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'
import KeyboardShortcutInput from '@apackdev/ui/components/KeyboardShortcutInput'
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'

import { openSurface } from '#generated/fe.ts'
import { useState } from '#generated/state-fe.ts'

interface Props {
  settings?: SettingsOf<'database'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'database'>]
}>()

const hotkeys = useSettingsDraft(() => props.settings?.hotkeys ?? {})

const saveHotkey = () => {
  emit('update-setting', { path: ['hotkeys', 'executeQuery'], value: hotkeys.value.executeQuery ?? null })
}

// Open backup & restore page
const openBackupRestore = () => {
  openSurface('database', { type: 'VIEW_BACKUP' })
}

const { send } = useState('database')

// Reset database function
const handleResetDatabase = () => {
  const confirmed = window.confirm(
    'Are you sure you want to reset the database? This will permanently delete all data and create a new root flow. This action cannot be undone.'
  )

  if (confirmed) send({ type: 'DATABASE.RESET' })
}
</script>