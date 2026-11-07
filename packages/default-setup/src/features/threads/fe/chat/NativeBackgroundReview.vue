<template>
  <section v-for="panel in panels" :key="panel.key" role="dialog" :aria-label="panel.review?.title || 'Background session review'" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#191919]" @keydown.esc.stop.prevent="answer(panel, 'cancel')">
    <header class="shrink-0 border-b border-white/10 px-4 py-3"><h3 class="text-sm font-medium text-neutral-200">{{ panel.review?.title || 'Background session' }}</h3></header>
    <div class="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3" tabindex="0" aria-label="Background session consequences">
      <p v-if="!panel.review" role="status" class="text-sm text-neutral-400">Waiting for Claude Code…</p>
      <p v-for="(paragraph, index) in panel.review?.paragraphs" :key="index" class="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300 [overflow-wrap:anywhere]">{{ paragraph }}</p>
      <p v-if="state?.problem" role="alert" class="text-sm text-amber-200">{{ state.problem }}</p>
    </div>
    <footer v-if="panel.review" class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3">
      <button ref="cancel" type="button" :disabled="panel.pending" class="rounded-lg border border-white/10 px-3 py-2 text-sm text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="answer(panel, 'cancel')">{{ panel.review.cancelLabel }}</button>
      <button ref="confirm" type="button" :disabled="panel.pending" class="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40" @click="answer(panel, 'confirm')">{{ panel.review.confirmLabel }}</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ClaudeBackgroundReviewState } from '#features/code/common/native-background.ts'
const props = defineProps<{ panelId: string; state?: ClaudeBackgroundReviewState }>()
const emit = defineEmits<{ answer: [request: { panelId: string; revision: string; decision: 'confirm' | 'cancel' }] }>()
const cancel = ref<HTMLButtonElement[]>(), confirm = ref<HTMLButtonElement[]>()
const panels = computed(() => [{ key: JSON.stringify([props.panelId, props.state?.review?.revision]), id: props.panelId, review: props.state?.review, pending: props.state?.status === 'pending' }])
function answer(panel: (typeof panels.value)[number], decision: 'confirm' | 'cancel') {
  if (!panel.review || props.state?.status === 'pending' || props.panelId !== panel.id || props.state?.review?.revision !== panel.review.revision) return
  emit('answer', { panelId: panel.id, revision: panel.review.revision, decision })
}
watch(() => props.state?.review?.revision, async revision => { if (!revision) return; await nextTick(); if (props.state?.review?.revision === revision) (props.state.review.defaultFocus === 'cancel' ? cancel.value?.[0] : confirm.value?.[0])?.focus({ preventScroll: true }) }, { immediate: true })
</script>
