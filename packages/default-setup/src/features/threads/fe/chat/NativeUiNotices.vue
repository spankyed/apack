<template>
  <section v-if="notices.statuses.length || visibleToasts.length" @keydown.tab.stop aria-label="Native plugin notices" class="shrink-0 space-y-2 border-b border-white/[0.05] bg-[#202022] px-5 py-3 text-xs" aria-live="polite" aria-relevant="additions text">
    <div v-for="notice in notices.statuses" :key="notice.plugin" class="flex min-w-0 gap-2 leading-5" data-native-plugin-status>
      <span class="shrink-0 text-neutral-500">{{ notice.plugin }}</span>
      <span class="min-w-0 whitespace-pre-wrap break-words text-neutral-300">{{ notice.text }}</span>
    </div>
    <div v-for="toast in visibleToasts" :key="toast.id" class="flex min-w-0 items-start gap-2 rounded-lg border border-blue-300/10 bg-blue-300/[0.04] px-3 py-2 leading-5" data-native-toast
      @pointerenter="hold(toast.id, 'pointer', true)" @pointerleave="hold(toast.id, 'pointer', false)" @focusin="hold(toast.id, 'focus', true)"
      @focusout="leaveFocus($event, toast.id)">
      <div class="min-w-0 flex-1"><span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{{ toast.plugin }}</span><p class="whitespace-pre-wrap break-words text-neutral-200">{{ toast.text }}</p></div>
      <button type="button" class="shrink-0 rounded p-1 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" aria-label="Dismiss native notification" @click="emit('operate', { kind: 'dismiss', id: toast.id })"><X :size="12" /></button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import type { ClaudeUiNotices, ClaudeUiNoticeEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
const props = defineProps<{ notices: ClaudeUiNotices }>()
const emit = defineEmits<{ operate: [event: ClaudeUiNoticeEvent] }>()
const visibleToasts = computed(() => props.notices.toasts.slice(-3))
const held = new Map<string, Set<string>>()
function hold(id: string, source: string, value: boolean) {
  const sources = held.get(id) ?? new Set<string>(), before = sources.size > 0
  if (value) sources.add(source); else sources.delete(source)
  if (sources.size) held.set(id, sources); else held.delete(id)
  if (before !== (sources.size > 0)) emit('operate', { kind: 'hold', id, isHeld: sources.size > 0 })
}
function leaveFocus(event: FocusEvent, id: string) { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) hold(id, 'focus', false) }
function release(id: string) { if (held.delete(id)) emit('operate', { kind: 'hold', id, isHeld: false }) }
watch(visibleToasts, values => { const ids = new Set(values.map(toast => toast.id)); for (const id of [...held.keys()]) if (!ids.has(id)) release(id) })
onBeforeUnmount(() => { for (const id of [...held.keys()]) release(id) })
</script>
