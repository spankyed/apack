<template>
  <div ref="root" class="question-drawing" tabindex="-1" @keydown="key" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave">
    <NativeUiNode v-if="frame?.body.status === 'live' && frame.shownInput && frame.token" :node="frame.body.tree" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><NativeQuestionPanel :key="frame.messageId" :card="frame.shownInput" :presentation="frame.presentation" :render-token="frame.token" :disabled="disabled" :error="error" @started="emit('started', $event)" @respond="emit('respond', $event)" @pause="emit('pause')" /></template>
    </NativeUiNode>
    <section v-else role="status" class="p-4 text-xs text-neutral-400">{{ frame?.body.status === 'error' ? frame.body.message : 'Loading native question…' }}</section>
  </div>
</template>
<script setup lang="ts">
import { ref, provide, onBeforeUnmount } from 'vue'
import type { ClaudeUiQuestionFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeQuestionAnswer } from '#features/code/common/native-question.ts'
import NativeUiNode from './NativeUiNode.vue'
import NativeQuestionPanel from './NativeQuestionPanel.vue'
import { useClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
defineProps<{ frame?: ClaudeUiQuestionFrame; disabled: boolean; error?: string }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent]; started: [token?: string]; respond: [answer: ClaudeQuestionAnswer]; pause: [] }>()
const hover = useClaudeHoverSurface(); provide(claudeHoverSurface, hover)
const root = ref<HTMLElement | null>(null)
function key(event: KeyboardEvent) { if (!event.isComposing) pressClaudeUiHotkey(event, root.value) }
onBeforeUnmount(() => hover.dispose())
</script>
<style scoped>
.question-drawing { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; outline:none; }
.question-drawing > :deep(.native-box) { display:flex; flex-direction:column; height:100%; min-height:0; }
</style>
