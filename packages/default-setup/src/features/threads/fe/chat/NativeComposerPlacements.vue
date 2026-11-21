<template>
  <div v-if="ordered.length" ref="root" class="min-w-0 space-y-1 py-1 text-xs text-neutral-400" :class="location === 'status' ? 'px-5' : ''" data-testid="native-composer-placements">
    <NativeTranscriptMessage v-for="frame in ordered" :key="frame.component + ':' + frame.uuid" :frame="frame" :data-native-placement="frame.component" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)">
      <template #engine><div v-if="frame.engineOutput" :role="frame.component === 'Spinner' ? 'status' : undefined" :aria-label="frame.component === 'Spinner' ? 'Claude activity' : frame.component === 'PromptHint' ? frame.nativeHint ? 'Native keyboard hint' : 'Claude prompt hint' : 'Claude session mode'" class="whitespace-pre-wrap break-words" :title="frame.component === 'PromptHint' && frame.nativeHint ? 'Keyboard hints for the native Claude interface' : undefined"><span v-if="frame.component === 'PromptHint' && frame.nativeHint" class="text-neutral-500">Native interface · </span><NativeStatusText :text="frame.engineOutput" /></div></template>
    </NativeTranscriptMessage>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
const props = defineProps<{ frames: ClaudeUiTranscriptFrame[]; location: 'status' | 'hint' | 'mode' }>()
const emit = defineEmits<{ press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent]; height: [height: number] }>()
const visible = (node: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiNode): boolean => node.kind === 'box' || node.kind === 'link' ? node.children.some(visible) : node.kind === 'text' ? !!node.text.trim() || !!node.children?.some(visible) : node.kind !== 'unsupported' || node.component !== 'engine'
const ordered = computed(() => props.frames.filter(frame => (props.location === 'hint' ? frame.component === 'PromptHint' : props.location === 'mode' ? frame.component === 'SessionMode' : frame.component === 'Spinner') && (frame.body.status !== 'live' || !!frame.engineOutput || visible(frame.body.tree))).sort((a,b) => ['Spinner','SessionMode','PromptHint'].indexOf(a.component) - ['Spinner','SessionMode','PromptHint'].indexOf(b.component)))
const root = ref<HTMLElement | null>(null)
let observer: ResizeObserver | undefined, lastHeight = -1
function reportHeight() {
  const height = Math.ceil(root.value?.getBoundingClientRect().height ?? 0)
  if (height !== lastHeight) { lastHeight = height; emit('height', height) }
}
watch(root, element => { observer?.disconnect(); if (element && typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(reportHeight); observer.observe(element) }; reportHeight() }, { flush: 'post' })
watch(ordered, () => { void nextTick(reportHeight) })
onBeforeUnmount(() => { observer?.disconnect(); emit('height', 0) })
</script>
