<template>
  <div data-native-image class="native-image shrink-0 overflow-hidden font-mono text-xs leading-5" :style="{ width: `${node.columns}ch`, height: `${node.rows}lh`, maxWidth: '100%' }" :data-native-plugin="node.plugin">
    <img v-if="node.format === 'png' && !failed" :src="`data:image/png;base64,${node.data}`" :alt="node.alt" class="block h-full w-full" @error="failed = true" />
    <canvas v-else-if="node.format === 'rgba'" ref="canvas" role="img" :aria-label="node.alt" class="block h-full w-full" />
    <span v-if="failed" class="text-xs text-neutral-500">{{ node.alt }}</span>
  </div>
</template>
<script setup lang="ts">
import {ref,watchPostEffect} from 'vue'
import type {ClaudeUiNode} from '#features/code/be/services/claude-code/ui-presentation.ts'
const props=defineProps<{node:Extract<ClaudeUiNode,{kind:'image'}>}>(),canvas=ref<HTMLCanvasElement>(),failed=ref(false)
watchPostEffect(()=>{
 failed.value=false
 const node=props.node,target=canvas.value
 if(node.format!=='rgba'||!target||!node.width||!node.height)return
 target.width=node.width;target.height=node.height
 const data=Uint8ClampedArray.from(atob(node.data),value=>value.charCodeAt(0))
 target.getContext('2d')?.putImageData(new ImageData(data,node.width,node.height),0,0)
})
</script>
