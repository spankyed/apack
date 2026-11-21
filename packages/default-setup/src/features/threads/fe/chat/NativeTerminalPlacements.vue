<template>
  <div v-if="placements.length" class="min-w-0 space-y-1 text-xs text-neutral-400" :data-native-placement-band="component">
    <NativeTranscriptMessage v-for="frame in placements" :key="frame.uuid" :frame="frame" :data-native-placement="frame.component" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><div v-if="frame.engineOutput" class="whitespace-pre-wrap break-words"><NativeStatusText :text="frame.engineOutput" /></div></template>
    </NativeTranscriptMessage>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
const props = defineProps<{ frames?: ClaudeUiTranscriptFrame[]; component: 'TurnDuration' | 'InfoNotice'; messageId?: string }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
const visible = (node: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiNode): boolean => node.kind === 'box' || node.kind === 'link' ? node.children.some(visible) : node.kind === 'text' ? !!node.text.trim() || !!node.children?.some(visible) : node.kind !== 'unsupported' || node.component !== 'engine'
const placements = computed(() => (props.frames ?? []).filter(frame => frame.component === props.component && (props.messageId === undefined || frame.messageId === props.messageId) && (frame.body.status !== 'live' || !!frame.engineOutput || visible(frame.body.tree))))
</script>
