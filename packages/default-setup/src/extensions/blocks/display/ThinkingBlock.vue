<template>
  <div class="rounded-lg border border-neutral-700 bg-neutral-800/40 overflow-hidden">
    <!-- Header row: chevron + icon + label + streaming dots -->
    <button
      type="button"
      class="w-full flex items-baseline gap-2 px-3 py-2 text-left hover:bg-neutral-700/40 transition-colors"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <ChevronRight
        class="w-4 h-4 text-neutral-400 flex-shrink-0 self-center transition-transform"
        :class="{ 'rotate-90': isOpen }"
      />
      <Brain class="w-4 h-4 text-neutral-400 flex-shrink-0 self-center" />
      <span class="text-sm text-neutral-200 truncate shrink">{{ label }}</span>
      <span v-if="state === 'streaming'" class="flex gap-1 flex-shrink-0 self-baseline" aria-hidden>
        <span class="w-1 h-1 rounded-full bg-neutral-500 streaming-dot" style="animation-delay: 0ms" />
        <span class="w-1 h-1 rounded-full bg-neutral-500 streaming-dot" style="animation-delay: 150ms" />
        <span class="w-1 h-1 rounded-full bg-neutral-500 streaming-dot" style="animation-delay: 300ms" />
      </span>
    </button>

    <!-- Expanded: scrollable thinking text -->
    <div
      v-if="isOpen"
      ref="contentEl"
      class="border-t border-neutral-700 max-h-80 overflow-y-auto px-3 py-2"
      @scroll="onScroll"
    >
      <slot><pre class="text-xs text-neutral-400 whitespace-pre-wrap font-sans leading-relaxed m-0">{{ content }}</pre></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { ChevronRight, Brain } from 'lucide-vue-next'

interface Props {
  content: string
  label: string
  state: 'streaming' | 'done'
  defaultOpen?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: true,
})

const isOpen = ref(props.defaultOpen)
const emit = defineEmits<{ view: [open: boolean] }>()
watch(isOpen, open => emit('view', open), { immediate: true })
onBeforeUnmount(() => emit('view', false))
const contentEl = ref<HTMLElement | null>(null)
let userHasScrolled = false

// Auto-scroll to bottom while streaming (same pattern as ToolActivityBlock)
watch(
  () => props.content,
  async () => {
    if (!isOpen.value || props.state !== 'streaming' || userHasScrolled) return
    await nextTick()
    const el = contentEl.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  if (!atBottom) userHasScrolled = true
  else userHasScrolled = false
}
</script>

<style scoped>
.streaming-dot {
  animation: streaming-pulse 1.2s ease-in-out infinite;
}
@keyframes streaming-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
</style>
