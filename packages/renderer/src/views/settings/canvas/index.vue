<template>
  <div class="flex flex-col h-full bg-neutral-900">
    <!-- Tabs -->
    <div class="flex border-b border-neutral-800">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="selectTab(tab.id)"
        :data-onboarding-id="`settings-${tab.id}-tab`"
        :class="[
          'flex-1 px-4 py-3 text-sm font-medium transition-colors relative',
          settings.data.activeTab === tab.id
            ? 'text-white border-b-2 border-blue-500'
            : 'text-neutral-400 hover:text-neutral-200'
        ]"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab Content -->
    <div class="flex-1 overflow-hidden">
      <GeneralTab v-if="settings.data.activeTab === 'general' && settingsReady" />
      <PacksTab v-if="settings.data.activeTab === 'packs' && settingsReady" />
      <FeaturesTab v-if="settings.data.activeTab === 'features' && settingsReady" />
      <p v-if="settings.data.activeTab !== 'help' && !settingsReady" class="p-8 text-sm text-neutral-400">{{ settingsStatus === 'loading' ? 'Loading settings…' : 'Settings are unavailable while the backend is disconnected.' }}</p>
      <HelpTab v-if="settings.data.activeTab === 'help'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStatus } from '@apackdev/sdk/fe'

import GeneralTab from './tabs/GeneralTab.vue'
import FeaturesTab from './tabs/FeaturesTab.vue'
import PacksTab from './tabs/PacksTab.vue'
import HelpTab from './tabs/HelpTab.vue'
import { useHostState } from '@apackdev/host/fe'

const settingsStatus = useSettingsStatus()
const settingsReady = computed(() => settingsStatus.value === 'ready' || settingsStatus.value === 'replacing')
const { state: settings, send } = useHostState('settings')

const tabs = [
  { id: 'general', label: 'General' },
  { id: 'packs', label: 'Packs' },
  { id: 'features', label: 'Features' },
  { id: 'help', label: 'Help' },
]

const selectTab = (tabId: string) => {
  send({ type: 'TAB.SELECT', tab: tabId as 'general' | 'packs' | 'features' | 'help' })
}
</script>

