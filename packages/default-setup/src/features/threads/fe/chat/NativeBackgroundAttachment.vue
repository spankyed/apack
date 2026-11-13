<template>
  <section aria-label="Background Claude terminal" class="child-terminal">
    <header>
      <div><h3>Background session</h3><p :title="attachment.state?.cwd">{{ attachment.status === 'opening' ? 'Opening connection…' : attachment.state?.status === 'exited' ? 'Connection ended' : attachment.status === 'error' ? 'Connection unavailable' : 'Connected to Claude' }}</p></div>
      <button type="button" @click="emit('close', attachment.requestId)">{{ attachment.status === 'opening' ? 'Cancel' : 'Close connection' }}</button>
    </header>
    <p v-if="attachment.problem" role="alert">{{ attachment.problem }}</p>
    <div v-if="attachment.state" ref="viewport" class="child-terminal__viewport" aria-label="Background Claude output" />
    <p class="child-terminal__hint">Closing the terminal does not stop a running background session. Use Stop to end it.</p>
  </section>
</template>
<script setup lang="ts">
import {ref, watch, nextTick, onBeforeUnmount} from 'vue'
import type {ClaudeBackgroundAttachmentView} from '#features/threads/be/claude-terminal-views.ts'
import {mountNativeTerminal} from './native-terminal-pool.ts'
const props = defineProps<{attachment: ClaudeBackgroundAttachmentView}>()
const emit = defineEmits<{close:[requestId:string]; input:[attachmentId:string,text:string]; resize:[attachmentId:string,size:import('#features/code/common/native-terminal.ts').ClaudeNativeTerminalSize]}>()
const viewport = ref<HTMLElement>()
let terminal: ReturnType<typeof mountNativeTerminal> | undefined, attached: string | undefined
function detach() {terminal?.detach();terminal=undefined;attached=undefined}
watch(() => props.attachment.state, async state => {
  if (!state) {detach();return}
  await nextTick()
  if (!viewport.value || props.attachment.state?.id !== state.id) return
  if (attached !== state.id) {
    detach();attached=state.id
    terminal=mountNativeTerminal(state.id,state.terminalSession,viewport.value,size=>{if(props.attachment.state?.id===state.id)emit('resize',state.id,size)},state.inputBlocked===true)
    terminal.focus()
  }
  terminal?.setInputBlocked(state.inputBlocked===true)
},{immediate:true,flush:'post'})
onBeforeUnmount(detach)
</script>
<style scoped>
.child-terminal {display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;color:#dedbd7}
header {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 0}
h3 {font-size:13px;font-weight:600;margin:0} p {font-size:11px;color:#aaa59e;line-height:1.5;overflow-wrap:anywhere}
button {min-height:30px;padding:5px 9px;border:1px solid #ffffff26;border-radius:7px;font-size:11px}button:focus-visible {outline:2px solid #8cabe8;outline-offset:2px}
.child-terminal__viewport {flex:1;min-height:144px;min-width:0;overflow:hidden;padding:10px;background:#191919;border:1px solid #ffffff1a;border-radius:10px}
.child-terminal__hint {padding:8px 0;margin:0}
</style>
