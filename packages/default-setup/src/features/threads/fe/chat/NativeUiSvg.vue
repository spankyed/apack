<template>
  <span v-if="!drawing" class="text-neutral-500" :data-native-plugin="node.plugin">{{ node.alt }}</span>
  <iframe v-else-if="node.interactive" :title="node.alt" sandbox="" referrerpolicy="no-referrer" :srcdoc="frame" :style="dimensions" class="max-w-full border-0" :data-native-plugin="node.plugin" />
  <img v-else :alt="node.alt" :src="image" :style="dimensions" class="max-w-full" :data-native-plugin="node.plugin" />
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ClaudeUiNode } from '#generated/types.ts'
import { prepareClaudeSvg } from './native-svg.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'svg' }> }>()
const drawing = computed(() => prepareClaudeSvg(props.node.source))
const image = computed(() => drawing.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing.value.source)}` : undefined)
const frame = computed(() => drawing.value ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:transparent}svg{display:block;max-width:100%;height:auto}</style>${drawing.value.source}` : undefined)
const dimensions = computed(() => ({ width: props.node.width === undefined ? undefined : `${props.node.width}px`, height: props.node.height === undefined ? 'auto' : `${props.node.height}px`, aspectRatio: drawing.value?.ratio?.toString() }))
</script>
