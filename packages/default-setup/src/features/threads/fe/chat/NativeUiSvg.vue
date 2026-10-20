<template>
  <span v-if="!drawing" class="text-neutral-500" :data-native-plugin="node.plugin">{{ node.alt }}</span>
  <span v-else-if="node.interactive" class="relative inline-grid min-w-0 max-w-full self-start" :data-native-plugin="node.plugin">
    <img alt="" aria-hidden="true" :src="image" :style="dimensions" class="invisible block max-w-full" />
    <iframe :title="node.alt" sandbox="" referrerpolicy="no-referrer" :srcdoc="frame" class="absolute inset-0 h-full w-full border-0" />
  </span>
  <img v-else :alt="node.alt" :src="image" :style="dimensions" class="max-w-full" :data-native-plugin="node.plugin" />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ClaudeUiNode } from '#generated/types.ts'
import { prepareClaudeSvg } from './native-svg.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'svg' }> }>()
const drawing = computed(() => prepareClaudeSvg(props.node.source))
const image = computed(() => drawing.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing.value.source)}` : undefined)
const frame = computed(() => drawing.value ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}svg{display:block}</style>${drawing.value.frameSource}` : undefined)
const dimensions = computed(() => ({ width: props.node.width === undefined ? undefined : `${props.node.width}px`, height: props.node.height === undefined ? 'auto' : `${props.node.height}px`, aspectRatio: drawing.value?.ratio?.toString() }))
</script>
