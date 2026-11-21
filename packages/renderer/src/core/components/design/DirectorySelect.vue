<template>
  <div ref="containerRef" class="relative">
    <!-- Trigger Button -->
    <button
      ref="triggerRef"
      @click="toggleDropdown"
      @keydown="handleTriggerKeydown"
      type="button"
      class="w-full px-3 py-2 bg-neutral-800 border border-neutral-700/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left flex items-center justify-between"
      :disabled="disabled"
    >
      <span class="truncate">{{ selectedLabel }}</span>
      <svg
        class="w-4 h-4 transition-transform flex-shrink-0 ml-2"
        :class="{ 'rotate-180': showDropdown }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Dropdown -->
    <teleport to="body">
      <Transition name="dropdown">
        <div
          v-if="showDropdown"
          ref="dropdownRef"
          :style="dropdownStyle"
          class="fixed z-50 overflow-hidden bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl"
        >
          <div class="max-h-96 overflow-y-auto py-1">
            <!-- "Use last opened directory" option -->
            <div
              @click="selectOption(null)"
              @mouseenter="hoveredIndex = -1"
              :class="[
                'px-3 py-2 text-sm cursor-pointer transition-colors',
                modelValue === null && hoveredIndex === -1
                  ? 'bg-blue-600 text-white'
                  : hoveredIndex === -1
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'text-neutral-200 hover:bg-neutral-700'
              ]"
            >
              Use last opened directory
            </div>

            <!-- Separator -->
            <div v-if="projects.length > 0" class="my-1 border-t border-neutral-700"></div>

            <!-- Project directories -->
            <template v-for="(project, pIndex) in projects" :key="`project-${pIndex}`">
              <!-- Project header -->
              <div class="px-3 py-1.5 text-xs font-medium text-neutral-400 bg-neutral-800/50 flex items-center gap-2">
                <div
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: project.color }"
                ></div>
                {{ project.name || `Project ${pIndex + 1}` }}
              </div>

              <div
                v-for="(directory, dIndex) in project.directories"
                :key="`dir-${pIndex}-${dIndex}`"
                @click="selectOption(directory)"
                @mouseenter="hoveredIndex = getOptionIndex(directory)"
                :class="[
                  'px-3 py-2 text-sm cursor-pointer transition-colors pl-6',
                  modelValue === directory && hoveredIndex === getOptionIndex(directory)
                    ? 'bg-blue-600 text-white'
                    : hoveredIndex === getOptionIndex(directory)
                    ? 'bg-neutral-700 text-neutral-200'
                    : 'text-neutral-200 hover:bg-neutral-700'
                ]"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 flex-1 min-w-0 truncate">
                    <div
                      class="w-2 h-2 rounded-full flex-shrink-0"
                      :style="{ backgroundColor: project.color || 'red' }"
                    ></div>
                    <span class="font-medium">{{ getFolderName(directory) }}</span>
                    <span class="text-xs text-neutral-400">{{ formatFullPath(directory) }}</span>
                  </div>
                  <div class="text-xs text-neutral-500 flex-shrink-0">
                    {{ project.name }}{{ project.directories.length > 1 ? ` (${dIndex + 1})` : '' }}
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

interface Project {
  name: string
  directories: string[]
  color: string
}

interface Props {
  modelValue: string | null
  projects: Project[]
  disabled?: boolean
  homeDirectory?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const containerRef = ref<HTMLDivElement>()
const triggerRef = ref<HTMLButtonElement>()
const dropdownRef = ref<HTMLDivElement>()
const showDropdown = ref(false)
const hoveredIndex = ref(-1)
const dropdownStyle = ref<{ top: string; left: string; width: string }>({
  top: '0px',
  left: '0px',
  width: '0px'
})

// Build flat list of all directory options for indexing
const allOptions = computed(() => {
  const options: (string | null)[] = [null] // "Use last opened directory"

  props.projects.forEach(project => {
    project.directories.forEach(directory => {
      options.push(directory)
    })
  })

  return options
})

const getOptionIndex = (directory: string | null) => {
  return allOptions.value.indexOf(directory)
}

const selectedLabel = computed(() => {
  if (props.modelValue === null) {
    return 'Use last opened directory'
  }

  // Just show the folder name for selected value
  return getFolderName(props.modelValue)
})

const getFolderName = (path: string): string => {
  if (!path) return ''
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] || path
}

const formatFullPath = (path: string): string => {
  if (!path) return ''

  const normalizedHome = props.homeDirectory?.replace(/\/+$/, '')
  const displayPath = normalizedHome && (path === normalizedHome || path.startsWith(`${normalizedHome}/`))
    ? `~${path.slice(normalizedHome.length)}`
    : path

  // If path is short enough, return as-is
  if (displayPath.length <= 50) return displayPath

  // Split path into segments (~ will be first segment)
  const segments = displayPath.split('/').filter(Boolean)

  // If we have few segments, just truncate from start
  if (segments.length <= 2) {
    return '...' + displayPath.slice(-47)
  }

  // Always keep: ~ + last 2 segments
  const last = segments[segments.length - 1]
  const secondLast = segments[segments.length - 2]
  const tail = `/${secondLast}/${last}`

  // Try to fit as many leading segments as possible
  let result = segments[0] // Start with ~
  let remaining = 50 - result.length - tail.length - 2 // 2 for /…

  for (let i = 1; i < segments.length - 2; i++) {
    const seg = segments[i]
    if (remaining >= seg.length + 1) { // +1 for /
      result += '/' + seg
      remaining -= seg.length + 1
    } else {
      // Can't fit more, use ellipsis
      result += '/…'
      return result + tail
    }
  }

  // If we fit all middle segments, no ellipsis needed
  return result + tail
}

const toggleDropdown = () => {
  if (props.disabled) return
  showDropdown.value = !showDropdown.value
}

const selectOption = (value: string | null) => {
  emit('update:modelValue', value)
  showDropdown.value = false
  hoveredIndex.value = -1
}

const handleTriggerKeydown = (event: KeyboardEvent) => {
  if (props.disabled) return

  switch (event.key) {
    case 'Enter':
    case ' ':
    case 'ArrowDown':
      event.preventDefault()
      showDropdown.value = true
      hoveredIndex.value = getOptionIndex(props.modelValue)
      break
    case 'ArrowUp':
      event.preventDefault()
      showDropdown.value = true
      hoveredIndex.value = getOptionIndex(props.modelValue)
      break
  }
}

const handleDropdownKeydown = (event: KeyboardEvent) => {
  if (!showDropdown.value) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      hoveredIndex.value = Math.min(
        hoveredIndex.value + 1,
        allOptions.value.length - 1
      )
      break
    case 'ArrowUp':
      event.preventDefault()
      hoveredIndex.value = Math.max(hoveredIndex.value - 1, -1)
      break
    case 'Enter':
      event.preventDefault()
      if (hoveredIndex.value >= 0) {
        selectOption(allOptions.value[hoveredIndex.value])
      }
      break
    case 'Escape':
      event.preventDefault()
      showDropdown.value = false
      triggerRef.value?.focus()
      break
  }
}

const updateDropdownPosition = () => {
  if (!triggerRef.value || !showDropdown.value) return

  const rect = triggerRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`
  }
}

const handleClickOutside = (event: MouseEvent) => {
  if (!showDropdown.value) return

  const target = event.target as Node
  if (
    containerRef.value?.contains(target) ||
    dropdownRef.value?.contains(target)
  ) {
    return
  }

  showDropdown.value = false
}

watch(showDropdown, async (isVisible) => {
  if (isVisible) {
    await nextTick()
    updateDropdownPosition()
    hoveredIndex.value = getOptionIndex(props.modelValue)
  }
})

onMounted(() => {
  window.addEventListener('scroll', updateDropdownPosition, true)
  window.addEventListener('resize', updateDropdownPosition)
  window.addEventListener('click', handleClickOutside)
  window.addEventListener('keydown', handleDropdownKeydown)
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateDropdownPosition, true)
  window.removeEventListener('resize', updateDropdownPosition)
  window.removeEventListener('click', handleClickOutside)
  window.removeEventListener('keydown', handleDropdownKeydown)
})
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
