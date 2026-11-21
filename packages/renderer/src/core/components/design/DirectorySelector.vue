<template>
  <div :class="containerClass">
    <div 
      class="flex items-center px-3 py-2 bg-neutral-800 border rounded-lg text-sm transition-all"
      :class="[
        value 
          ? 'border-neutral-700/50 hover:border-neutral-600' 
          : 'border-neutral-700/50'
      ]"
    >
      <!-- Label on the left -->
      <span v-if="label" class="text-neutral-400 text-xs uppercase tracking-wider truncate mr-3">
        {{ label }}
      </span>
      
      <!-- Directory path or placeholder -->
      <span 
        class="flex-1 truncate"
        :class="value ? 'text-white font-mono text-xs' : 'text-neutral-500'"
        :title="value || ''"
      >
        {{ displayPath }}
      </span>
      
      <!-- Folder icon when empty -->
      <Folder 
        v-if="!value && showIcon" 
        class="ml-2 w-4 h-4 text-neutral-500 flex-shrink-0" 
      />
      
      <!-- Action buttons - now inside the input field -->
      <div class="flex items-center gap-1 ml-3">
        <button
          @click="selectDirectory"
          class="px-2.5 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-300 hover:text-white transition-all text-xs font-medium"
          :title="selectButtonTitle"
        >
          {{ value ? 'Change' : 'Select' }}
        </button>
        
        <button
          v-if="value && showResetButton"
          @click="resetDirectory"
          class="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-red-400 transition-all"
          :title="resetButtonTitle"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
    
    <!-- Description text -->
    <p v-if="description" class="mt-1.5 text-xs text-neutral-600">
      {{ description }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Folder, X } from 'lucide-vue-next'

interface Props {
  modelValue?: string | null
  label?: string
  placeholder?: string
  description?: string
  showIcon?: boolean
  showResetButton?: boolean
  selectButtonTitle?: string
  resetButtonTitle?: string
  containerClass?: string
  truncateStart?: boolean
  homeDirectory?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'No directory selected',
  showIcon: true,
  showResetButton: true,
  selectButtonTitle: 'Select a directory',
  resetButtonTitle: 'Clear selection',
  containerClass: '',
  truncateStart: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  'change': [value: string | null]
}>()

const value = computed(() => props.modelValue)

// Format the display path
const displayPath = computed(() => {
  if (!value.value) return props.placeholder

  const normalizedHome = props.homeDirectory?.replace(/\/+$/, '')
  const formattedPath = normalizedHome && (value.value === normalizedHome || value.value.startsWith(`${normalizedHome}/`))
    ? `~${value.value.slice(normalizedHome.length)}`
    : value.value
  
  // If truncateStart is true and path is long, show only the end
  if (props.truncateStart && formattedPath.length > 50) {
    return '...' + formattedPath.slice(-47)
  }
  
  return formattedPath
})

// Select a directory using Electron API
const selectDirectory = async () => {
  if (!window.electronAPI?.fileUtils.selectDirectory) {
    console.error('Directory selection API not available')
    return
  }

  try {
    const directoryPath = await window.electronAPI.fileUtils.selectDirectory()
    
    if (directoryPath && directoryPath !== value.value) {
      emit('update:modelValue', directoryPath)
      emit('change', directoryPath)
    }
  } catch (error) {
    console.error('Error selecting directory:', error)
  }
}

// Reset the directory selection
const resetDirectory = () => {
  emit('update:modelValue', null)
  emit('change', null)
}
</script>
