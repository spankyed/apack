<template>
  <div class="relative inline-flex">
    <!-- Conjoined container for both selectors -->
    <div
      v-if="!forcedMode"
      class="inline-flex min-w-0 overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] transition-colors"
    >
      <!-- Mode Selector (Left) -->
      <DropdownMenuRoot v-model:open="isModeOpen">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            :disabled="disabled"
            class="flex h-8 min-w-0 items-center gap-1.5 px-2.5 text-xs text-neutral-400 transition-colors"
            :class="modeButtonClasses"
            @contextmenu.prevent="onModeContextMenu"
          >
            <span class="font-medium truncate">{{ currentModeName }}</span>
            <ChevronDown
              :size="14"
              class="transition-transform"
              :class="{ 'rotate-180': isModeOpen }"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
          <DropdownMenuContent
            align="start"
            :side-offset="8"
            class="min-w-[140px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1 z-50"
          >
            <DropdownMenuItem
              v-for="mode in visibleModes"
              :key="mode.id"
              :disabled="mode.disabled"
              @select="handleModeSelect(mode.name)"
              class="relative flex items-center justify-between px-3 py-2 text-sm transition-colors focus:outline-none"
              :class="mode.disabled
                ? 'opacity-50 cursor-not-allowed text-neutral-500'
                : 'cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800'"
            >
              <span class="font-medium">{{ mode.name }}</span>
              <Check
                v-if="isCurrentMode(mode)"
                :size="16"
                class="text-blue-400"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>

      <!-- Divider (only when phases exist) -->
      <div
        v-if="hasPhases"
        class="w-px bg-white/[0.06]"
      />

      <!-- Phase Selector (Right, conditional) -->
      <DropdownMenuRoot v-if="hasPhases" v-model:open="isPhaseOpen">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            :disabled="disabled"
            class="flex h-8 min-w-0 items-center gap-1.5 px-2.5 text-xs text-neutral-400 transition-colors"
            :title="currentModeName === 'Claude Code' ? 'Phase for your next message' : undefined"
            :class="phaseButtonClasses"
            :style="phaseButtonStyle"
          >
            <span class="font-medium truncate">{{ currentPhaseName }}</span>
            <ChevronDown
              :size="14"
              class="transition-transform"
              :class="{ 'rotate-180': isPhaseOpen }"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuPortal>
          <DropdownMenuContent
            align="end"
            :side-offset="8"
            class="min-w-[140px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden z-50"
          >
            <DropdownMenuItem
              v-for="phase in currentModePhases"
              :key="phase.id"
              @select="handlePhaseSelect(phase.name)"
              class="relative flex items-center justify-between px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              :class="{ 'bg-neutral-800/50': currentPhase === phase.name }"
              :style="{ backgroundColor: phase.color ? `${phase.color}33` : undefined }"
            >
              <span class="flex items-center gap-2">
                <!-- <span
                  v-if="phase.color"
                  class="w-2 h-2 rounded-full shrink-0"
                  :style="{ backgroundColor: phase.color }"
                /> -->
                {{ phase.name }}
              </span>
              <Check
                v-if="isCurrentPhase(phase)"
                :size="16"
                class="text-blue-400"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>

    <!-- Forced mode indicator (non-interactive) -->
    <div
      v-if="forcedMode"
      class="px-3 py-2 h-7 flex items-center text-sm font-medium rounded-lg bg-neutral-800 text-neutral-400"
    >
      {{ forcedModeName }}
    </div>

    <!-- Default mode context menu -->
    <ContextMenuPopup
      :show="showContextMenu"
      :pos="contextMenuPos"
      :items="contextMenuItems"
      label="Set default mode"
      @close="showContextMenu = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
} from 'reka-ui'
import type { AgentMode } from '#generated/types.ts'
import ContextMenuPopup from '@apackdev/ui/design/ContextMenuPopup'
import { useContextMenu, type MenuItem } from '@apackdev/ui/composables/useContextMenu'

const props = defineProps<{
  modes: AgentMode[]
  currentMode: string
  currentPhase?: string
  /** Forced mode name for special threads. */
  forcedMode?: string
  disabled?: boolean
  /** The current default mode setting, used to show a check in the context menu. */
  defaultMode?: string
}>()

const emit = defineEmits<{
  (e: 'mode-change', mode: string): void
  (e: 'phase-change', phase: string): void
  (e: 'set-default-mode', mode: string): void
  (e: 'set-default-phase', phase: string): void
}>()

const isModeOpen = ref(false)
const isPhaseOpen = ref(false)

const visibleModes = computed(() => props.modes.filter(m => !m.hidden))

const isCurrentMode = (mode: AgentMode) => props.currentMode === mode.name
const isCurrentPhase = (phase: NonNullable<AgentMode['phases']>[number]) => props.currentPhase === phase.name

const currentModeData = computed(() => {
  return props.modes.find(m => m.name === props.currentMode)
})

const currentModePhases = computed(() => {
  return currentModeData.value?.phases || []
})

const hasPhases = computed(() => {
  return currentModePhases.value.length > 0
})

const currentModeName = computed(() => {
  return currentModeData.value?.name || 'Select mode'
})

const currentPhaseName = computed(() => {
  const phase = currentModePhases.value.find(p => p.name === props.currentPhase)
  return phase?.name || 'Select phase'
})

const currentPhaseColor = computed(() => {
  const phase = currentModePhases.value.find(p => p.name === props.currentPhase)
  return phase?.color
})

// 20%-alpha tint (adds '33' to a 6-char hex) so the button reads as a soft fill
// that still lets the neutral text stay legible.
const phaseButtonStyle = computed(() => {
  const c = currentPhaseColor.value
  return c ? { backgroundColor: `${c}33` } : null
})

const forcedModeName = computed(() => {
  const mode = props.modes.find(m => m.name === props.forcedMode)
  return mode?.name || 'Birth'
})

const modeButtonClasses = computed(() => {
  const hover = !props.disabled ? 'hover:bg-neutral-750' : ''
  const disabled = props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
  return `${hover} ${disabled}`
})

const phaseButtonClasses = computed(() => {
  const hover = !props.disabled ? 'hover:bg-neutral-750' : ''
  const disabled = props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
  return `${hover} ${disabled}`
})

const handleModeSelect = (modeName: string) => {
  const mode = props.modes.find(m => m.name === modeName)
  if (mode?.disabled) return
  emit('mode-change', modeName)
  isModeOpen.value = false
}

const handlePhaseSelect = (phaseName: string) => {
  emit('phase-change', phaseName)
  isPhaseOpen.value = false
}

// Context menu for setting default mode
const { showMenu: showContextMenu, menuPos: contextMenuPos, open: openContextMenu } = useContextMenu()

const contextMenuItems = computed<MenuItem[]>(() =>
  visibleModes.value
    .filter(m => !m.disabled)
    .map(mode => {
      const isDefault = mode.name === props.defaultMode
      return {
        label: mode.name,
        icon: Check,
        class: 'text-neutral-200',
        iconClass: isDefault ? 'text-blue-400' : 'text-transparent',
        action: () => {
          emit('set-default-mode', mode.name)
          if (mode.phases?.length) {
            emit('set-default-phase', mode.phases[0].name)
          }
        },
      }
    })
)

const onModeContextMenu = (e: MouseEvent) => {
  if (props.disabled || props.forcedMode) return
  openContextMenu(e, contextMenuItems.value.length, 36)
}
</script>
