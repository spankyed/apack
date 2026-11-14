<template>
  <div data-native-image class="shrink-0 overflow-hidden font-mono text-xs leading-5" :style="{ width: `${node.columns}ch`, height: `${node.rows}lh`, maxWidth: '100%' }" :data-native-plugin="node.plugin">
    <canvas v-if="picture" ref="canvas" role="img" :aria-label="node.alt" class="block h-full w-full" />
    <span v-else class="text-neutral-500">{{ node.alt }}</span>
  </div>
</template>
<script setup lang="ts">
import { ref, shallowRef, watch, watchPostEffect } from 'vue'
import { observeNativeTerminalImage, type TerminalPicture } from '#extensions/terminal/pool.ts'
import type { ClaudeUiNode } from '#features/code/be/services/claude-code/ui-presentation.ts'
const props = defineProps<{ node: Extract<ClaudeUiNode, { kind: 'broker-image' }> }>()
const canvas = ref<HTMLCanvasElement>(), picture = shallowRef<TerminalPicture | null>(null)
watch(() => [props.node.terminalSession.id, props.node.terminalSession.target, props.node.imageId] as const, (_value, _previous, cleanup) => {
  picture.value = null
  cleanup(observeNativeTerminalImage(props.node.terminalSession, props.node.imageId, value => { picture.value = value }))
}, { immediate: true })
watchPostEffect(() => {
  const image = picture.value, target = canvas.value
  if (!image || !target) return
  target.width = image.width; target.height = image.height
  target.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0)
})
</script>
