import { computed, onUnmounted, ref, watch } from 'vue'
import type { ClaudeSettingsOperation, ClaudeSettingsView } from '#features/code/common/native-settings.ts'
type EditorCommand = Extract<ClaudeSettingsOperation,{kind:'editor'}>['command']
/** One live native form per owned panel; coalesce drafts without turning an edit into submission. */
export function useNativeSettingsForm(state:()=>ClaudeSettingsView|undefined,emit:(action:ClaudeSettingsOperation)=>void){
 const flight=ref<{action:ClaudeSettingsOperation;baseRequest?:string}>(),submit=ref<Record<string,string>>(),cancel=ref(false),closing=ref(false),resetEpoch=ref(0)
 const edits=new Map<string,string>();let scope:string|undefined,disposed=false,scheduled=false
 const form=computed(()=>{const editor=state()?.snapshot?.editor;return editor?.kind==='form'&&editor.live?editor:undefined})
 const editing=computed(()=>flight.value?.action.kind==='editor'&&flight.value.action.command.action==='change'&&!submit.value&&!cancel.value)
 const busy=computed(()=>!!flight.value||!!submit.value||cancel.value||closing.value)
 const canSubmit=computed(()=>!closing.value&&!state()?.snapshot?.commitPending&&!submit.value&&!cancel.value&&(state()?.status==='ready'&&!flight.value||editing.value))
 function clear(){closing.value=false;edits.clear();submit.value=undefined;cancel.value=false;flight.value=undefined}
 function send(action:ClaudeSettingsOperation){flight.value={action,baseRequest:state()?.requestId};emit(action)}
 function schedule(){if(scheduled||disposed)return;scheduled=true;queueMicrotask(()=>{scheduled=false;drain()})}
 function drain(){
  const view=state(),snapshot=view?.snapshot,current=form.value
  if(disposed||closing.value||flight.value||!current||current.live!.id!==scope||!snapshot)return
  if(view?.status==='error'){if(cancel.value)send({kind:'read'});return}
  if(view?.status!=='ready'||snapshot.commitPending)return
  const operation=(command:EditorCommand)=>send({kind:'editor',revision:snapshot.revision,editorRevision:current.revision,command})
  if(cancel.value){cancel.value=false;operation({action:'cancel'});return}
  if(submit.value){const values=submit.value;submit.value=undefined;edits.clear();operation({action:'save',values});return}
  for(const [key,value]of edits){edits.delete(key);if(current.fields.find(field=>field.key===key)?.value===value)continue;operation({action:'change',formId:current.live!.id,key,value});return}
 }
 function handle(command:EditorCommand){
  const current=form.value;if(!current||disposed)return false
  if(closing.value)return true
  if(command.action==='change'){
   if(command.formId!==current.live!.id||!current.fields.some(field=>field.key===command.key)||submit.value||cancel.value||flight.value?.action.kind==='editor'&&['save','cancel'].includes(flight.value.action.command.action))return true
   edits.set(command.key,command.value);schedule();return true
  }
  if(command.action==='save'){
   if(!canSubmit.value)return true
   submit.value={...command.values};edits.clear();schedule();return true
  }
  if(command.action==='cancel'){if(flight.value?.action.kind==='editor'&&flight.value.action.command.action==='cancel')return true;cancel.value=true;submit.value=undefined;edits.clear();schedule();return true}
  return false
 }
 watch(()=>[state()?.requestId,state()?.status,form.value?.live?.id,form.value?.revision] as const,([request,status,id])=>{
  if(id!==scope){clear();scope=id;resetEpoch.value++;return}
  const pending=flight.value
  if(pending&&request!==pending.baseRequest&&status!=='pending'){
   flight.value=undefined
   if(status==='error'){const recoverCancel=cancel.value&&pending.action.kind==='editor'&&pending.action.command.action==='change';edits.clear();submit.value=undefined;if(!recoverCancel)cancel.value=false}
   else if(pending.action.kind==='editor'){if(pending.action.command.action==='save')resetEpoch.value++;else if(pending.action.command.action==='cancel')closing.value=true}
  }
  if(status==='error')closing.value=false
  schedule()
 },{immediate:true})
 onUnmounted(()=>{disposed=true;clear()})
 return {handle,busy,editing,canSubmit,resetEpoch}
}
