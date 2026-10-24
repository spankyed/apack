<template>
  <dialog ref="dialog" class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg bg-transparent p-0 text-neutral-200 backdrop:bg-black/60" @cancel.prevent="$emit('close')">
    <section role="dialog" aria-modal="true" aria-labelledby="claude-channel-title" class="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-xl">
      <div class="min-h-0 overflow-y-auto p-5">
        <h2 id="claude-channel-title" class="text-base font-semibold">Claude channels</h2>
        <p class="mt-2 text-sm text-neutral-400">Choose the configured channel servers or approved plugins for this conversation. Claude decides which can connect.</p>
        <label for="claude-channel-selectors" class="mt-4 block text-sm">One server or plugin selector per line</label>
        <textarea id="claude-channel-selectors" v-model="text" :disabled="locked" rows="5" autofocus class="mt-2 w-full resize-y rounded-md border border-white/15 bg-neutral-950 p-3 font-mono text-sm" placeholder="plugin:name@marketplace" />
        <p v-if="locked" role="status" class="mt-2 text-sm text-amber-300">Stop the native session and wait for current work to finish before changing channels.</p>
        <p v-else class="mt-2 text-xs text-neutral-400">Leave empty to select no channels. Saved selection applies when the conversation starts or resumes.</p>
        <p v-if="problem" role="alert" class="mt-2 text-sm text-red-300">{{ problem }}</p>
      </div>
      <footer class="flex shrink-0 justify-end gap-2 border-t border-white/10 p-3">
        <button type="button" class="rounded-md px-3 py-2 text-sm hover:bg-white/10" @click="$emit('close')">Cancel</button>
        <button type="button" class="rounded-md bg-blue-600 px-3 py-2 text-sm disabled:opacity-40" :disabled="locked" @click="save">Save channels</button>
      </footer>
    </section>
  </dialog>
</template>
<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {copyClaudeChannelSelection} from '#features/code/common/native-channels.ts'
const props=defineProps<{channels:string[];locked:boolean}>()
const emit=defineEmits<{close:[];save:[channels:string[]]}>()
const text=ref(props.channels.join('\n')),problem=ref(''),dialog=ref<HTMLDialogElement>()
onMounted(()=>dialog.value?.showModal())
onBeforeUnmount(()=>dialog.value?.close())
function save(){if(props.locked)return;try{emit('save',copyClaudeChannelSelection(text.value.split('\n').map(value=>value.trim()).filter(Boolean)));problem.value=''}catch(error){problem.value=error instanceof Error?error.message:String(error)}}
</script>
