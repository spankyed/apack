<template>
  <div class="max-w-3xl">
    <!-- Maximum Logs Section -->
    <CollapsibleSection label="Maximum Logs" :default-open="true" class="mb-8">
      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <span class="text-sm text-neutral-400">Keep the last</span>
          <input
            v-model.number="maxLogs"
            type="number"
            min="100"
            max="10000"
            step="100"
            class="w-20 px-2 py-1 bg-neutral-800/50 border border-neutral-700/30 rounded text-white text-sm text-center focus:outline-none focus:border-neutral-600 transition-all"
            @blur="handleMaxLogsChange"
            @keyup.enter="handleMaxLogsChange"
          />
          <span class="text-sm text-neutral-400">logs</span>
          <span class="text-xs text-neutral-500 ml-2">• Older logs are automatically removed</span>
        </div>

        <!-- Slider -->
        <div class="space-y-2">
          <input
            v-model.number="maxLogs"
            type="range"
            min="100"
            max="10000"
            step="100"
            class="w-full"
            @change="handleMaxLogsChange"
          />
          <div class="flex justify-between text-xs text-neutral-600">
            <button @click="setMaxLogs(100)" class="hover:text-neutral-400 transition-colors">100</button>
            <button @click="setMaxLogs(500)" class="hover:text-neutral-400 transition-colors">500</button>
            <button @click="setMaxLogs(1000)" class="hover:text-neutral-400 transition-colors">1k</button>
            <button @click="setMaxLogs(5000)" class="hover:text-neutral-400 transition-colors">5k</button>
            <button @click="setMaxLogs(10000)" class="hover:text-neutral-400 transition-colors">10k</button>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- Excluded Sources Section -->
    <CollapsibleSection label="Excluded Sources" :default-open="true" class="mb-8">
      <p class="text-sm text-neutral-500 mb-4">
        Hide logs from noisy sources
      </p>
      
      <div class="space-y-3">
        <!-- Current exclusions -->
        <div v-if="excludedSources.length > 0" class="space-y-1">
          <div
            v-for="(source, index) in excludedSources"
            :key="index"
            class="flex items-center gap-2 text-sm"
          >
            <button
              @click="removeExclusion(index)"
              class="text-neutral-500 hover:text-red-400 transition-colors"
              title="Remove"
            >
              <X class="w-4 h-4" />
            </button>
            <code class="text-neutral-300">{{ source }}</code>
          </div>
        </div>

        <!-- Add new exclusion -->
        <div class="flex gap-2">
          <input
            v-model="newExclusion"
            type="text"
            placeholder="Add pattern, e.g. debug.*"
            class="flex-1 px-3 py-1.5 bg-neutral-800/50 border border-neutral-700/30 rounded text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-all"
            @keyup.enter="addExclusion"
          />
          <button
            @click="addExclusion"
            :disabled="!newExclusion.trim()"
            class="px-3 py-1.5 bg-neutral-800 text-neutral-300 rounded hover:bg-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600 transition-colors text-sm"
          >
            Add
          </button>
        </div>

        <!-- Quick filters -->
        <div class="text-xs text-neutral-600">
          Quick filters: 
          <button 
            v-for="(pattern, i) in commonExclusions.slice(0, 4)"
            :key="pattern"
            @click="addCommonExclusion(pattern)"
            :disabled="excludedSources.includes(pattern)"
            class="hover:text-neutral-400 transition-colors disabled:text-neutral-700"
          >
            {{ pattern }}<span v-if="i < 3" class="mx-1">·</span>
          </button>
        </div>
      </div>
    </CollapsibleSection>
  </div>
</template>

<script setup lang="ts">
import { useSettingsDraft } from '@apackdev/sdk/fe'
import { X } from 'lucide-vue-next'
import { ref } from 'vue'
import type { SettingUpdate, SettingsOf } from '#generated/settings-fe.ts'
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection'

interface Props {
  settings?: SettingsOf<'logs'>
}

const props = withDefaults(defineProps<Props>(), {
  settings: undefined
})

const emit = defineEmits<{
  'update-setting': [SettingUpdate<'logs'>]
}>()

// State
const maxLogs = useSettingsDraft(() => props.settings?.maxLogs || 1000)
const excludedSources = useSettingsDraft(() => props.settings?.excludedSources || [])
const newExclusion = ref<string>('')

// Common exclusion patterns
const commonExclusions = [
  'app-events',
  'debug.*',
  'trace.*',
  'verbose.*',
  'system.*'
]

// Methods
const handleMaxLogsChange = () => {
  // Validate the input
  if (maxLogs.value < 100) maxLogs.value = 100
  if (maxLogs.value > 10000) maxLogs.value = 10000
  
  emit('update-setting', {
    path: ['maxLogs'],
    value: maxLogs.value
  })
}

const setMaxLogs = (value: number) => {
  maxLogs.value = value
  handleMaxLogsChange()
}

const addExclusion = () => {
  const pattern = newExclusion.value.trim()
  if (pattern && !excludedSources.value.includes(pattern)) {
    excludedSources.value.push(pattern)
    newExclusion.value = ''
    
    emit('update-setting', {
      path: ['excludedSources'],
      value: excludedSources.value
    })
  }
}

const addCommonExclusion = (pattern: string) => {
  if (!excludedSources.value.includes(pattern)) {
    excludedSources.value.push(pattern)
    
    emit('update-setting', {
      path: ['excludedSources'],
      value: excludedSources.value
    })
  }
}

const removeExclusion = (index: number) => {
  excludedSources.value.splice(index, 1)
  
  emit('update-setting', {
    path: ['excludedSources'],
    value: excludedSources.value
  })
}
</script>