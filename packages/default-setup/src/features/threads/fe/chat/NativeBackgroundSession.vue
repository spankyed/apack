<template>
  <section v-for="panel in panels" :key="panel.key" aria-label="Background Claude session" class="background-session">
    <div class="background-session__body">
      <h3>{{ panel.session?.name || 'Background session' }}</h3>
      <p role="status">{{ panel.label }}</p>
      <p v-if="panel.session?.waitingFor" class="background-session__detail">{{ panel.session.waitingFor }}</p>
      <p v-if="panel.problem" role="alert" class="background-session__problem">{{ panel.problem }}</p>
    </div>
    <form v-if="canReply && replyOpen && panel.session?.pid && ['working','blocked'].includes(panel.session.state)" class="background-session__reply" @submit.prevent="reply(panel.target, panel.session)">
      <label :for="replyInputId">Message background session</label>
      <textarea :id="replyInputId" v-model="draft" rows="2" maxlength="32768" :disabled="panel.pending" placeholder="Send a follow-up for the next turn" />
      <div class="background-session__reply-actions">
        <span v-if="state?.operation === 'reply' && state.status === 'done'" role="status">Message queued</span>
        <button type="submit" :disabled="panel.pending || !draft.trim()">{{ panel.pending && panel.operation === 'reply' ? 'Sending…' : 'Send message' }}</button>
      </div>
    </form>
    <div class="background-session__controls">
      <button v-if="canReply && panel.session?.pid && ['working','blocked'].includes(panel.session.state)" type="button" :aria-expanded="replyOpen" :disabled="panel.pending" @click="replyOpen = !replyOpen">Reply</button>
      <button v-if="panel.session" type="button" :disabled="panel.pending || attached" @click="openSession(panel.target, panel.session.id)">Open session</button>
      <button type="button" :disabled="panel.pending" @click="operate(panel.target, { operation: 'refresh' })">{{ panel.pending && panel.operation === 'refresh' ? 'Checking…' : 'Refresh status' }}</button>
      <button v-if="panel.session?.pid && ['working', 'blocked'].includes(panel.session.state)" type="button" :disabled="panel.pending" @click="operate(panel.target, { operation: 'stop', id: panel.session.id, pid: panel.session.pid })">Stop background session</button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { surfaceSessionStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'
import { claudeWindowStorageKey } from './native-window-storage.ts'
import type { ClaudeNativeContinuation } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeBackgroundSessionRequest, ClaudeBackgroundReplyRequest, ClaudeBackgroundSession } from '#features/code/common/native-background.ts'
import type { ClaudeBackgroundSessionState } from '#features/threads/be/claude-terminal-views.ts'
const props = defineProps<{ continuation: ClaudeNativeContinuation; state?: ClaudeBackgroundSessionState; attached?: boolean; canReply?: boolean }>()
const emit = defineEmits<{ open: [target: ClaudeNativeContinuation, jobId: string]; operate: [target: ClaudeNativeContinuation, request: ClaudeBackgroundSessionRequest | ClaudeBackgroundReplyRequest] }>()
const draft = ref(''), replyOpen = ref(false), replyInputId = useId()
let submitted: {text: string; revision: number} | undefined
const draftKey = () => claudeWindowStorageKey('background-reply', JSON.stringify([props.continuation.sessionId, props.continuation.continuedInSessionId]))
watch([() => props.continuation.sessionId, () => props.continuation.continuedInSessionId], () => {
  submitted = undefined; let text = ''
  try { const key = draftKey(); if (key) text = surfaceSessionStorage(featureRef('threads')).get(key) ?? '' } catch { /* Storage cannot prevent composing. */ }
  draft.value = text.length <= 32768 ? text : ''; replyOpen.value = !!draft.value
}, {immediate:true,flush:'sync'})
watch(draft, text => {
  try { const key = draftKey(); if (key) { const storage = surfaceSessionStorage(featureRef('threads')); if (text) storage.set(key,text); else storage.remove(key) } } catch { /* Keep the live draft when storage is unavailable. */ }
}, {flush:'sync'})
watch([() => props.state?.revision, () => props.state?.status], () => {
  const state = props.state
  if (state?.sessionId !== props.continuation.sessionId || state.continuedInSessionId !== props.continuation.continuedInSessionId) return
  if (!submitted || !state || state.operation !== 'reply' || state.revision <= submitted.revision || state.status === 'pending') return
  if (state.status === 'done' && draft.value === submitted.text) draft.value = ''
  submitted = undefined
})
function reply(target: ClaudeNativeContinuation, session: ClaudeBackgroundSession) {
  if (!props.canReply || props.state?.status === 'pending' || !session.pid || !draft.value.trim() || draft.value.length > 32768) return
  submitted = {text:draft.value, revision:props.state?.revision ?? 0}
  operate(target, {operation:'reply', id:session.id, pid:session.pid, text:draft.value})
}
function openSession(target: ClaudeNativeContinuation, jobId: string) {
  const current = props.state
  if (props.attached || current?.status === 'pending' || current?.sessionId !== target.sessionId || current.continuedInSessionId !== target.continuedInSessionId || current.session?.id !== jobId
    || props.continuation.sessionId !== target.sessionId || props.continuation.continuedInSessionId !== target.continuedInSessionId) return
  emit('open', target, jobId)
}
function operate(target: ClaudeNativeContinuation, request: ClaudeBackgroundSessionRequest | ClaudeBackgroundReplyRequest) {
  if (props.continuation.sessionId !== target.sessionId || props.continuation.continuedInSessionId !== target.continuedInSessionId) return
  const current = props.state?.sessionId === target.sessionId && props.state.continuedInSessionId === target.continuedInSessionId ? props.state : undefined
  if (current?.status === 'pending') return
  if ((request.operation === 'stop' || request.operation === 'reply') && (!current?.session || current.session.id !== request.id || current.session.pid !== request.pid || !['working', 'blocked'].includes(current.session.state))) return
  emit('operate', target, request)
}
const panels = computed(() => {
  const target = { ...props.continuation }
  const state = props.state?.sessionId === target.sessionId && props.state.continuedInSessionId === target.continuedInSessionId ? props.state : undefined
  const session = state?.session, pending = state?.status === 'pending'
  const label = session ? session.state === 'stopped' ? 'Last reported: stopped' : session.state === 'done' ? 'Last reported: completed' : session.state === 'failed' ? 'Last reported: failed'
    : !session.pid ? 'Last reported: awaiting a background worker' : session.state === 'blocked' || session.status === 'waiting' ? 'Last reported: needs input' : session.status === 'busy' ? 'Last reported: working in background' : 'Last reported: running in background'
    : pending || !state ? 'Checking background session…' : 'Background session is not listed'
  return [{ key: JSON.stringify([target.sessionId, target.continuedInSessionId, session?.id, session?.pid]), target, session, pending, operation: state?.operation, problem: state?.problem, label }]
})
</script>
<style scoped>
.background-session { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; min-width: 0; margin-bottom: 8px; padding: 12px 14px; border: 1px solid #ffffff1a; border-radius: 10px; background: #ffffff04; }
.background-session__body { flex: 1 1 14rem; min-width: 0; }
h3 { margin: 0; color: #dcd8d2; font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }
p { margin: 4px 0 0; color: #aaa59e; font-size: 11px; line-height: 1.5; }
.background-session__detail { white-space: pre-wrap; overflow-wrap: anywhere; }
.background-session__problem { color: #e4aaa1; overflow-wrap: anywhere; }
.background-session__controls { display: flex; flex-wrap: wrap; gap: 6px; }
.background-session__reply { flex: 1 1 100%; display: grid; gap: 6px; min-width: 0; order: 2; }
.background-session__reply label { color: #bdb7af; font-size: 11px; }
.background-session__reply textarea { width: 100%; min-height: 58px; max-height: 180px; resize: vertical; padding: 9px 10px; border: 1px solid #ffffff20; border-radius: 8px; background: #11131580; color: #e2ded8; font: inherit; font-size: 12px; line-height: 1.5; }
.background-session__reply textarea:focus-visible { outline: 2px solid #8cabe8; outline-offset: 2px; }
.background-session__reply-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; color: #aaa59e; font-size: 11px; }
button { min-height: 30px; padding: 5px 9px; border: 1px solid #ffffff1a; border-radius: 7px; color: #cbc6bf; font-size: 11px; }
button:hover { background: #ffffff08; }
button:focus-visible { outline: 2px solid #8cabe8; outline-offset: 2px; }
button:disabled { opacity: .5; }
</style>
