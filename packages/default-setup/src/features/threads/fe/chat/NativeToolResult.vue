<template>
  <NativeTranscriptMessage v-if="frame" :frame="frame" @press="(id, href) => bridge?.press(id, href)" @field="bridge?.field($event)">
    <template #engine>
      <pre v-if="frame.engineOutput !== undefined" data-native-tool-format class="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs"><span v-for="(part, index) in engineParts" :key="index" :style="part.style">{{ part.text }}</span></pre>
      <pre v-else-if="frame.outputRewritten" class="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-neutral-300">{{ frame.displayText }}</pre>
      <slot v-else />
    </template>
  </NativeTranscriptMessage>
  <slot v-else />
</template>
<script setup lang="ts">
import { computed, inject } from 'vue'
import { claudeToolResults } from '#extensions/blocks/display/native-tool-results.ts'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import { parseClaudeStatus } from '#extensions/blocks/display/native-status-text.ts'
const props = defineProps<{ toolUseId: string }>()
const bridge = inject(claudeToolResults, undefined)
const frame = computed(() => bridge?.frames.value.find(frame => frame.component === 'ToolResult' && frame.uuid === props.toolUseId))
const engineParts = computed(() => parseClaudeStatus(frame.value?.engineOutput ?? ''))
</script>
