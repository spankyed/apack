<template>
  <section role="dialog" aria-label="Claude Code help" aria-modal="false" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900" @keydown.esc.stop.prevent="emit('close')">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 p-4">
      <div class="min-w-0"><p v-if="ownerLabel" class="mb-1 text-xs text-neutral-400">{{ ownerLabel }}</p><h2 class="text-sm font-medium text-neutral-200">Claude Code help</h2></div>
      <button type="button" class="shrink-0 rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400" @click="emit('close')">Close help</button>
    </header>
    <nav v-if="help" aria-label="Claude Code help tabs" class="flex shrink-0 flex-wrap gap-1 border-b border-white/10 px-3 py-2">
      <button v-for="tab in help.tabs" :key="tab" type="button" :aria-current="help.selectedTab === tab ? 'page' : undefined" :disabled="pending" class="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50" :class="help.selectedTab === tab ? 'bg-white/10 text-white' : ''" @click="select(tab)">{{ tab }}</button>
    </nav>
    <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-4" tabindex="0" :aria-label="help?.selectedTab || 'Help content'">
      <p v-if="!help && !state?.problem" role="status" class="text-sm text-neutral-400">Loading Claude Code help…</p>
      <dl v-if="help?.commands.length" class="divide-y divide-white/10">
        <div v-for="command in help.commands" :key="command.name" class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:gap-4">
          <dt class="min-w-0 break-words font-mono text-sm text-neutral-200">{{ command.label }}</dt><dd class="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-400">{{ command.description }}</dd>
        </div>
      </dl>
      <div v-else class="space-y-2 text-sm leading-relaxed text-neutral-300"><p v-for="(text,index) in help?.paragraphs" :key="index" class="whitespace-pre-wrap break-words">{{ text }}</p></div>
      <a v-for="url in help?.links" :key="url" :href="url" @click.prevent="openLink(url)" @auxclick.middle.prevent="openLink(url)" class="mt-4 block break-all text-sm text-blue-400 underline">{{ url }}</a>
    </div>
    <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-4 py-2 text-xs">
      <p v-if="state?.problem" role="alert" class="break-words text-amber-200">{{ state.problem }}</p><span v-else role="status" class="text-neutral-500">{{ pending ? 'Waiting for Claude Code…' : help?.selectedTab }}</span>
      <button type="button" :disabled="pending" class="shrink-0 rounded-lg px-3 py-2 text-neutral-300 hover:bg-white/5 disabled:opacity-50" @click="emit('operate',{kind:'read'})">Refresh</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import {computed,onMounted} from 'vue'
import {openLink} from '@apackdev/sdk/fe'
import type {ClaudeSettingsOperation,ClaudeSettingsView} from '#features/code/common/native-settings.ts'
const props=defineProps<{state?:ClaudeSettingsView;ownerLabel?:string}>()
const emit=defineEmits<{operate:[action:ClaudeSettingsOperation];close:[]}>()
const help=computed(()=>props.state?.snapshot?.help)
const pending=computed(()=>props.state?.status==='pending')
function select(tab:'General'|'Commands'|'Custom commands'){
  if(!pending.value&&props.state?.snapshot)emit('operate',{kind:'helpTab',revision:props.state.snapshot.revision,tab})
}
onMounted(()=>emit('operate',{kind:'read'}))
</script>
