<template>
  <div ref="site" :data-native-tool-activity="frame.component === 'ToolGroup' ? true : undefined" :data-native-tool-ids="frame.component === 'ToolGroup' ? frame.tools.map(tool => tool.id).join(' ') : undefined" :data-native-assistant="frame.component === 'AssistantMessage' && !frame.isSummary ? frame.uuid : undefined" :data-native-summary="frame.component === 'AssistantMessage' && frame.isSummary ? frame.uuid : undefined" :data-native-command-output="frame.component === 'CommandOutput' ? frame.uuid : undefined" :data-native-tool-group="frame.component === 'ToolGroup' ? frame.uuid : undefined" :data-native-tool-progress="frame.component === 'ToolProgress' ? frame.uuid : undefined" :data-native-tool-use="frame.component === 'ToolUse' ? frame.uuid : undefined" :data-native-tool-result="frame.component === 'ToolResult' ? frame.uuid : undefined" :data-native-user="frame.component === 'UserMessage' ? frame.uuid : undefined" class="min-w-0 outline-none" tabindex="-1"
    @compositionstart="composing = true" @compositionend="composing = false"
    @click="controlClick" @keydown="key" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave">
    <span v-if="reportLayout && ['ToolUse', 'ToolResult', 'ToolProgress', 'ToolGroup'].includes(frame.component)" ref="layoutCell" aria-hidden="true" class="pointer-events-none invisible absolute font-mono text-xs">0</span>
    <NativeUiNode v-if="frame.body.status === 'live'" :node="frame.body.tree" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><slot name="engine"><pre v-if="frame.component === 'CommandOutput'" class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed" :class="frame.isErrored ? 'text-red-300' : 'text-neutral-300'">{{ frame.displayText }}</pre><pre v-else-if="frame.component === 'AssistantMessage' && frame.isSummary" class="m-0 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-400">{{ frame.displayText }}</pre><TiptapEditor v-else mode="viewer" variant="chat" :model-value="frame.displayText" /></slot></template>
    </NativeUiNode>
    <template v-else><slot name="engine">
      <pre v-if="frame.component === 'CommandOutput'" class="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed" :class="frame.isErrored ? 'text-red-300' : 'text-neutral-300'">{{ frame.displayText }}</pre><pre v-else-if="frame.component === 'AssistantMessage' && frame.isSummary" class="m-0 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-400">{{ frame.displayText }}</pre><TiptapEditor v-else mode="viewer" variant="chat" :model-value="frame.displayText" />
      </slot><span v-if="frame.body.status === 'error'" role="status" class="text-xs text-neutral-500">Claude message controls unavailable</span>
    </template>
  </div>
</template>
<script setup lang="ts">
import { ref, provide, inject, watch, onBeforeUnmount } from 'vue'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeUiNode from './NativeUiNode.vue'
import { claudeTranscriptLayout } from './native-transcript-layout.ts'
import { createClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
const props = defineProps<{ frame: ClaudeUiTranscriptFrame }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
const hover = createClaudeHoverSurface(); provide(claudeHoverSurface, hover)
const site = ref<HTMLElement | null>(null), composing = ref(false)
const reportLayout = inject(claudeTranscriptLayout, undefined)
const layoutCell = ref<HTMLElement | null>(null)
watch(() => [site.value, props.frame.component, props.frame.uuid, props.frame.instanceRevision] as const, ([host, component, uuid, instanceRevision], _, cleanup) => {
  if (!host || !reportLayout || !['ToolUse', 'ToolResult', 'ToolProgress', 'ToolGroup'].includes(component)) return
  let queued: number | undefined, last = 0, alive = true
  const measure = () => {
    queued = undefined
    if (!alive || !host.isConnected || host.clientWidth <= 0) return
    const cell = layoutCell.value?.getBoundingClientRect().width ?? 0
    const box = getComputedStyle(host), width = host.clientWidth - parseFloat(box.paddingLeft || '0') - parseFloat(box.paddingRight || '0')
    if (cell <= 0 || width <= 0) return
    const columns = Math.max(20, Math.min(240, Math.floor(width / cell)))
    if (columns === last) return
    last = columns
    reportLayout({ component: component as 'ToolUse' | 'ToolResult' | 'ToolProgress' | 'ToolGroup', uuid, instanceRevision, columns })
  }
  const schedule = () => { if (queued === undefined && alive) queued = requestAnimationFrame(measure) }
  const observer = new ResizeObserver(schedule)
  observer.observe(host); schedule()
  cleanup(() => { alive = false; observer.disconnect(); if (queued !== undefined) cancelAnimationFrame(queued) })
}, { flush: 'post', immediate: true })
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
