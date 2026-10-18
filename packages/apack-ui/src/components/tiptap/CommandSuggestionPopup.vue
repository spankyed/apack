<template>
  <Teleport to="body">
    <div
      v-if="isPopupVisible"
      ref="popupEl"
      class="command-suggestion-popup"
      :style="popupStyle"
    >
      <div
        v-for="(cmd, index) in filteredCommands"
        :key="cmd.name"
        class="command-suggestion-item"
        :class="{ 'is-selected': index === selectedIndex }"
        @mousedown.prevent="selectCommand(cmd)"
        @mouseenter="selectedIndex = index"
      >
        <span class="command-suggestion-name">/{{ cmd.name }}</span>
      </div>
      <ClaudeCompletionRows :offer="nativeOffer" :selected-index="selectedIndex - filteredCommands.length" @hover="selectedIndex = filteredCommands.length + $event" />
      <div v-if="filteredCommands.length === 0" class="command-suggestion-empty">
        No matching commands
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import ClaudeCompletionRows from './ClaudeCompletionRows.vue'
import { getClaudeCompletionOffer } from './claude-completions.ts'
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { Editor } from '@tiptap/core'
import { commandSuggestionKey, COMMAND_TRIGGER_POS } from './extensions/command-suggestion.ts'
import { useCommandItems } from './composables/useCommandItems.ts'
import type { PackCommand } from '@apackdev/sdk/commands'

const props = defineProps<{
  editor: Editor
}>()

const nativeOffer = computed(() => getClaudeCompletionOffer(props.editor).value)
const selectedIndex = ref(-1)
const popupEl = ref<HTMLElement | null>(null)
const popupStyle = ref<Record<string, string>>({ bottom: '0px', left: '0px' })

const suggestionState = computed(() => {
  return props.editor ? commandSuggestionKey.getState(props.editor.state) : undefined
})

const isActive = computed(() => suggestionState.value?.active ?? false)
const query = computed(() => suggestionState.value?.query ?? '')
const selectedCommand = computed(() => suggestionState.value?.selectedCommand ?? null)

const isPopupVisible = computed(() => isActive.value && !selectedCommand.value)

const { commands: filteredCommands } = useCommandItems(query)

watch(filteredCommands, () => {
  selectedIndex.value = filteredCommands.value.length ? 0 : -1
}, { immediate: true })
watch(() => nativeOffer.value?.id, () => {
  nextTick(updatePosition)
  if (selectedIndex.value >= filteredCommands.value.length) selectedIndex.value = filteredCommands.value.length ? 0 : -1
})

function updatePosition() {
  if (!isPopupVisible.value || !suggestionState.value) return

  try {
    const coords = props.editor.view.coordsAtPos(COMMAND_TRIGGER_POS)
    popupStyle.value = {
      bottom: `${window.innerHeight - coords.top + 4}px`,
      left: `${coords.left}px`,
    }
  } catch {
    // Position might be invalid during transitions
  }
}

watch(isPopupVisible, (visible) => {
  if (visible) {
    nextTick(updatePosition)
  }
})

onMounted(() => {
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})

function handleClickOutside(event: MouseEvent) {
  if (!isPopupVisible.value) return
  const target = event.target as Node
  if (popupEl.value?.contains(target)) return
  const tr = props.editor.state.tr
  tr.setMeta(commandSuggestionPluginKey, { deactivate: true })
  props.editor.view.dispatch(tr)
}

watch(isPopupVisible, (visible) => {
  if (visible) {
    document.addEventListener('mousedown', handleClickOutside, true)
  } else {
    document.removeEventListener('mousedown', handleClickOutside, true)
  }
})

function scrollToSelected() {
  nextTick(() => {
    popupEl.value?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  })
}

function handleKeyDown(event: KeyboardEvent) {
  if (!isPopupVisible.value) return

  const maxIndex = filteredCommands.value.length + (nativeOffer.value?.rows.length ?? 0) - 1

  switch (event.key) {
    case 'Escape':
      nativeOffer.value?.dismiss()
      break

    case 'ArrowDown':
      event.preventDefault()
      event.stopPropagation()
      selectedIndex.value = Math.min(selectedIndex.value + 1, maxIndex)
      scrollToSelected()
      break

    case 'ArrowUp':
      event.preventDefault()
      event.stopPropagation()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      scrollToSelected()
      break

    case 'Enter':
    case 'Tab':
    case 'ArrowRight':
      event.preventDefault()
      event.stopPropagation()
      {
        const cmd = filteredCommands.value[selectedIndex.value]
        if (cmd) selectCommand(cmd)
        else nativeOffer.value?.rows[selectedIndex.value - filteredCommands.value.length]?.select()
      }
      break

  }
}

watch(isPopupVisible, (visible) => {
  try {
    if (visible) {
      props.editor.view.dom.addEventListener('keydown', handleKeyDown, true)
    } else {
      props.editor.view.dom.removeEventListener('keydown', handleKeyDown, true)
    }
  } catch (err) {
    console.warn('[command-suggestion-popup] failed to (un)register keydown listener', err)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  try {
    props.editor.view.dom.removeEventListener('keydown', handleKeyDown, true)
  } catch (err) {
    console.warn('[command-suggestion-popup] failed to remove keydown listener', err)
  }
  document.removeEventListener('mousedown', handleClickOutside, true)
})

function selectCommand(cmd: PackCommand) {
  const state = suggestionState.value
  if (!state) return

  const from = COMMAND_TRIGGER_POS
  const to = props.editor.state.selection.head
  const commandText = `/${cmd.name} `

  const { tr } = props.editor.state
  tr.replaceWith(from, to, props.editor.state.schema.text(commandText))
  tr.setMeta(commandSuggestionKey, {
    active: true,
    query: '',
    selectedCommand: cmd,
  })

  props.editor.view.dispatch(tr)
  selectedIndex.value = 0
}


</script>

<style scoped>
.command-suggestion-popup {
  position: fixed;
  z-index: 9999;
  min-width: 220px;
  max-width: 320px;
  max-height: 280px;
  overflow-y: auto;
  background: rgb(30 30 30);
  border: 1px solid rgb(64 64 64);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 4px;
}

.command-suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 0.85rem;
  color: rgb(212 212 212);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.command-suggestion-item.is-selected {
  background: rgb(55 55 55);
  color: rgb(245 245 245);
}

.command-suggestion-name {
  font-weight: 500;
  flex-shrink: 0;
}

.command-suggestion-empty {
  padding: 8px 10px;
  font-size: 0.8rem;
  color: rgb(115 115 115);
  text-align: center;
}
</style>
