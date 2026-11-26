<template>
  <div class="flex h-full">
    <!-- Navigation Sidebar -->
    <div class="w-48 p-2 bg-neutral-900 border-r border-neutral-800 overflow-auto flex flex-col">
      <div class="flex-1">
        <button
          v-for="item in navItems"
          :key="item.id"
          @click="selectNavItem(item.id)"
          :class="[
            'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors mb-0.5',
            settings.data.generalNavItem === item.id
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
          ]"
        >
          <component :is="item.icon" class="w-4 h-4" />
          {{ item.label }}
        </button>
      </div>
      <div class="border-t border-neutral-800 pt-2 mt-2">
        <button
          v-for="item in bottomNavItems"
          :key="item.id"
          @click="selectNavItem(item.id)"
          :class="[
            'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors mb-0.5',
            settings.data.generalNavItem === item.id
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
          ]"
        >
          <component :is="item.icon" class="w-4 h-4" />
          {{ item.label }}
        </button>
      </div>
    </div>

    <!-- Content Area -->
    <div class="flex-1 p-8 overflow-auto">
      <component
        :is="componentMap[settings.data.generalNavItem]"
        :settings="currentSettings"
        v-bind="settings.data.generalNavItem === 'personal' ? { saveSetting: handleUpdateSetting } : {}"
        @update-setting="handleUpdateSetting"
      />

      <!-- Save Status Indicator -->
      <div class="mt-6 flex items-center gap-2">
        <div v-if="saveStatus === 'saving'" class="flex items-center gap-2 text-xs text-neutral-500">
          <div class="w-1 h-1 bg-neutral-500 rounded-full animate-pulse"></div>
          Saving...
        </div>
        <div v-else-if="saveStatus === 'saved'" class="flex items-center gap-2 text-xs text-green-600">
          <CheckCircle class="w-3 h-3" />
          Settings saved
        </div>
        <div v-else-if="saveStatus === 'refused'" class="flex items-center gap-2 text-xs text-red-400">{{ problems.join('; ') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { User, Key, Settings, CheckCircle, Briefcase, FileJson } from 'lucide-vue-next'
import PersonalInfo from '../components/GeneralSettings/PersonalInfo.vue'
import Secrets from '../components/GeneralSettings/Secrets.vue'
import App from '../components/GeneralSettings/App.vue'
import Projects from '../components/GeneralSettings/Projects.vue'
import SettingsJsonEditor from '../components/GeneralSettings/SettingsJsonEditor.vue'
import { useAppSettings } from '@apackdev/sdk/fe'
import { useSettingsSaveStatus } from '@/views/settings/save'
import { useHostState } from '@apackdev/host/fe'
import type { SettingUpdate } from '@apackdev/sdk/fe'

const { state: settings, send } = useHostState('settings')
const appSettings = useAppSettings()

// Use the settings save status composable
const { saveStatus, problems, updateSettings } = useSettingsSaveStatus()

// Compute current settings based on selected nav item
const currentSettings = computed(() => {
  // App forms share the public host contract.
  const app = appSettings.value
  if (!app) return null

  const settingsMap = {
    personal: app.personal,
    projects: app.projects,
    application: { hotkeys: app.hotkeys }
  }

  return settingsMap[settings.value.data.generalNavItem as keyof typeof settingsMap]
})

// Component mapping
const componentMap: Record<string, Component> = {
  personal: PersonalInfo,
  secrets: Secrets,
  projects: Projects,
  application: App,
  json: SettingsJsonEditor,
}

const navItems = [
  { id: 'application', label: 'Application', icon: Settings },
  { id: 'secrets', label: 'Providers', icon: Key },
  { id: 'projects', label: 'Projects', icon: Briefcase },
  { id: 'personal', label: 'Personal', icon: User },
]

const bottomNavItems = [
  { id: 'json', label: 'JSON', icon: FileJson },
]

const selectNavItem = (itemId: string) => {
  send({ type: 'GENERAL_NAV.SELECT', item: itemId as 'personal' | 'secrets' | 'projects' | 'application' | 'json' })
}

// Handle update events from child components
const handleUpdateSetting = (event: SettingUpdate) => {
  // Map the current nav item to the appropriate label
  const labelMap = {
    personal: 'personal',
    projects: 'projects',
    application: 'application'
  } as const

  const currentNavItem = settings.value.data.generalNavItem as keyof typeof labelMap
  const backendLabel = labelMap[currentNavItem]

  // Defensive check to prevent undefined labels
  if (!backendLabel) {
    console.error(`[GeneralTab] Invalid generalNavItem value: "${settings.value.data.generalNavItem}". Expected one of: ${Object.keys(labelMap).join(', ')}`)
    console.error('[GeneralTab] Skipping settings update to prevent data corruption')
    return Promise.resolve({ status: 'refused' as const, problems: ['This settings form is no longer selected.'] })
  }

  // Application displays the hotkeys form; personal and projects select their app fields.
  return updateSettings({
    target: { kind: 'app' },
    path: backendLabel === 'application' ? event.path : [backendLabel, ...event.path],
    value: event.value,
    condition: event.condition
  })
}
</script>
