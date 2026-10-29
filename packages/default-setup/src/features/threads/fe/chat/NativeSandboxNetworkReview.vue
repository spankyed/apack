<template>
  <section class="sandbox-review" aria-label="Claude sandbox network request" data-native-notice="sandbox_network_access" @keydown.esc.stop.prevent="cancel">
    <div class="sandbox-review__body" tabindex="0">
      <h3>{{ notice.title }}</h3>
      <p v-for="(paragraph, index) in notice.paragraphs" :key="index">{{ paragraph }}</p>
    </div>
    <p v-if="problem" role="alert" class="sandbox-review__problem">{{ problem }}</p>
    <footer>
      <button v-for="choice in renderedChoices" :key="choice.value" type="button" :disabled="pending" @click="emit('answer', choice.response)">{{ choice.label }}</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, onUpdated } from 'vue'
import type { ClaudeNativeNotice, ClaudeNativeNoticeResponse } from '#features/code/common/native-notice.ts'
const props = defineProps<{ notice: Extract<ClaudeNativeNotice, { kind: 'sandbox_network_access' }>; pending?: boolean; problem?: string }>()
const emit = defineEmits<{ answer: [response: ClaudeNativeNoticeResponse] }>()
const identity = () => ({ id: props.notice.id, revision: props.notice.revision, sessionId: props.notice.sessionId })
let presented = identity()
onUpdated(() => { presented = identity() })
const renderedChoices = computed(() => props.notice.choices.map(choice => ({ ...choice, response: { ...identity(), decision: choice.value } })))
function cancel() { if (!props.pending) emit('answer', { ...presented, decision: 'sandbox_cancel' }) }
</script>
<style scoped>
.sandbox-review { flex-shrink: 0; margin: 8px 16px; padding: 12px; border: 1px solid #ffffff16; border-radius: 10px; background: #202022; color: #c9c5bf; font-size: 12px; }
.sandbox-review__body { max-height: min(14rem, 23vh); overflow-y: auto; overscroll-behavior: contain; overflow-wrap: anywhere; }
h3 { margin: 0 0 8px; font-size: 13px; color: #eee; }
p { margin: 0 0 8px; white-space: pre-wrap; line-height: 1.5; }
footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 8px; }
button { max-width: 100%; min-height: 32px; padding: 5px 10px; border: 1px solid #ffffff16; border-radius: 7px; background: #ffffff05; color: inherit; font-size: 11px; white-space: normal; overflow-wrap: anywhere; }
button:focus-visible { outline: 2px solid #d3aa8e; outline-offset: 3px; }
button:disabled { opacity: .4; }
.sandbox-review__problem { color: #fca5a5; }
</style>
