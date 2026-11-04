<template>
  <section v-for="panel in panels" :key="panel.key" aria-label="Background Claude session" :aria-busy="panel.pending" class="background-session" :class="{ 'background-session--composing': richReplyActive }">
    <header class="background-session__heading">
      <div class="background-session__body">
        <h3 :title="panel.session?.name || 'Background session'">{{ panel.session?.name || 'Background session' }}</h3>
        <p role="status">{{ panel.label }}</p>
      </div>
      <div class="background-session__controls">
        <button v-if="canReply && panel.session?.pid && ['working','blocked'].includes(panel.session.state)" type="button" :aria-label="state?.question ? 'Answer question' : 'Reply'" :title="state?.question ? 'Answer question' : 'Reply'" :aria-expanded="replyOpen" :disabled="panel.pending" @click="replyOpen = !replyOpen"><MessageSquare aria-hidden="true" /><span class="background-session__control-label">{{ state?.question ? 'Answer question' : 'Reply' }}</span></button>
        <button v-if="panel.session" type="button" aria-label="Open session" title="Open session" :disabled="panel.pending || attached" @click="openSession(panel.target, panel.session.id)"><Terminal aria-hidden="true" /><span class="background-session__control-label">Open session</span></button>
        <button type="button" aria-label="Refresh status" title="Refresh status" :disabled="panel.pending" @click="operate(panel.target, { operation: 'refresh' })"><RefreshCw aria-hidden="true" /><span class="background-session__control-label">{{ panel.pending && panel.operation === 'refresh' ? 'Checking…' : 'Refresh status' }}</span></button>
        <button v-if="panel.session?.pid && ['working', 'blocked'].includes(panel.session.state)" type="button" class="background-session__stop" aria-label="Stop background session" title="Stop background session" :disabled="panel.pending" @click="operate(panel.target, { operation: 'stop', id: panel.session.id, pid: panel.session.pid })"><Square aria-hidden="true" /><span class="background-session__control-label">Stop background session</span></button>
        <slot name="parent-interface" />
      </div>
    </header>
    <p v-if="panel.info" aria-label="Background session usage" class="background-session__detail">{{ panel.info.model }} · {{ panel.info.turns }} {{ panel.info.turns === 1 ? 'turn' : 'turns' }}<template v-if="panel.info.context"> · {{ panel.info.context.percent }}% context</template><template v-if="panel.info.totalCostUsd !== undefined"> · Session total ${{ panel.info.totalCostUsd.toFixed(6) }}</template></p>
    <div v-if="panel.info?.statusLine" aria-label="Background Claude configured status" class="background-session__detail background-session__formatter" tabindex="0"><NativeStatusText :text="panel.info.statusLine" /></div>
    <p v-if="state?.question" role="status" class="background-session__detail">Claude has a question. Open Answer question to continue.</p>
    <p v-if="panel.session?.waitingFor" class="background-session__detail">{{ panel.session.waitingFor }}</p>
    <p v-if="panel.problem" role="alert" class="background-session__problem">{{ panel.problem }}</p>
    <div v-if="canReply && (replyOpen || state?.question && questionOpened) && panel.session?.pid && ['working','blocked'].includes(panel.session.state) && state?.desktop && $slots.composer" class="background-session__composer" v-show="replyOpen">
      <slot name="composer" :active="replyOpen"
      :target="state!.desktop!" :draft="draft" :draft-snapshot="draftSnapshot" :update-draft="(text: string) => updateDraft(panel.target, text)" :save-snapshot="(snapshot: ClaudeAgentDraftSnapshot) => saveSnapshot(panel.target, snapshot)" :close="() => replyOpen = false" :pending="panel.pending"
      :send="(text: string) => sendReply(panel.target, panel.session!, text, true)" />
    </div>
    <form v-else-if="canReply && replyOpen && panel.session?.pid && ['working','blocked'].includes(panel.session.state)" class="background-session__reply" data-native-background-reply @submit.prevent="reply(panel.target, panel.session)">
      <div class="background-session__reply-heading">
        <label :for="replyInputId">Message background session</label>
        <span v-if="!draft && state?.operation === 'reply' && state.status === 'done'" role="status">Message queued</span>
      </div>
      <textarea :id="replyInputId" v-model="draft" rows="2" maxlength="32768" :disabled="panel.pending" placeholder="Send a follow-up for the next turn" />
      <div class="background-session__reply-actions"><button type="submit" :disabled="panel.pending || !draft.trim()">{{ panel.pending && panel.operation === 'reply' ? 'Sending…' : 'Send message' }}</button></div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useSlots, watch } from 'vue'
import { MessageSquare, Terminal, RefreshCw, Square } from 'lucide-vue-next'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'
import { claudeWindowStorageKey } from './native-window-storage.ts'
import type { ClaudeNativeContinuation } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeBackgroundStatus, ClaudeBackgroundSessionRequest, ClaudeBackgroundReplyRequest, ClaudeBackgroundSession } from '#features/code/common/native-background.ts'
import type { ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'
import type { ClaudeBackgroundSessionState } from '#features/threads/be/claude-terminal-views.ts'
const props = defineProps<{ continuation: ClaudeNativeContinuation; state?: ClaudeBackgroundSessionState; info?: ClaudeBackgroundStatus; attached?: boolean; canReply?: boolean }>()
const emit = defineEmits<{ open: [target: ClaudeNativeContinuation, jobId: string]; operate: [target: ClaudeNativeContinuation, request: ClaudeBackgroundSessionRequest | ClaudeBackgroundReplyRequest]; composing: [value: boolean] }>()
const draftSnapshot = ref<ClaudeAgentDraftSnapshot>()
const draft = ref(''), replyOpen = ref(false), replyInputId = useId()
const slots = useSlots()
const questionOpened = ref(false)
watch(() => [replyOpen.value, props.state?.desktop?.ownerId], ([open, owner], previous) => { if (owner !== previous?.[1]) questionOpened.value = false; if (open) questionOpened.value = true })
const richReplyActive = computed(() => !!(props.canReply && replyOpen.value && props.state?.desktop && slots.composer
  && props.state.sessionId === props.continuation.sessionId && props.state.continuedInSessionId === props.continuation.continuedInSessionId
  && props.state.desktop.parentSessionId === props.continuation.sessionId && props.state.desktop.sessionId === props.continuation.continuedInSessionId
  && props.state.session?.pid && ['working','blocked'].includes(props.state.session.state)))
watch(richReplyActive, value => emit('composing', value), {immediate:true,flush:'sync'})
let submitted: {text: string; revision: number; rich: boolean; resolve(): void; reject(error: Error): void} | undefined
function retireSubmission() { submitted?.reject(Error('Background session changed before acknowledgment')); submitted = undefined }
function draftCurrent(target: ClaudeNativeContinuation) { return props.continuation.sessionId === target.sessionId && props.continuation.continuedInSessionId === target.continuedInSessionId }
function updateDraft(target: ClaudeNativeContinuation, text: string) { if (draftCurrent(target)) draft.value = text }
function saveSnapshot(target: ClaudeNativeContinuation, snapshot: ClaudeAgentDraftSnapshot) { if (draftCurrent(target) && snapshot.text === draft.value) draftSnapshot.value = snapshot }
onBeforeUnmount(() => { retireSubmission(); emit('composing', false) })
const draftKey = () => claudeWindowStorageKey('background-reply', JSON.stringify([props.continuation.sessionId, props.continuation.continuedInSessionId]))
watch([() => props.continuation.sessionId, () => props.continuation.continuedInSessionId], () => {
  retireSubmission(); draftSnapshot.value = undefined; let text = ''
  try { const key = draftKey(); if (key) text = surfaceStorage(featureRef('threads')).get(key) ?? '' } catch { /* Storage cannot prevent composing. */ }
  draft.value = text.length <= 32768 ? text : ''; replyOpen.value = !!draft.value
}, {immediate:true,flush:'sync'})
watch(draft, text => {
  try { const key = draftKey(); if (key) { const storage = surfaceStorage(featureRef('threads')); if (text) storage.set(key,text); else storage.remove(key) } } catch { /* Keep the live draft when storage is unavailable. */ }
}, {flush:'sync'})
watch([() => props.state?.revision, () => props.state?.status], () => {
  const state = props.state
  if (state?.sessionId !== props.continuation.sessionId || state.continuedInSessionId !== props.continuation.continuedInSessionId) return
  if (!submitted || !state || state.operation !== 'reply' || state.revision <= submitted.revision || state.status === 'pending') return
  const request = submitted; submitted = undefined
  if (state.status === 'done') {
    if (!request.rich && draft.value === request.text) { draft.value = ''; draftSnapshot.value = undefined }
    request.resolve()
  } else request.reject(Error(state.problem || 'Background message was not queued'))
})
function reply(target: ClaudeNativeContinuation, session: ClaudeBackgroundSession) {
  void sendReply(target, session, draft.value, false).catch(() => {})
}
function sendReply(target: ClaudeNativeContinuation, session: ClaudeBackgroundSession, text: string, rich: boolean): Promise<void> {
  if (!props.canReply || submitted || props.state?.status === 'pending' || !session.pid || !text.trim() || text.length > 32768
    || props.continuation.sessionId !== target.sessionId || props.continuation.continuedInSessionId !== target.continuedInSessionId
    || props.state?.session?.id !== session.id || props.state.session.pid !== session.pid || !['working','blocked'].includes(session.state)) return Promise.reject(Error('Background input changed. Refresh and send again.'))
  return new Promise((resolve, reject) => {
    submitted = {text, revision:props.state?.revision ?? 0, rich, resolve, reject}
    operate(target, {operation:'reply', id:session.id, pid:session.pid!, text})
  })
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
  const info = session?.pid && ['working','blocked'].includes(session.state) && props.info?.sessionId === target.continuedInSessionId && props.info.jobId === session.id && props.info.pid === session.pid ? props.info : undefined
  return [{ key: JSON.stringify([target.sessionId, target.continuedInSessionId, session?.id, session?.pid]), target, session, info, pending, operation: state?.operation, problem: state?.problem, label }]
})
</script>
<style scoped>
.background-session { display: grid; flex-shrink: 0; gap: 5px; min-width: 0; margin-bottom: 0; padding: 8px 12px; border: 1px solid #ffffff14; border-radius: 10px; background: #ffffff03; }
.background-session--composing { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
.background-session--composing > :not(.background-session__composer) { flex-shrink: 0; }
.background-session__composer {display:flex;flex:1;min-height:0;min-width:0}
.background-session__heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.background-session__body { flex: 1; min-width: 0; }
h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; color: #dcd8d2; font-size: 12px; line-height: 16px; font-weight: 500; }
p { margin: 0; color: #aaa59e; font-size: 11px; line-height: 16px; }
.background-session__body p { color: #96918a; }
.background-session__detail { white-space: pre-wrap; overflow-wrap: anywhere; }
.background-session__formatter { max-height: 72px; overflow-y: auto; overscroll-behavior: contain; color: #aaa59e; font-size: 11px; line-height: 15px; }
.background-session__formatter:focus-visible { outline: 2px solid #8cabe8; outline-offset: 2px; }
.background-session__problem { color: #e4aaa1; overflow-wrap: anywhere; }
.background-session__controls { display: flex; flex-shrink: 0; align-items: center; gap: 4px; }
.background-session__controls svg { width: 13px; height: 13px; flex-shrink: 0; stroke-width: 1.7; }
.background-session__reply { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; row-gap: 4px; min-width: 0; margin-top: 2px; }
.background-session__reply-heading { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #a29d96; font-size: 11px; line-height: 14px; }
.background-session__reply-heading label { color: #bdb7af; }
.background-session__reply textarea { grid-column: 1; width: 100%; height: 56px; min-height: 56px; max-height: 180px; resize: vertical; padding: 8px 10px; border: 1px solid #ffffff20; border-radius: 7px; background: #11131580; color: #e2ded8; font: inherit; font-size: 12px; line-height: 18px; }
.background-session__reply textarea:focus-visible { outline: 2px solid #8cabe8; outline-offset: 2px; }
.background-session__reply-actions { grid-column: 2; display: flex; align-items: flex-end; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 5px 8px; border: 1px solid #ffffff14; border-radius: 7px; color: #bdb8b0; font-size: 11px; line-height: 18px; }
button:hover { background: #ffffff08; color: #e2ded8; }
button:focus-visible { outline: 2px solid #8cabe8; outline-offset: 2px; }
button:disabled { opacity: .5; }
.background-session__stop:hover { border-color: #c9797340; background: #c9797310; color: #edb6af; }
@media (max-width: 720px), (max-height: 700px) {
  .background-session__control-label { display: none; }
  .background-session__controls button { width: 30px; padding-inline: 5px; }
}
</style>
