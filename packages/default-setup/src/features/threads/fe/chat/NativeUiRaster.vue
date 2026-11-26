<template>
  <pre data-native-raster :data-native-plugin="node.plugin" :data-columns="node.columns" :data-rows="node.rows" class="m-0 max-w-full shrink-0 overflow-hidden whitespace-pre font-mono text-xs leading-5" :style="{ width: node.columns + 'ch', height: node.rows + 'lh' }"><span v-for="(span,index) in spans" :key="index" :style="span.style">{{ span.text }}</span></pre>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import {parseClaudeStatus} from '#extensions/blocks/display/native-status-text.ts'
import type {ClaudeUiNode} from '#features/code/be/services/claude-code/ui-presentation.ts'
const props=defineProps<{node:Extract<ClaudeUiNode,{kind:'raster'}>}>()
const spans=computed(()=>parseClaudeStatus(props.node.nativeAnsi))
</script>
