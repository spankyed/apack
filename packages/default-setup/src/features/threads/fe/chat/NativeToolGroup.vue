<template>
  <NativeTranscriptMessage :frame="frame" @press="press" @field="field">
    <template #engine>
      <div v-if="frame.engineOutput !== undefined" class="whitespace-pre-wrap break-words text-xs"><NativeStatusText :text="frame.engineOutput" /></div>
      <p v-else-if="!expanded" class="my-1 text-xs text-neutral-400">{{ label }}</p>
      <ToolActivityBlock v-if="expanded && frame.tools.length" :entries="frame.tools" :label="label" :state="frame.isActive ? 'streaming' : 'done'" :native-expansion="expanded" :skip-native-groups="true" :native-grouped="true" />
      <ToolActivityBlock v-for="artifact in frame.artifacts" :key="artifact.artifactId" :entries="[]" label="" state="done" :artifact-ref="artifact" :skip-native-groups="true" :native-grouped="true" />
    </template>
  </NativeTranscriptMessage>
</template>
<script setup lang="ts">
import { computed, inject } from 'vue'
import { claudeToolDrawings } from '#extensions/blocks/display/native-tool-drawings.ts'
import ToolActivityBlock from '#extensions/blocks/display/ToolActivityBlock.vue'
import { computeLabel } from '#extensions/blocks/display/tool-activity-label.ts'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeTranscriptMessage from './NativeTranscriptMessage.vue'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
const props=defineProps<{frame:Extract<ClaudeUiTranscriptFrame,{component:'ToolGroup'}>}>()
const bridge=inject(claudeToolDrawings,undefined)
const emit=defineEmits<{press:[id:string,href?:string];field:[event:ClaudeUiFieldEvent]}>()
function press(id:string,href?:string){if(bridge)bridge.press(id,href);else emit('press',id,href)}
function field(event:ClaudeUiFieldEvent){if(bridge)bridge.field(event);else emit('field',event)}
const expanded=computed(()=>props.frame.groupExpanded??props.frame.isExpanded)
const label=computed(()=>computeLabel(props.frame.tools,props.frame.isActive?'streaming':'done'))
</script>
