<template>
  <div ref="site" :data-native-assistant="frame.uuid" class="min-w-0 outline-none" tabindex="-1"
    @compositionstart="composing = true" @compositionend="composing = false"
    @keydown="key" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave">
    <NativeUiNode v-if="frame.body.status === 'live'" :node="frame.body.tree" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><TiptapEditor mode="viewer" variant="chat" :model-value="frame.displayText" /></template>
    </NativeUiNode>
    <template v-else>
      <TiptapEditor mode="viewer" variant="chat" :model-value="frame.displayText" />
      <span v-if="frame.body.status === 'error'" role="status" class="text-xs text-neutral-500">Claude message controls unavailable</span>
    </template>
  </div>
</template>
<script setup lang="ts">
import { ref, provide, onBeforeUnmount } from 'vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import type { ClaudeUiAssistantFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeUiNode from './NativeUiNode.vue'
import { createClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
defineProps<{ frame: ClaudeUiAssistantFrame }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
const hover = createClaudeHoverSurface(); provide(claudeHoverSurface, hover)
const site = ref<HTMLElement | null>(null), composing = ref(false)
function key(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  if (event.key === 'Tab') event.stopPropagation()
  pressClaudeUiHotkey(event, site.value)
}
onBeforeUnmount(() => hover.dispose())
</script>
