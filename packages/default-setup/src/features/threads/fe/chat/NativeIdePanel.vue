<template>
  <section ref="root" role="dialog" aria-label="Claude Code IDE connection" aria-modal="false" tabindex="-1" data-native-command-panel class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900" @keydown.esc.stop.prevent="closePanel">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div class="min-w-0"><p v-if="ownerLabel" class="mb-1 text-xs text-neutral-400">{{ ownerLabel }}</p><h2 class="text-sm font-medium text-neutral-200">{{ ide?.title ?? 'IDE connection' }}</h2><p v-if="ide?.description" class="mt-1 text-xs leading-relaxed text-neutral-400">{{ ide.description }}</p></div>
      <button type="button" :disabled="pending" class="shrink-0 rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="closePanel">{{ ide?.stage === 'enable' ? 'Cancel IDE confirmation' : 'Close IDE selection' }}</button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <p v-if="!ide && !state?.problem" role="status" class="text-sm text-neutral-400">Loading IDE choices…</p>
      <div class="space-y-2" role="group" aria-label="IDE choices" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)">
        <button v-for="option in choices" :key="option.revision + ':' + option.value" :ref="element => setChoice(option.value, element)" type="button" :disabled="pending || ide?.disabled" :aria-pressed="ide?.selectedValue === option.value" :data-native-ide-choice="option.value" class="block w-full rounded-lg border px-3 py-3 text-left text-sm text-neutral-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" :class="ide?.selectedValue === option.value ? 'border-blue-400/50 bg-blue-400/10' : 'border-white/10'" @click="choose(option)">
          <span class="block break-words">{{ option.label }}</span><span v-if="option.description" class="mt-1 block whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-400">{{ option.description }}</span>
        </button>
      </div>
      <p v-if="cancelRequested && ide?.stage === 'enable'" role="status" class="mt-3 text-xs leading-relaxed text-neutral-300">This confirmation is still open. Choose Yes or No to continue.</p>
      <div class="mt-3 space-y-2 text-xs leading-relaxed text-neutral-400" :role="ide?.stage === 'connecting' ? 'status' : undefined"><p v-for="(text,index) in ide?.paragraphs" :key="index" class="whitespace-pre-wrap break-words">{{ text }}</p></div>
    </div>
    <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-4 py-2 text-xs">
      <p v-if="state?.problem" role="alert" class="min-w-0 break-words text-amber-200">{{ state.problem }}</p><span v-else role="status" class="text-neutral-500">{{ pending ? 'Waiting for Claude Code…' : ide?.stage === 'connecting' ? 'Connecting…' : '' }}</span>
      <button type="button" :disabled="pending" class="shrink-0 rounded px-2 py-1 text-neutral-400 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" @click="read">Refresh IDE choices</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import type {ComponentPublicInstance} from 'vue'
import type {ClaudeSettingsOperation,ClaudeSettingsView} from '#features/code/common/native-settings.ts'
const props=defineProps<{state?:ClaudeSettingsView;ownerLabel?:string}>()
const emit=defineEmits<{operate:[action:ClaudeSettingsOperation];close:[]}>()
const cancelRequested=ref(false)
const root=ref<HTMLElement>(),buttons=new Map<string,HTMLElement>()
const ide=computed(()=>props.state?.snapshot?.ide),pending=computed(()=>props.state?.status==='pending')
const choices=computed(()=>(ide.value?.options??[]).map(option=>({...option,revision:props.state!.snapshot!.revision})))
function setChoice(value:string,element:Element|ComponentPublicInstance|null){if(element instanceof HTMLElement)buttons.set(value,element);else buttons.delete(value)}
function closePanel(){cancelRequested.value=true;emit('close')}
function read(){if(!pending.value)emit('operate',{kind:'read'})}
function choose(option:{value:string;revision:string}){if(!pending.value&&!ide.value?.disabled&&option.revision===props.state?.snapshot?.revision)emit('operate',{kind:'ideSelect',revision:option.revision,value:option.value})}
function move(direction:number){const enabled=[...buttons.values()].filter(button=>!button.hasAttribute('disabled')),index=enabled.indexOf(document.activeElement as HTMLElement);enabled[(index+direction+enabled.length)%enabled.length]?.focus()}
watch(()=>ide.value?.stage,async()=>{cancelRequested.value=false;await nextTick();if(!document.hasFocus()||!root.value?.contains(document.activeElement))return;(buttons.get(ide.value?.selectedValue??'')??buttons.values().next().value)?.focus({preventScroll:true})})
let timer:ReturnType<typeof setInterval>|undefined
onMounted(()=>{if(document.hasFocus()&&(document.activeElement===document.body||document.activeElement?.closest('[data-onboarding-id="agent-chat-input"]')))root.value?.focus({preventScroll:true});read();timer=setInterval(read,500)})
onBeforeUnmount(()=>{if(timer)clearInterval(timer);buttons.clear()})
</script>
