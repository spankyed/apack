<template>
  <NativeEnvironmentEditor v-if="panel?.editor" :key="panel.editor.id" :editor="panel.editor" :state="state" :owner-label="ownerLabel" @operate="sendRequest" />
  <section v-else ref="root" role="dialog" aria-label="Claude Code permissions" aria-modal="false" tabindex="-1" data-native-command-panel class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900" @keydown.esc.stop.prevent="cancel">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div class="min-w-0"><p v-if="ownerLabel" class="mb-1 text-xs text-neutral-400">{{ ownerLabel }}</p><h2 class="text-sm font-medium text-neutral-200">{{ panel?.title ?? 'Permissions' }}</h2><p v-if="panel?.readOnly" class="mt-1 text-xs text-neutral-400">Read-only session rules</p></div>
      <button type="button" :disabled="pending" class="shrink-0 rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="cancel">{{ panel?.tabs.length ? hasDecisions ? 'Apply and close' : 'Close permissions' : 'Back' }}</button>
    </header>
    <div v-if="tabs.length" role="tablist" aria-label="Permission categories" class="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
      <button v-for="tab in tabs" :key="tab.value" :data-native-permission-revision="tab.revision" role="tab" type="button" :aria-selected="tab.selected" :disabled="pending" class="shrink-0 rounded-lg px-3 py-2 text-xs focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" :class="tab.selected ? 'bg-white/10 text-neutral-100' : 'text-neutral-400 hover:bg-white/5'" @click="operate(tab.revision, {action:'tab',value:tab.value})">{{ tab.label }}</button>
    </div>
    <div data-native-permission-body class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 [container-type:size]">
      <p v-if="!panel && !state?.problem" role="status" class="text-sm text-neutral-400">Loading permission rules…</p>
      <label v-if="panel?.search !== undefined" class="block text-xs text-neutral-400">Search rules<input :key="searchScope" v-model="query" :data-native-permission-search="searchScope" type="search" :disabled="searchDisabled" placeholder="Search permission rules…" class="mt-1 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @input.capture="searchInputChanged" @compositionstart.capture="searchCompositionStarted" @compositionend.capture="searchCompositionEnded" /></label>
      <div class="space-y-2 text-xs leading-relaxed text-neutral-400"><p v-for="(text,index) in panel?.paragraphs" :key="index" class="whitespace-pre-wrap break-words"><NativeStatusText :text="text" /></p></div>
      <div v-if="panel?.form" class="space-y-2">
        <label class="block text-xs text-neutral-400">{{ panel.form.placeholder }}<textarea v-if="panel.form.multiline" :key="formIdentity" :data-native-permission-form="formIdentity" v-model="draft" :disabled="formDisabled" :placeholder="panel.form.placeholder" rows="5" class="mt-1 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" @input.capture="formInputChanged" @compositionstart.capture="formCompositionStarted" @compositionend.capture="formCompositionEnded" @keydown.capture="formKeydown" /><input v-else ref="formInput" :key="formIdentity" :data-native-permission-form="formIdentity" v-model="draft" :disabled="formDisabled" :placeholder="panel.form.placeholder" :role="liveForm.active.value ? 'combobox' : undefined" :aria-autocomplete="liveForm.active.value ? 'list' : undefined" :aria-expanded="liveForm.active.value ? directorySuggestions.length > 0 : undefined" :aria-controls="liveForm.active.value ? directoryListId : undefined" :aria-activedescendant="activeSuggestionId" class="mt-1 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" @input.capture="formInputChanged" @keydown.capture="formKeydown" @compositionstart.capture="formCompositionStarted" @compositionend.capture="formCompositionEnded" /></label>
        <div v-if="directorySuggestions.length" :id="directoryListId" role="listbox" aria-label="Directory suggestions" class="max-h-[min(12rem,35cqh)] space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-neutral-950 p-1">
          <button v-for="(suggestion,index) in directorySuggestions" :id="directoryListId+'-'+index" :key="suggestion.value" type="button" role="option" tabindex="-1" :aria-selected="directorySelection === suggestion.value" :data-native-directory-suggestion="suggestion.value" class="block w-full whitespace-pre-wrap break-words rounded-md px-3 py-2 text-left text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" :class="directorySelection === suggestion.value ? 'bg-white/10' : 'hover:bg-white/5'" @mousedown.prevent @mouseenter="highlightedDirectory = suggestion.value" @click="liveForm.complete(suggestion.value)"><NativeStatusText :text="suggestion.label" /><span v-if="suggestion.description" class="ml-2 text-xs text-neutral-500">{{ suggestion.description }}</span></button>
        </div>
        <p v-if="directorySuggestions.length" class="text-xs text-neutral-500">↑/↓ to browse · Tab to complete · Enter to add</p>
        <p v-if="panel.form.live?.kind==='autoRule'" class="text-xs text-neutral-500">Enter to save · Shift+Enter for a new line</p>
        <p v-if="panel.form.live?.problem" role="alert" class="whitespace-pre-wrap break-words text-xs leading-relaxed text-amber-200"><NativeStatusText :text="panel.form.live.problem" /></p>
      </div>
      <p v-if="panel?.search && !choices.length && !pending" role="status" class="text-sm text-neutral-400">No matching rules.</p>
      <p v-if="hasDecisions" role="status" class="text-xs leading-relaxed text-amber-200">{{ panel?.decisions?.approved }} approved · {{ panel?.decisions?.retry }} scheduled for retry. These decisions take effect when you close permissions.</p>
      <div v-if="choices.length" role="group" aria-label="Permission choices" class="space-y-2">
        <div v-for="choice in choices" :key="choice.value" class="space-y-1">
        <button type="button" :aria-pressed="choice.approved" :data-native-permission-choice="choice.value" :data-native-permission-revision="choice.revision" :disabled="pending || choice.disabled" class="block w-full whitespace-pre-wrap break-words rounded-lg border border-white/10 text-left text-sm text-neutral-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" :class="choice.retryAvailable ? 'px-3 py-2' : 'p-3'" @click="operate(choice.revision, {action:'select',value:choice.value})"><span v-if="choice.approved!==undefined" class="mb-1 block text-xs" :class="choice.approved ? 'text-emerald-300' : 'text-neutral-400'">{{ choice.approved ? 'Approved' : 'Denied' }}{{ choice.retryScheduled ? ' · Retry scheduled' : '' }}</span><NativeStatusText :text="choice.label" /><span v-if="choice.description" class="mt-1 block text-xs leading-relaxed text-neutral-400"><NativeStatusText :text="choice.description" /></span></button>
        <button v-if="choice.retryAvailable" type="button" :disabled="pending || choice.disabled" :aria-label="(choice.retryScheduled ? 'Cancel retry for ' : 'Approve and retry ')+choice.label" class="rounded px-3 py-1.5 text-xs text-blue-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="operate(choice.revision,{action:'retry',value:choice.value})">{{ choice.retryScheduled ? 'Cancel retry' : 'Approve and retry' }}</button>
        </div>
      </div>

    </div>
    <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-2 text-xs">
      <p v-if="problem" role="alert" class="min-w-0 flex-1 break-words text-amber-200">{{ problem }}</p><span v-else role="status" class="text-neutral-500">{{ pending ? 'Waiting for Claude Code…' : '' }}</span>
      <div class="flex flex-wrap gap-2"><button type="button" :disabled="pending" class="rounded px-2 py-2 text-neutral-400 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="emit('terminal')">Use terminal controls</button><button type="button" :disabled="state?.status === 'pending' || !!transportFlight || !!liveForm.flight.value" class="rounded px-2 py-2 text-neutral-400 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="read">Refresh</button><button v-if="panel?.form" type="button" :disabled="liveForm.active.value ? !liveForm.canSubmit.value : pending" class="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="submit">{{ panel.form.submitLabel }}</button></div>
    </footer>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'
import type {ClaudeSettingsOperation,ClaudeSettingsRequest,ClaudeSettingsView} from '#features/code/common/native-settings.ts'
import type {ClaudePermissionsOperation} from '#features/code/common/native-permissions.ts'
import NativeEnvironmentEditor from './NativeEnvironmentEditor.vue'
import {useNativePermissionsForm} from './native-permissions-form.ts'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
const props=defineProps<{state?:ClaudeSettingsView;ownerLabel?:string}>()
const emit=defineEmits<{operate:[request:ClaudeSettingsRequest];terminal:[]}>()
const root=ref<HTMLElement>(),query=ref(''),draft=ref('')
const panel=computed(()=>props.state?.snapshot?.permissions)
const hasDecisions=computed(()=>!!(panel.value?.decisions?.approved||panel.value?.decisions?.retry))
const transportFlight=ref<ClaudeSettingsRequest>(),queuedAction=ref<{revision:string;command:ClaudePermissionsOperation}>(),localProblem=ref(''),suspendReads=ref(false)
const problem=computed(()=>props.state?.problem||localProblem.value)
const changedControls='Claude Code updated these controls. Review them and try again.'
function sendRequest(request:ClaudeSettingsRequest){localProblem.value='';transportFlight.value=request;emit('operate',request)}
function request(action:ClaudeSettingsOperation){sendRequest({requestId:crypto.randomUUID(),action})}
watch([()=>props.state?.requestId,()=>props.state?.status],([id,status])=>{
 if(id!==transportFlight.value?.requestId||status==='pending')return
 transportFlight.value=undefined
 const intent=queuedAction.value;queuedAction.value=undefined
 if(!intent)return
 if(status==='ready'&&!props.state?.problem&&intent.revision===props.state?.snapshot?.revision)dispatch(intent.revision,intent.command)
 else if(status!=='error'&&!props.state?.problem)localProblem.value=changedControls
})
const liveForm=useNativePermissionsForm(()=>props.state,sendRequest,draft,()=>!transportFlight.value&&!queuedAction.value)
const pending=computed(()=>props.state?.status==='pending'||!!transportFlight.value||liveForm.busy.value)
const reading=computed(()=>{const action=transportFlight.value?.action;return action?.kind==='read'||action?.kind==='permissions'&&action.command.action==='search'})
const searchDisabled=computed(()=>pending.value&&!reading.value)
const formIdentity=computed(()=>JSON.stringify([panel.value?.title,panel.value?.form?.placeholder,panel.value?.form?.live?.id]))
// One capture handler also fences Vue's model assignment on retired input elements.
function guardFormEvent(event:Event){const target=event.target as HTMLElement;if(!root.value?.contains(target)||target.dataset.nativePermissionForm!==formIdentity.value){event.stopImmediatePropagation();return false}return true}
const formDisabled=computed(()=>liveForm.active.value?liveForm.locked.value:pending.value)
const formInput=ref<HTMLInputElement>(),directoryListId='native-directory-'+useId(),highlightedDirectory=ref('')
const directorySuggestions=liveForm.suggestions
const directorySelection=computed(()=>directorySuggestions.value.find(item=>item.value===highlightedDirectory.value)?.value??directorySuggestions.value.find(item=>item.value===panel.value?.form?.live?.selectedValue)?.value??directorySuggestions.value[0]?.value??'')
const activeSuggestionId=computed(()=>{const index=directorySuggestions.value.findIndex(item=>item.value===directorySelection.value);return index<0?undefined:directoryListId+'-'+index})
watch(activeSuggestionId,async id=>{if(!id)return;await nextTick();const option=root.value?.querySelector<HTMLElement>('[id="'+id+'"]');option?.scrollIntoView?.({block:'nearest'})})
function formInputChanged(event:Event){if(!guardFormEvent(event))return;if(!(event as InputEvent).isComposing&&!liveForm.composing.value){highlightedDirectory.value='';liveForm.change((event.target as HTMLInputElement).value)}}
function formCompositionStarted(event:CompositionEvent){if(guardFormEvent(event))liveForm.composition(true)}
function formCompositionEnded(event:CompositionEvent){if(!guardFormEvent(event))return;highlightedDirectory.value='';liveForm.composition(false);liveForm.change((event.target as HTMLInputElement).value)}
function formKeydown(event:KeyboardEvent){
 if(!guardFormEvent(event))return
 if(event.isComposing||liveForm.composing.value){if(event.key==='Escape')event.stopPropagation();return}
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();return}
 const suggestions=directorySuggestions.value
 if(suggestions.length&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();const index=suggestions.findIndex(item=>item.value===directorySelection.value);highlightedDirectory.value=suggestions[(index+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length]!.value;return}
 if(suggestions.length&&event.key==='Tab'&&!event.shiftKey){event.preventDefault();liveForm.complete(directorySelection.value||suggestions[0]!.value);return}
 if(event.key==='Enter'&&panel.value?.form?.multiline&&event.shiftKey)return
 if(event.key==='Enter'){event.preventDefault();submit()}
}
watch(()=>liveForm.flight.value,async(value,previous)=>{if(!value&&previous?.action.action==='complete'&&previous.scope===panel.value?.form?.live?.id){await nextTick();if(previous.scope===panel.value?.form?.live?.id&&document.hasFocus()&&root.value?.contains(document.activeElement))formInput.value?.focus({preventScroll:true})}})
const tabs=computed(()=>(panel.value?.tabs??[]).map(t=>({...t,revision:props.state!.snapshot!.revision})))
const choices=computed(()=>(panel.value?.choices??[]).map(c=>({...c,revision:props.state!.snapshot!.revision})))
function dispatch(revision:string,command:ClaudePermissionsOperation){if(command.action==='cancel'&&panel.value?.tabs.length)suspendReads.value=true;request({kind:'permissions',revision,command})}
function operate(revision:string,command:ClaudePermissionsOperation){
 if(revision!==props.state?.snapshot?.revision){localProblem.value=changedControls;return}
 // Retain one explicit click in the gap before a read's disabled DOM is painted; never retry a mutation.
 if(reading.value){if(!queuedAction.value)queuedAction.value={revision,command};return}
 if(!pending.value)dispatch(revision,command)
}
function read(){if(panel.value?.editor)return;if(props.state?.status!=='pending'&&!transportFlight.value&&!liveForm.flight.value){suspendReads.value=false;request({kind:'read'})}}
function submit(){if(liveForm.active.value){liveForm.submit();return}const revision=props.state?.snapshot?.revision;if(revision&&panel.value?.form)operate(revision,{action:'submit',value:draft.value})}
function cancel(){if(liveForm.cancel())return;const revision=props.state?.snapshot?.revision;if(revision)operate(revision,{action:'cancel'})}
watch([()=>panel.value?.defaultFocusValue,()=>panel.value?.title,()=>panel.value?.choices.find(c=>c.value===panel.value?.defaultFocusValue)?.disabled,()=>pending.value],async([value])=>{if(typeof value!=='string'||!value||pending.value)return;await nextTick();if(pending.value||!document.hasFocus()||document.activeElement?.matches('input,textarea')||document.activeElement!==document.body&&!root.value?.contains(document.activeElement))return;const button=[...root.value!.querySelectorAll<HTMLButtonElement>('[data-native-permission-choice]')].find(e=>e.dataset.nativePermissionChoice===value);button?.focus({preventScroll:true})},{immediate:true})
let searchTimer:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setInterval>|undefined
const searchScope=computed(()=>panel.value?.searchScope),searchComposing=ref(false)
type SearchIntent={scope:string;value:string;ready:boolean;sent:boolean}
let searchIntent:SearchIntent|undefined
function flushSearch(){const intent=searchIntent,revision=props.state?.snapshot?.revision;if(!intent||!intent.ready||intent.sent||pending.value||searchComposing.value||!revision)return;if(intent.scope!==searchScope.value){searchIntent=undefined;return}intent.sent=true;operate(revision,{action:'search',scope:intent.scope,value:intent.value})}
function scheduleSearch(){if(searchTimer)clearTimeout(searchTimer);if(searchComposing.value)return;const scope=searchScope.value;if(scope===undefined)return;const intent:SearchIntent=searchIntent={scope,value:query.value,ready:false,sent:false};searchTimer=setTimeout(()=>{if(searchIntent!==intent)return;intent.ready=true;flushSearch()},180)}
function guardSearchEvent(event:Event){const target=event.target as HTMLInputElement;if(!root.value?.contains(target)||target.dataset.nativePermissionSearch!==searchScope.value){event.stopImmediatePropagation();return false}return true}
function searchInputChanged(event:Event){if(!guardSearchEvent(event))return;query.value=(event.target as HTMLInputElement).value;if(!(event as InputEvent).isComposing&&!searchComposing.value)scheduleSearch()}
function searchCompositionStarted(event:CompositionEvent){if(!guardSearchEvent(event))return;searchComposing.value=true;if(searchTimer)clearTimeout(searchTimer)}
function searchCompositionEnded(event:CompositionEvent){if(!guardSearchEvent(event))return;searchComposing.value=false;query.value=(event.target as HTMLInputElement).value;scheduleSearch()}
watch(searchScope,()=>{searchIntent=undefined;searchComposing.value=false;if(searchTimer)clearTimeout(searchTimer);query.value=panel.value?.search??''})
watch([()=>panel.value?.search,()=>props.state?.snapshot?.revision,()=>props.state?.status,()=>!!transportFlight.value],([value])=>{if(searchIntent&&searchIntent.sent&&value===searchIntent.value)searchIntent=undefined;if(!searchComposing.value&&!searchIntent&&typeof value==='string'&&value!==query.value)query.value=value;flushSearch()})
onMounted(()=>{if(document.hasFocus()&&(document.activeElement===document.body||document.activeElement?.closest('[data-onboarding-id="agent-chat-input"]')))root.value?.focus({preventScroll:true});read();timer=setInterval(()=>{if(!suspendReads.value&&!problem.value&&props.state?.status==='ready'&&!searchIntent&&!searchComposing.value&&!liveForm.busy.value&&!liveForm.composing.value&&(liveForm.active.value&&props.state?.status==='ready'||!root.value?.contains(document.activeElement)||!document.activeElement?.matches('input,textarea')))read()},500)})
onBeforeUnmount(()=>{if(timer)clearInterval(timer);if(searchTimer)clearTimeout(searchTimer)})
</script>
