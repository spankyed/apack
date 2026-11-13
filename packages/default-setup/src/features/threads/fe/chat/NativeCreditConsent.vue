<template>
 <div ref="root" data-native-command-panel class="native-credit-consent">
  <NativeSettingsPanel :key="panelKey" class="native-credit-panel" subject="credits" :state="state" @operate="operate" />
 </div>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref} from 'vue'
import NativeSettingsPanel from './NativeSettingsPanel.vue'
import {claudeCreditOperation} from '#features/code/common/native-credit.ts'
import type {ClaudeNativeNotice,ClaudeNativeNoticeResponse} from '#features/code/common/native-notice.ts'
import type {ClaudeSettingsOperation,ClaudeSettingsView} from '#features/code/common/native-settings.ts'
import {describeClaudeUiProblem} from '#features/code/common/native-ui-problem.ts'
const props=defineProps<{
 notice:Extract<ClaudeNativeNotice,{kind:'fable_overage_consent_prompt'}>
 answer?:{id:string;revision:string;requestId?:string;status:'pending'|'done'|'error';problem?:string}
}>()
const emit=defineEmits<{answer:[response:ClaudeNativeNoticeResponse]}>()
const root=ref<HTMLElement>(),previous=document.activeElement
const acknowledgement=computed(()=>props.answer?.id===props.notice.id&&props.answer.revision===props.notice.revision?props.answer:undefined)
const state=computed<ClaudeSettingsView>(()=>({
 requestId:acknowledgement.value?.requestId??'initial',
 status:acknowledgement.value?.status==='pending'?'pending':acknowledgement.value?.status==='error'?'error':'ready',
 snapshot:props.notice.snapshot,
 ...(acknowledgement.value?.status==='error'?{problem:describeClaudeUiProblem(acknowledgement.value.problem)}:{}),
}))
const panelKey=computed(()=>{const editor=props.notice.snapshot.editor;return editor?.kind==='form'&&editor.live?editor.live.id:props.notice.snapshot.revision})
function operate(operation:ClaudeSettingsOperation){
 const checked=claudeCreditOperation.safeParse(operation)
 if(!checked.success||state.value.status==='pending')return
 if(checked.data.kind==='editor'&&(checked.data.revision!==props.notice.snapshot.revision||checked.data.editorRevision!==props.notice.snapshot.editor?.revision))return
 emit('answer',{id:props.notice.id,revision:props.notice.revision,sessionId:props.notice.sessionId,decision:'credit',credit:{requestId:crypto.randomUUID(),operation:checked.data}})
}
onBeforeUnmount(()=>{if(root.value?.contains(document.activeElement)&&previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true})})
</script>
<style scoped>
.native-credit-consent { min-height: 0; }
.native-credit-consent :deep(.native-credit-panel) { margin: 0 0 8px; flex: none; max-height: min(32rem, 55vh); }
</style>
