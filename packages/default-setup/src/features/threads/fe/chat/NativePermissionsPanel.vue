<template>
  <section ref="root" role="dialog" aria-label="Claude Code permissions" aria-modal="false" tabindex="-1" data-native-command-panel class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900" @keydown.esc.stop.prevent="cancel">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div class="min-w-0"><p v-if="ownerLabel" class="mb-1 text-xs text-neutral-400">{{ ownerLabel }}</p><h2 class="text-sm font-medium text-neutral-200">{{ panel?.title ?? 'Permissions' }}</h2><p v-if="panel?.readOnly" class="mt-1 text-xs text-neutral-400">Read-only session rules</p></div>
      <button type="button" :disabled="pending" class="shrink-0 rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="cancel">{{ panel?.tabs.length ? 'Close permissions' : 'Back' }}</button>
    </header>
    <div v-if="tabs.length" role="tablist" aria-label="Permission categories" class="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
      <button v-for="tab in tabs" :key="tab.value" role="tab" type="button" :aria-selected="tab.selected" :disabled="pending" class="shrink-0 rounded-lg px-3 py-2 text-xs focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" :class="tab.selected ? 'bg-white/10 text-neutral-100' : 'text-neutral-400 hover:bg-white/5'" @click="operate(tab.revision, {action:'tab',value:tab.value})">{{ tab.label }}</button>
    </div>
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
      <p v-if="!panel && !state?.problem" role="status" class="text-sm text-neutral-400">Loading permission rules…</p>
      <label v-if="panel?.search !== undefined" class="block text-xs text-neutral-400">Search rules<input v-model="query" type="search" :disabled="pending" placeholder="Search permission rules…" class="mt-1 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @input="scheduleSearch" /></label>
      <div v-if="panel?.form" class="space-y-2">
        <label class="block text-xs text-neutral-400">{{ panel.form.placeholder }}<textarea v-if="panel.form.multiline" v-model="draft" :disabled="pending" :placeholder="panel.form.placeholder" rows="5" class="mt-1 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" /><input v-else v-model="draft" :disabled="pending" :placeholder="panel.form.placeholder" class="mt-1 w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" @keydown.enter.prevent="submit" /></label>
      </div>
      <div v-if="choices.length" role="group" aria-label="Permission choices" class="space-y-2">
        <button v-for="choice in choices" :key="choice.value" type="button" :disabled="pending || choice.disabled" class="block w-full whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 text-left text-sm text-neutral-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="operate(choice.revision, {action:'select',value:choice.value})"><NativeStatusText :text="choice.label" /></button>
      </div>
      <div class="space-y-2 text-xs leading-relaxed text-neutral-400"><p v-for="(text,index) in panel?.paragraphs" :key="index" class="whitespace-pre-wrap break-words"><NativeStatusText :text="text" /></p></div>
    </div>
    <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-2 text-xs">
      <p v-if="state?.problem" role="alert" class="min-w-0 flex-1 break-words text-amber-200">{{ state.problem }}</p><span v-else role="status" class="text-neutral-500">{{ pending ? 'Waiting for Claude Code…' : '' }}</span>
      <div class="flex flex-wrap gap-2"><button type="button" :disabled="pending" class="rounded px-2 py-2 text-neutral-400 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="emit('terminal')">Use terminal controls</button><button type="button" :disabled="pending" class="rounded px-2 py-2 text-neutral-400 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="read">Refresh</button><button v-if="panel?.form" type="button" :disabled="pending" class="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="submit">{{ panel.form.submitLabel }}</button></div>
    </footer>
  </section>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {ClaudeSettingsOperation,ClaudeSettingsView} from '#features/code/common/native-settings.ts'
import type {ClaudePermissionsOperation} from '#features/code/common/native-permissions.ts'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
const props=defineProps<{state?:ClaudeSettingsView;ownerLabel?:string}>()
const emit=defineEmits<{operate:[action:ClaudeSettingsOperation];terminal:[]}>()
const root=ref<HTMLElement>(),query=ref(''),draft=ref('')
const panel=computed(()=>props.state?.snapshot?.permissions),pending=computed(()=>props.state?.status==='pending')
const tabs=computed(()=>(panel.value?.tabs??[]).map(t=>({...t,revision:props.state!.snapshot!.revision})))
const choices=computed(()=>(panel.value?.choices??[]).map(c=>({...c,revision:props.state!.snapshot!.revision})))
function operate(revision:string,command:ClaudePermissionsOperation){if(!pending.value&&revision===props.state?.snapshot?.revision)emit('operate',{kind:'permissions',revision,command})}
function read(){if(!pending.value)emit('operate',{kind:'read'})}
function submit(){const revision=props.state?.snapshot?.revision;if(revision&&panel.value?.form)operate(revision,{action:'submit',value:draft.value})}
function cancel(){const revision=props.state?.snapshot?.revision;if(revision)operate(revision,{action:'cancel'})}
let searchTimer:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setInterval>|undefined
function scheduleSearch(){if(searchTimer)clearTimeout(searchTimer);const revision=props.state?.snapshot?.revision;if(revision)searchTimer=setTimeout(()=>operate(revision,{action:'search',value:query.value}),180)}
watch(()=>panel.value?.search,value=>{if(value!==undefined&&value!==query.value)query.value=value})
watch([()=>panel.value?.form?.value,()=>panel.value?.form?.placeholder,()=>panel.value?.title],([value])=>{draft.value=value??''},{immediate:true})
onMounted(()=>{if(document.hasFocus()&&(document.activeElement===document.body||document.activeElement?.closest('[data-onboarding-id="agent-chat-input"]')))root.value?.focus({preventScroll:true});read();timer=setInterval(()=>{if(!root.value?.contains(document.activeElement)||!document.activeElement?.matches('input,textarea'))read()},500)})
onBeforeUnmount(()=>{if(timer)clearInterval(timer);if(searchTimer)clearTimeout(searchTimer)})
</script>
