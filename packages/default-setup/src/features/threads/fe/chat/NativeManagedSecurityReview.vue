<template>
  <AlertDialogRoot :open="true">
    <AlertDialogPortal>
      <AlertDialogOverlay class="policy-overlay" />
      <AlertDialogContent class="policy-review" @open-auto-focus="focusChoice" @escape-key-down="rejectEscape">
        <header><p class="policy-eyebrow">Claude Code · Managed settings</p><AlertDialogTitle class="policy-title">{{ notice.title }}</AlertDialogTitle></header>
        <div class="policy-body" tabindex="0">
          <AlertDialogDescription as-child><p><NativePermissionText :text="notice.paragraphs[0]!" :ansi="notice.paragraphsAnsi[0]" /></p></AlertDialogDescription>
          <p v-for="(paragraph, index) in notice.paragraphs.slice(1)" :key="index"><NativePermissionText :text="paragraph" :ansi="notice.paragraphsAnsi[index + 1]" /></p>
        </div>
        <p v-if="problem" role="alert" class="policy-problem">{{ problem }}</p>
        <footer ref="actions">
          <button v-for="choice in renderedChoices" :key="choice.value" type="button" :data-policy-decision="choice.value" :disabled="pending" @click="emit('answer', choice.response)">{{ choice.label }}</button>
        </footer>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
<script setup lang="ts">
import { computed, nextTick, onUpdated, ref } from 'vue'
import { AlertDialogRoot, AlertDialogPortal, AlertDialogOverlay, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from 'reka-ui'
import type { ClaudeNativeNotice, ClaudeNativeNoticeResponse } from '#features/code/common/native-notice.ts'
import NativePermissionText from './NativePermissionText.vue'
const props = defineProps<{ notice: Extract<ClaudeNativeNotice, { kind: 'managed_settings_security' }>; pending?: boolean; problem?: string }>()
type PolicyResponse = ClaudeNativeNoticeResponse & { decision: 'policy_approve' | 'policy_reject' }
const emit = defineEmits<{ answer: [response: PolicyResponse] }>()
const snapshotIdentity = () => ({ id: props.notice.id, revision: props.notice.revision, sessionId: props.notice.sessionId })
let presented = snapshotIdentity()
onUpdated(() => { presented = snapshotIdentity() })
const renderedChoices = computed(() => props.notice.choices.map(choice => ({ ...choice, response: { ...snapshotIdentity(), decision: choice.value } })))
const actions = ref<HTMLElement>()
function focusChoice(event: Event) {
  event.preventDefault()
  void nextTick(() => actions.value?.querySelector<HTMLButtonElement>(`[data-policy-decision="${props.notice.preferredChoice}"]`)?.focus())
}
function rejectEscape(event: Event) { event.preventDefault(); if (!props.pending) emit('answer', { ...presented, decision: 'policy_reject' }) }
</script>
<style scoped>
.policy-overlay { position: fixed; inset: 0; z-index: 100; background: #0009; }
.policy-review { position: fixed; z-index: 101; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; width: min(40rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: hidden; border: 1px solid #ffffff20; border-radius: 14px; background: #1c1c1c; color: #eee; box-shadow: 0 24px 80px #0008; }
header { flex-shrink: 0; padding: 20px 20px 14px; border-bottom: 1px solid #ffffff12; }
.policy-eyebrow { margin: 0 0 6px; font-size: 11px; color: #c4a97c; }
.policy-title { margin: 0; font-size: 17px; font-weight: 600; }
.policy-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.policy-body p { margin: 0 0 16px; white-space: pre-wrap; }
.policy-body p:last-child { margin-bottom: 0; }
.policy-problem { margin: 0; padding: 0 20px 12px; color: #fca5a5; font-size: 12px; }
footer { display: flex; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid #ffffff12; }
button { min-height: 36px; padding: 8px 12px; border: 1px solid #ffffff20; border-radius: 8px; background: #ffffff08; color: inherit; font-size: 12px; white-space: normal; }
button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
button:disabled { opacity: .45; }
</style>
