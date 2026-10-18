<template>
  <div ref="site" :data-native-assistant="frame.component === 'AssistantMessage' && !frame.isSummary ? frame.uuid : undefined" :data-native-summary="frame.component === 'AssistantMessage' && frame.isSummary ? frame.uuid : undefined" :data-native-command-output="frame.component === 'CommandOutput' ? frame.uuid : undefined" :data-native-user="frame.component === 'UserMessage' ? frame.uuid : undefined" class="min-w-0 outline-none" tabindex="-1"
    @compositionstart="composing = true" @compositionend="composing = false"
    @click="controlClick" @keydown="key" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave">
    <NativeUiNode v-if="frame.body.status === 'live'" :node="frame.body.tree" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><pre v-if="frame.component === 'CommandOutput'" class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed" :class="frame.isErrored ? 'text-red-300' : 'text-neutral-300'">{{ frame.displayText }}</pre><pre v-else-if="frame.component === 'AssistantMessage' && frame.isSummary" class="m-0 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-400">{{ frame.displayText }}</pre><TiptapEditor v-else mode="viewer" variant="chat" :model-value="frame.displayText" /></template>
    </NativeUiNode>
    <template v-else>
      <pre v-if="frame.component === 'CommandOutput'" class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed" :class="frame.isErrored ? 'text-red-300' : 'text-neutral-300'">{{ frame.displayText }}</pre><pre v-else-if="frame.component === 'AssistantMessage' && frame.isSummary" class="m-0 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-400">{{ frame.displayText }}</pre><TiptapEditor v-else mode="viewer" variant="chat" :model-value="frame.displayText" />
      <span v-if="frame.body.status === 'error'" role="status" class="text-xs text-neutral-500">Claude message controls unavailable</span>
    </template>
  </div>
</template>
<script setup lang="ts">
import { ref, provide, onBeforeUnmount } from 'vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeUiNode from './NativeUiNode.vue'
import { createClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
defineProps<{ frame: ClaudeUiTranscriptFrame }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
const hover = createClaudeHoverSurface(); provide(claudeHoverSurface, hover)
const site = ref<HTMLElement | null>(null), composing = ref(false)
function controlClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) event.stopPropagation()
}
function key(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  if (event.key === 'Tab') event.stopPropagation()
  pressClaudeUiHotkey(event, site.value)
}
onBeforeUnmount(() => hover.dispose())
</script>
