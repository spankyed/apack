<template>
  <section v-for="panel in panels" :key="panel.key" aria-label="Background Claude session" class="background-session">
    <div class="background-session__body">
      <h3>{{ panel.session?.name || 'Background session' }}</h3>
      <p role="status">{{ panel.label }}</p>
      <p v-if="panel.session?.waitingFor" class="background-session__detail">{{ panel.session.waitingFor }}</p>
      <p v-if="panel.problem" role="alert" class="background-session__problem">{{ panel.problem }}</p>
    </div>
    <div class="background-session__controls">
      <button type="button" :disabled="panel.pending" @click="operate(panel.target, { operation: 'refresh' })">{{ panel.pending ? panel.operation === 'stop' ? 'Stopping…' : 'Checking…' : 'Refresh status' }}</button>
      <button v-if="panel.session?.pid && ['working', 'blocked'].includes(panel.session.state)" type="button" :disabled="panel.pending" @click="operate(panel.target, { operation: 'stop', id: panel.session.id, pid: panel.session.pid })">Stop background session</button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ClaudeNativeContinuation } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeBackgroundSessionRequest } from '#features/code/common/native-background.ts'
import type { ClaudeBackgroundSessionState } from '#features/threads/be/claude-terminal-views.ts'
const props = defineProps<{ continuation: ClaudeNativeContinuation; state?: ClaudeBackgroundSessionState }>()
const emit = defineEmits<{ operate: [target: ClaudeNativeContinuation, request: ClaudeBackgroundSessionRequest] }>()
function operate(target: ClaudeNativeContinuation, request: ClaudeBackgroundSessionRequest) {
  if (props.continuation.sessionId !== target.sessionId || props.continuation.continuedInSessionId !== target.continuedInSessionId) return
  const current = props.state?.sessionId === target.sessionId && props.state.continuedInSessionId === target.continuedInSessionId ? props.state : undefined
  if (current?.status === 'pending') return
  if (request.operation === 'stop' && (!current?.session || current.session.id !== request.id || current.session.pid !== request.pid || !['working', 'blocked'].includes(current.session.state))) return
  emit('operate', target, request)
}
const panels = computed(() => {
  const target = { ...props.continuation }
  const state = props.state?.sessionId === target.sessionId && props.state.continuedInSessionId === target.continuedInSessionId ? props.state : undefined
  const session = state?.session, pending = state?.status === 'pending'
  const label = session ? session.state === 'stopped' ? 'Background session stopped' : session.state === 'done' ? 'Background session completed' : session.state === 'failed' ? 'Background session failed'
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
button { min-height: 30px; padding: 5px 9px; border: 1px solid #ffffff1a; border-radius: 7px; color: #cbc6bf; font-size: 11px; }
button:hover { background: #ffffff08; }
button:focus-visible { outline: 2px solid #8cabe8; outline-offset: 2px; }
button:disabled { opacity: .5; }
</style>
