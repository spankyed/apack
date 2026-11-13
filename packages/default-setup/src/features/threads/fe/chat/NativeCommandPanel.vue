<template>
  <section data-native-command-panel role="dialog" :aria-label="`Native /${name} panel`" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#191919]" @keydown.stop>
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
      <span class="min-w-0 truncate text-xs text-neutral-300" :title="ownerLabel">/{{ name }} <span class="ml-2 text-neutral-500">{{ ownerLabel ?? 'Claude Code' }}</span></span>
      <button type="button" class="rounded-lg px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5" @keydown.tab.prevent="terminal?.focus()" @click="emit('close')" @keydown.esc.prevent="emit('input', '\x1b')">Close panel</button>
    </header>
    <div ref="viewport" class="min-h-0 flex-1 overflow-hidden p-2" aria-label="Native command terminal" />
  </section>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { mountNativeTerminal } from './native-terminal-pool.ts'
const props = defineProps<{ name: string; ownerLabel?: string; ownerId: string; inputBlocked?: boolean; terminalSession?: import('#features/code/common/native-terminal.ts').ClaudeNativeTerminalSession }>()
const emit = defineEmits<{ input: [text: string]; close: []; resize: [size: import('#features/code/common/native-terminal.ts').ClaudeNativeTerminalSize] }>()
const viewport = ref<HTMLElement>()
let terminal: ReturnType<typeof mountNativeTerminal> | undefined
watch([viewport,()=>props.terminalSession?.id,()=>props.terminalSession?.target,()=>props.ownerId],async([element])=>{
 const session=props.terminalSession
 terminal?.detach();terminal=undefined
 if(!element||!session)return
 await nextTick()
 if(viewport.value!==element||props.terminalSession?.id!==session.id||props.terminalSession?.target!==session.target)return
 terminal=mountNativeTerminal(props.ownerId,session,element,size=>emit('resize',size),props.inputBlocked===true);terminal.setInputBlocked(props.inputBlocked===true);terminal.focus()
},{flush:'post'})
watch(()=>props.inputBlocked,blocked=>terminal?.setInputBlocked(blocked===true))
onBeforeUnmount(()=>terminal?.detach())
</script>
