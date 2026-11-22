<template>
  <div
    class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-neutral-800/60 border border-neutral-700/30 rounded font-mono text-xs text-neutral-400 cursor-pointer hover:bg-neutral-700/60 transition-colors group"
    @click="copy"
  >
    <span class="text-neutral-600 select-none">$</span>
    <span ref="commandRef"><slot /></span>
    <Copy v-if="!copied" class="w-3 h-3 text-neutral-600 group-hover:text-neutral-400 transition-colors shrink-0" />
    <Check v-else class="w-3 h-3 text-green-400 shrink-0" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Copy, Check } from 'lucide-vue-next'

const commandRef = ref<HTMLElement>()
const copied = ref(false)

function copy() {
  const text = commandRef.value?.textContent?.trim()
  if (!text) return
  navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}
</script>
