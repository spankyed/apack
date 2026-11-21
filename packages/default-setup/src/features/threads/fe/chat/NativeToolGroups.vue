<template>
  <div class="min-w-0">
    <template v-for="part in parts" :key="part.kind === 'group' ? part.frame.uuid : part.ids.join(':')">
      <NativeToolGroup v-if="part.kind === 'group'" :frame="part.frame" />
      <slot v-else :ids="part.ids" />
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, inject } from 'vue'
import { claudeToolDrawings } from '#extensions/blocks/display/native-tool-drawings.ts'
import type { ClaudeUiTranscriptFrame } from '#features/code/be/services/claude-code/ui-presentation.ts'
import NativeToolGroup from './NativeToolGroup.vue'
const props=defineProps<{toolUseIds:readonly string[]}>()
const bridge=inject(claudeToolDrawings,undefined)
type GroupFrame=Extract<ClaudeUiTranscriptFrame,{component:'ToolGroup'}>
const parts=computed(()=>{
 const groups=(bridge?.frames.value??[]).filter((frame):frame is GroupFrame=>frame.component==='ToolGroup'&&frame.body.status==='live')
 const result:({kind:'group';frame:GroupFrame}|{kind:'fallback';ids:string[]})[]=[]
 for(const id of props.toolUseIds){
  const group=groups.find(frame=>frame.tools.some(tool=>tool.id===id))
  if(group){if(group.tools[0]?.id===id)result.push({kind:'group',frame:group});continue}
  const last=result.at(-1);if(last?.kind==='fallback')last.ids.push(id);else result.push({kind:'fallback',ids:[id]})
 }
 return result
})
</script>
