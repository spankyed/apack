<template>
  <section role="dialog" :aria-label="`Native /${name} panel`" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#191919]" @keydown.stop>
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
      <span class="text-xs text-neutral-300">/{{ name }} <span class="ml-2 text-neutral-500">Claude Code</span></span>
      <button type="button" class="rounded-lg px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5" @keydown.tab.prevent="terminal?.focus()" @click="emit('close')" @keydown.esc.prevent="emit('input', '\x1b')">Close panel</button>
    </header>
    <div ref="viewport" class="min-h-0 flex-1 overflow-hidden p-2" aria-label="Native command terminal" />
  </section>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { mountNativeTerminal } from './native-terminal-pool.ts'
const props = defineProps<{ name: string; ownerId: string; output: readonly { sequence: number; text: string }[] }>()
const emit = defineEmits<{ input: [text: string]; close: []; resize: [size: { columns: number; rows: number }] }>()
const viewport = ref<HTMLElement>()
let terminal: ReturnType<typeof mountNativeTerminal> | undefined, observer: ResizeObserver | undefined
watch(() => props.output, output => terminal?.write(output))
watch(viewport, async element => {
  if (!element) return
  await nextTick()
  if (viewport.value !== element) return
  terminal = mountNativeTerminal(props.ownerId, element, text => emit('input', text))
  terminal.write(props.output)
  observer = new ResizeObserver(() => { if (element.clientWidth && element.clientHeight) emit('resize', terminal!.fit()) })
  observer.observe(element); terminal.focus()
}, { flush: 'post' })
onBeforeUnmount(() => { observer?.disconnect(); terminal?.detach() })
</script>
<style scoped>
:deep(.xterm) { height: 100%; }
</style>
