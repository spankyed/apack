<template>
  <section :class="[active ? 'native-session' : 'native-launch', { 'native-session--expanded': active && expanded }]" aria-label="Claude native interface">
    <NativeManagedSecurityReview v-if="view?.state?.notice?.kind === 'managed_settings_security'" :notice="view.state.notice" :pending="noticePending" :problem="noticeProblem" @answer="answerManagedSecurity" />
    <NativeSandboxNetworkReview v-if="!active && view?.state?.notice?.kind === 'sandbox_network_access'" :notice="view.state.notice" :pending="noticePending" :problem="noticeProblem" @answer="answerSandboxNetwork" />
    <section v-for="panel in noticePanels" :key="panel.key" :data-native-notice="panel.notice.kind" :aria-label="panel.notice.kind === 'refusal_fallback_prompt' ? 'Claude model fallback' : panel.notice.kind === 'lsp_recommendation' ? 'Claude LSP recommendation' : panel.notice.kind === 'plugin_hint' ? 'Claude plugin recommendation' : panel.notice.kind === 'goal_proposal' ? 'Claude goal proposal' : panel.notice.kind === 'autocompact_offer' ? 'Claude autocompact offer' : 'Claude auto mode notice'" class="native-notice" :class="{ 'native-notice--recommendation': panel.notice.kind !== 'auto_mode_server_fallback' }" @keydown.esc.stop.prevent="answerNotice(panel, panel.notice.kind === 'autocompact_offer' ? 'compact_dismiss' : panel.notice.kind === 'goal_proposal' ? 'goal_decline' : panel.notice.kind === 'refusal_fallback_prompt' ? 'cancelled' : panel.notice.kind !== 'auto_mode_server_fallback' ? 'no' : 'interrupt')">
      <div class="native-notice__body" tabindex="0">
        <header v-if="panel.notice.kind === 'refusal_fallback_prompt'" class="native-notice__header">
          <h3>{{ panel.notice.title }}</h3>
          <a v-if="panel.notice.helpUrl" :href="panel.notice.helpUrl" target="_blank" rel="noopener noreferrer">Learn more</a>
          <button type="button" class="native-button native-button--launch" :disabled="inputPending" @click="open"><span aria-hidden="true" class="native-command">›_</span> Use native interface</button>
        </header>
        <h3 v-else>{{ panel.notice.title }}</h3>
        <template v-if="panel.notice.kind === 'plugin_hint' || panel.notice.kind === 'lsp_recommendation'">
          <p class="native-notice__identity">{{ panel.notice.pluginName }} · {{ panel.notice.marketplaceName }}</p>
          <PopoverRoot :key="panel.notice.revision">
            <PopoverTrigger as-child><button type="button" class="native-notice__details">About this plugin</button></PopoverTrigger>
            <PopoverPortal>
              <PopoverContent side="top" align="start" :side-offset="8" :collision-padding="12" :aria-label="panel.notice.kind === 'lsp_recommendation' ? 'LSP plugin details' : 'Plugin details'" class="claude-native-lsp-details">
                <header><h3>About this plugin</h3><PopoverClose as-child><button type="button" aria-label="Close plugin details">Close</button></PopoverClose></header>
                <p v-for="(paragraph, index) in panel.notice.paragraphs" :key="index">{{ paragraph }}</p>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
        </template>
        <template v-else>
          <p v-for="(paragraph, index) in panel.notice.paragraphs" :key="index">{{ paragraph }}</p>
          <p v-if="panel.notice.kind === 'auto_mode_server_fallback'" class="native-notice__url">{{ panel.notice.helpUrl }}</p>
        </template>
      </div>
      <p v-if="noticeProblem" role="alert" class="native-problem">{{ noticeProblem }}</p>
      <div v-if="panel.notice.kind === 'autocompact_offer'" class="native-notice__actions" role="group" aria-label="Autocompact size">
        <button type="button" class="native-button" :disabled="noticePending || !panel.notice.canPrevious" @click="answerNotice(panel, 'compact_previous')">Smaller</button>
        <output aria-label="Selected token limit">{{ panel.notice.selectedTokens.toLocaleString() }} tokens</output>
        <button type="button" class="native-button" :disabled="noticePending || !panel.notice.canNext" @click="answerNotice(panel, 'compact_next')">Larger</button>
      </div>
      <div class="native-notice__actions">
        <template v-if="panel.notice.kind !== 'auto_mode_server_fallback'">
          <button v-for="choice in panel.notice.choices" :key="choice.value" type="button" class="native-button" :class="{ 'native-button--return': choice.value === 'yes' }" :disabled="noticePending" @click="answerNotice(panel, choice.value)">{{ choice.label }}</button>
          <button v-if="panel.notice.kind === 'refusal_fallback_prompt'" type="button" class="native-button" :disabled="noticePending" @click="answerNotice(panel, 'cancelled')">Cancel</button>
          <button v-if="panel.notice.kind === 'autocompact_offer'" type="button" class="native-button" :disabled="noticePending" @click="answerNotice(panel, 'compact_dismiss')">Not now</button>
        </template>
        <template v-else>
          <button type="button" class="native-button" :disabled="noticePending" @click="answerNotice(panel, 'interrupt')">Cancel</button>
          <button type="button" class="native-button native-button--return" :disabled="noticePending" @click="answerNotice(panel, 'continue')">{{ noticePending ? 'Continuing…' : 'Continue in auto mode' }}</button>
        </template>
      </div>
    </section>
    <div v-if="!active" v-show="view?.state?.notice?.kind !== 'refusal_fallback_prompt'" class="native-launch__actions">
      <span v-if="launchProblem" role="status" class="native-problem" :class="{ 'native-problem--expected': managedPolicyDeclined }">{{ launchProblem }}</span>
      <button type="button" class="native-button native-button--launch" :disabled="(busy && (!view?.state || ended)) || view?.opening || inputPending" @click="open">
        <span aria-hidden="true" class="native-command">›_</span>
        {{ view?.opening ? view.cancelling ? 'Cancelling native startup…' : 'Opening native interface…' : 'Use native interface' }}
      </button>
      <button v-if="view?.opening && view.openingId" type="button" class="native-button" :disabled="view.cancelling" @click="cancelOpen">Cancel startup</button>
    </div>
    <template v-else>
      <header class="native-header">
        <div class="native-identity">
          <span class="native-mark" aria-hidden="true">›_</span>
          <div class="native-heading">
            <h2>Claude Code <span class="native-interface-label">Native interface</span></h2>
            <p :title="view?.state?.cwd">{{ workspaceName }}</p>
            <p v-if="selectedAgent" role="status">Viewing Agent · {{ selectedAgent }}</p>
          </div>
        </div>
        <div class="native-controls">
          <span role="status" class="native-state" :class="{ 'native-state--live': view?.state?.status === 'live', 'native-state--error': view?.state?.status === 'error' && !managedPolicyDeclined }">
            <span aria-hidden="true" />{{ stateLabel }}
          </span>
          <button type="button" class="native-button native-button--size" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? 'Minimize' : 'Expand' }}</button>
          <button v-if="active" type="button" class="native-button native-button--return" :disabled="!ended && (!!returning || view?.task?.status === 'pending')" @click="returnToConversation">Back to conversation <span aria-hidden="true">↗</span></button>
          <button v-if="!ended" type="button" class="native-button native-button--stop" @click="stop"><span class="native-stop-icon" aria-hidden="true" />Stop session</button>
        </div>
      </header>
      <p v-if="returnProblem" role="alert" class="native-problem">{{ returnProblem }}</p>
      <div class="native-console">
        <div ref="viewport" class="native-viewport" aria-label="Claude terminal" />
      </div>
      <p v-if="view?.state?.status === 'live'" role="status" aria-label="Claude billing status" class="px-4 py-2 text-xs text-neutral-400">{{ claudeBillingText(view.state.billing) }}</p>
      <footer v-if="view?.state?.mainStatus || view?.state?.tasks.length || view?.problem || view?.state?.problem" class="native-activity">
        <div v-if="view?.state?.mainStatus" class="native-summary">
          <span class="native-section-label">Session status</span>
          <NativeStatusText data-testid="native-main-status" class="native-summary__text" :text="view.state.mainStatus" />
        </div>
        <div v-if="view?.state?.tasks.length" class="native-agents">
          <div class="native-section-label">Tasks <span class="native-count">{{ view.state.tasks.length }}</span></div>
          <ul aria-label="Native Claude tasks" class="native-agent-list">
            <li v-for="task in view.state.tasks" :key="task.id" :data-native-task-id="task.id" class="native-agent">
              <div class="native-agent__heading"><span class="native-agent__name">{{ task.kind === 'workflow' ? 'Workflow · ' : '' }}{{ task.name }}</span><span class="native-agent__state">{{ task.status }}</span></div>
              <NativeStatusText v-if="task.statusText" class="native-agent__detail" :text="task.statusText" />
              <NativeTaskControls :task="{ ...task, ownerId: view.state.ownerId, sessionId: view.state.sessionId }" />
            </li>
          </ul>
        </div>
        <p v-if="view?.problem || view?.state?.problem" role="alert" class="native-problem">{{ view?.problem || view?.state?.problem }}</p>
      </footer>
    </template>
  </section>
</template>
<script setup lang="ts">
import { claudeBillingText } from '#features/code/common/native-billing.ts'
import { isClaudeNativeNoticeDecision, type ClaudeNativeNoticeResponse } from '#features/code/common/native-notice.ts'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent, PopoverClose } from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { useSurface } from '@apackdev/sdk/fe'
import type { ThreadsState } from '../state.ts'
import { mountNativeTerminal } from './native-terminal-pool.ts'
import NativeTaskControls from '#extensions/blocks/display/NativeTaskControls.vue'
import NativeManagedSecurityReview from './NativeManagedSecurityReview.vue'
import NativeSandboxNetworkReview from './NativeSandboxNetworkReview.vue'
import { parseClaudeDocument } from '#extensions/blocks/display/native-status-text.ts'
import NativeStatusText from '#extensions/blocks/display/NativeStatusText.vue'
const props = defineProps<{ threadId: string; busy: boolean; inputPending?: boolean }>()
const emit = defineEmits<{ active: [value: boolean] }>()
const actor: ThreadsState = useSurface()
const mountId = crypto.randomUUID()
const views = useSelector(actor, state => state.context.nativeTerminalViews)
const view = computed(() => views.value[mountId])

const noticePending = computed(() => view.value?.noticeAnswer?.status === 'pending' && view.value.noticeAnswer.revision === view.value.state?.notice?.revision)
const noticeProblem = computed(() => view.value?.noticeAnswer?.status === 'error' && view.value.noticeAnswer.revision === view.value.state?.notice?.revision ? view.value.noticeAnswer.problem : undefined)
const managedPolicyExit = ref<{ ownerId: string; afterSequence: number }>()
const managedPolicyDeclined = computed(() => {
  const current = view.value, intent = managedPolicyExit.value
  return !!intent && current?.state?.ownerId === intent.ownerId && current.state.exitCode === 1 && ['error', 'exited'].includes(current.state.status)
    && parseClaudeDocument(current.output.filter(chunk => chunk.sequence > intent.afterSequence).map(chunk => chunk.text).join('')).map(span => span.text).join('').replace(/\s+/g, ' ').includes('Managed settings were not approved; exiting without applying them.')
})
function answerManagedSecurity(response: ClaudeNativeNoticeResponse) {
  const state = view.value?.state, notice = state?.notice
  if (!state || notice?.kind !== 'managed_settings_security' || noticePending.value || notice.id !== response.id || notice.revision !== response.revision || notice.sessionId !== response.sessionId) return
  if (response.decision === 'policy_reject') managedPolicyExit.value = { ownerId: state.ownerId, afterSequence: view.value?.output.at(-1)?.sequence ?? 0 }
  actor.send({ type: 'CLAUDE_TERMINAL_NOTICE', ...identity(), ownerId: state.ownerId, notice: response })
}
function answerSandboxNetwork(response: ClaudeNativeNoticeResponse) {
  const state = view.value?.state, notice = state?.notice
  if (!state || notice?.kind !== 'sandbox_network_access' || noticePending.value || notice.id !== response.id || notice.revision !== response.revision || notice.sessionId !== response.sessionId) return
  actor.send({ type: 'CLAUDE_TERMINAL_NOTICE', ...identity(), ownerId: state.ownerId, notice: response })
}
function answerNotice(panel: (typeof noticePanels.value)[number], decision: ClaudeNativeNoticeResponse['decision']) {
  const state = view.value?.state, notice = state?.notice
  if (!state || !notice || active.value || noticePending.value || state.ownerId !== panel.ownerId || notice.kind !== panel.kind || notice.id !== panel.id || notice.revision !== panel.revision || notice.sessionId !== panel.sessionId || !isClaudeNativeNoticeDecision(notice, decision)) return
  actor.send({ type: 'CLAUDE_TERMINAL_NOTICE', ...identity(), ownerId: panel.ownerId, notice: { id: panel.id, revision: panel.revision, sessionId: panel.sessionId, decision } })
}
const workspaceName = computed(() => view.value?.state?.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || 'Current workspace')
const launchProblem = computed(() => managedPolicyDeclined.value ? 'Claude Code closed because you declined the managed settings.' : view.value?.problem || view.value?.state?.problem || (view.value?.state?.status === 'error' ? 'Claude Code disconnected unexpectedly. Reopen the native interface to continue this session.' : undefined))
const stateLabel = computed(() => {
  const state = view.value?.state
  if (managedPolicyDeclined.value) return 'Session ended'
  if (state?.status === 'live') return state.busy ? 'Working' : 'Connected'
  return state?.status === 'starting' ? 'Connecting' : state?.status === 'error' ? 'Connection error' : 'Session ended'
})
const selectedAgent = computed(() => { const state = view.value?.state; return state?.view?.kind === 'agent' ? state.tasks.find(task => task.id === (state.view?.kind === 'agent' ? state.view.taskId : undefined))?.name ?? state.view.taskId ?? 'Unavailable Agent' : undefined })
const returning = ref<{ ownerId: string; revision: number }>(), returnProblem = ref<string>()
function returnToConversation() {
  const state = view.value?.state
  if (!state || ended.value) { dismissed.value = true; return }
  if (returning.value || view.value?.task?.status === 'pending') return
  const revision = (view.value?.task?.revision ?? 0) + 1
  returning.value = { ownerId: state.ownerId, revision }; returnProblem.value = undefined
  const taskId = state.view?.kind === 'agent' ? state.view.taskId ?? state.view.registryId : '@main-view'
  actor.send({ type: 'CLAUDE_TERMINAL_TASK', ...identity(), ownerId: state.ownerId, taskId, revision, operation: 'background' })
}
watch(view, value => {
  const request = returning.value
  if (!request) return
  if (value?.state?.ownerId !== request.ownerId || ended.value) { returning.value = undefined; returnProblem.value = 'Native owner changed'; return }
  const result = value.task
  if (result?.revision !== request.revision || result.operation !== 'background' || result.status === 'pending') return
  returning.value = undefined
  if (result.status === 'done' && result.view?.taskId === null && value.state.view?.kind === 'main') dismissed.value = true
  else returnProblem.value = result.problem ?? 'The native view changed; return again'
})
const expanded = ref(true)
const dismissed = ref(false)
const requested = ref(false)
const ended = computed(() => ['exited', 'error'].includes(view.value?.state?.status ?? ''))
const active = computed(() => !!view.value?.state && !view.value.opening && requested.value && !dismissed.value)
// Rendered actions retain their original owner and revision until Vue replaces the panel.
const noticePanels = computed(() => {
  if (active.value) return []
  const state = view.value?.state, notice = state?.notice
  if (!state || !notice || notice.kind === 'managed_settings_security' || notice.kind === 'sandbox_network_access') return []
  return [{ key: JSON.stringify([state.ownerId, notice.sessionId, notice.id, notice.kind]), ownerId: state.ownerId, id: notice.id, revision: notice.revision, sessionId: notice.sessionId, kind: notice.kind, notice }]
})
const viewport = ref<HTMLElement>()
let terminal: ReturnType<typeof mountNativeTerminal> | undefined, observer: ResizeObserver | undefined
let attachedOwner: string | undefined
const identity = () => ({ threadId: props.threadId, mountId })
function renew() { actor.send({ type: 'CLAUDE_TERMINAL_MOUNT', ...identity() }) }
function open() { returnProblem.value = undefined; returning.value = undefined; requested.value = true; dismissed.value = false; actor.send({ type: 'CLAUDE_TERMINAL_OPEN', ...identity() }) }
function cancelOpen() {
  const openingId = view.value?.openingId
  if (!openingId || view.value?.cancelling) return
  requested.value = false; dismissed.value = true
  actor.send({ type: 'CLAUDE_TERMINAL_CANCEL_OPEN', ...identity(), openingId })
}
function stop() { const ownerId = view.value?.state?.ownerId; if (ownerId) actor.send({ type: 'CLAUDE_TERMINAL_CLOSE', ...identity(), ownerId }) }
function detach() { observer?.disconnect(); observer = undefined; terminal?.detach(); terminal = undefined; attachedOwner = undefined }
watch(active, value => emit('active', value), { immediate: true })
watch([view, active], async ([value, showing]) => {
  if (!showing) { detach(); return }
  const ownerId = value?.state?.ownerId
  if (!ownerId) { detach(); return }
  await nextTick()
  if (!viewport.value || view.value?.state?.ownerId !== ownerId) return
  if (attachedOwner !== ownerId) {
    detach(); attachedOwner = ownerId
    terminal = mountNativeTerminal(ownerId, viewport.value, text => actor.send({ type: 'CLAUDE_TERMINAL_INPUT', ...identity(), ownerId, text }))
    observer = new ResizeObserver(() => {
      if (!terminal || !viewport.value?.clientWidth || !viewport.value.clientHeight) return
      const size = terminal.fit(); actor.send({ type: 'CLAUDE_TERMINAL_RESIZE', ...identity(), ownerId, ...size })
    }); observer.observe(viewport.value)
    terminal.focus()
  }
  terminal?.write(value.output)
}, { flush: 'post' })
defineExpose({ open })
renew(); const heartbeat = setInterval(renew, 10000)
onBeforeUnmount(() => { clearInterval(heartbeat); detach(); actor.send({ type: 'CLAUDE_TERMINAL_UNMOUNT', ...identity() }); emit('active', false) })
</script>

<style scoped>
.native-launch { display: flex; flex-direction: column; flex-shrink: 0; justify-content: flex-end; padding: 6px 20px; }
.native-launch__actions { justify-content: flex-end; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.native-launch__actions .native-problem { flex: 1 1 16rem; min-width: 0; overflow-wrap: anywhere; }
.native-launch__actions .native-button { flex-shrink: 0; }
.native-notice { margin-bottom: 8px; padding: 12px; border: 1px solid #d3aa8e33; border-radius: 10px; background: #d3aa8e08; }
.native-notice__body { max-height: min(14rem, 23vh); overflow-y: auto; overscroll-behavior: contain; font-size: 12px; line-height: 1.5; color: #c9c5bf; overflow-wrap: anywhere; }
.native-notice h3 { margin: 0 0 8px; font-size: 13px; font-weight: 500; color: #eee7dd; }
.native-notice p { margin: 0 0 8px; }
.native-notice__url { color: #9f9a92; font-size: 11px; }
.native-notice--recommendation { padding: 8px 12px; }
.native-notice--recommendation h3, .native-notice--recommendation p { margin-bottom: 4px; }
.native-notice__header { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 4px; }
.native-notice__header h3 { flex: 1; margin: 0; }
.native-notice__header a { font-size: 11px; color: #c9c5bf; text-underline-offset: 3px; }
.native-notice__header a:hover { text-decoration: underline; }
.native-notice__header a:focus-visible { outline: 1px solid #8eadd3; outline-offset: 3px; }
.native-notice__header .native-button { padding: 3px 6px; font-size: 11px; }
.native-notice__identity { overflow-wrap: anywhere; }
.native-notice__details { padding: 0; border: 0; background: none; color: #aaa59e; font-size: 11px; cursor: pointer; }
.native-notice__details:focus-visible { outline: 1px solid #8eadd3; outline-offset: 3px; }
:global(.claude-native-lsp-details) { z-index: 50; width: min(32rem, calc(100vw - 24px)); max-height: min(35vh, var(--reka-popover-content-available-height)); overflow-y: auto; overscroll-behavior: contain; padding: 12px; border: 1px solid #ffffff26; border-radius: 10px; background: #232323; color: #c9c5bf; font-size: 12px; line-height: 1.5; box-shadow: 0 12px 36px #0008; overflow-wrap: anywhere; }
:global(.claude-native-lsp-details header) { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
:global(.claude-native-lsp-details h3) { margin: 0; color: #eee7dd; font-size: 13px; font-weight: 500; }
:global(.claude-native-lsp-details header button) { color: #aaa59e; font-size: 11px; cursor: pointer; }
:global(.claude-native-lsp-details p) { margin: 0 0 8px; }
.native-notice__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.native-session { --console-bg: #191919; display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; padding: 16px; gap: 0; background: #141414; color: #dedbd7; }
.native-session--expanded { position: fixed; inset: 40px 0 0 72px; z-index: 40; }
.native-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: 20px; padding: 4px 4px 18px; }
.native-identity { display: flex; align-items: center; min-width: 0; gap: 12px; }
.native-mark { display: grid; place-items: center; flex-shrink: 0; width: 38px; height: 38px; border: 1px solid #b68e7333; border-radius: 11px; background: #b68e7310; color: #d3aa8e; font: 600 21px ui-monospace, monospace; }
.native-heading { min-width: 0; }
.native-heading h2 { display: flex; align-items: baseline; gap: 10px; margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.02em; }
.native-interface-label { color: #82807d; font-size: 11px; font-weight: 400; letter-spacing: 0; }
.native-heading p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 4px 0 0; color: #8e8b86; font-size: 11px; }
.native-controls { display: flex; align-items: center; flex-shrink: 0; gap: 8px; }
.native-state { display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; color: #a29e98; white-space: nowrap; font-size: 11px; }
.native-state > span { width: 6px; height: 6px; border-radius: 50%; background: #827e78; }
.native-state--live > span { background: #99bea2; box-shadow: 0 0 0 3px #99bea210; }
.native-state--error { color: #e9a3a0; }
.native-state--error > span { background: currentColor; }
.native-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 32px; padding: 5px 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #a9a5a0; font-size: 11px; line-height: 18px; transition: background .15s, color .15s, border-color .15s; }
.native-button:hover { background: #ffffff08; color: #f0ece7; }
.native-button:focus-visible { outline: 2px solid #d3aa8e; outline-offset: 3px; }
.native-button:disabled { opacity: .4; cursor: not-allowed; }
.native-button--launch { border-color: #ffffff0a; }
.native-command { color: #c7a38a; font-family: ui-monospace, monospace; font-size: 15px; }
.native-button--stop { border-color: #ffffff12; background: #ffffff03; color: #c3b8b1; }
.native-button--stop:hover { border-color: #c9797340; background: #c9797310; color: #edb6af; }
.native-stop-icon { width: 7px; height: 7px; border-radius: 2px; background: currentColor; }
.native-button--return { border-color: #b68e7333; color: #d3aa8e; }
.native-console { display: flex; flex: 1; min-height: 144px; min-width: 0; overflow: hidden; border: 1px solid #ffffff12; border-radius: 12px; background: var(--console-bg); box-shadow: 0 8px 30px #00000020; }
.native-viewport { flex: 1; min-height: 0; min-width: 0; overflow: hidden; padding: 20px; }
.native-viewport :deep(.xterm) { height: 100%; }
.native-viewport :deep(.xterm-viewport) { scrollbar-width: thin; scrollbar-color: #ffffff20 transparent; }
.native-activity { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); flex-shrink: 0; gap: 16px 28px; max-height: 180px; overflow: auto; padding: 16px 4px 2px; }
.native-section-label { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; color: #797773; font-size: 10px; font-weight: 500; letter-spacing: .04em; }
.native-count { display: inline-grid; place-items: center; min-width: 16px; height: 16px; border-radius: 5px; background: #ffffff08; color: #aaa59f; font-size: 10px; letter-spacing: 0; }
.native-summary__text { display: block; font-size: 11px; line-height: 1.65; color: #bbb6af; overflow-wrap: anywhere; }
.native-agent-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.native-agent { min-width: 0; border-left: 2px solid #b68e7340; padding: 2px 0 2px 10px; }
.native-agent__heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.native-agent__name { color: #d1ccc5; font-size: 11px; font-weight: 500; overflow-wrap: anywhere; }
.native-agent__state { color: #a7b9aa; font-size: 10px; }
.native-agent__detail { display: block; margin-top: 3px; color: #8f8a84; font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
.native-problem { grid-column: 1 / -1; margin: 0; color: #e9a3a0; font-size: 11px; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .native-session { padding: 12px; }
  .native-session--expanded { left: 0; }
  .native-header { flex-wrap: wrap; gap: 12px; padding-bottom: 12px; }
  .native-identity { flex: 1; }
  .native-controls { margin-left: auto; gap: 4px; }
  .native-state { margin-right: 4px; }
  .native-interface-label { display: none; }
  .native-viewport { padding: 12px; }
  .native-activity { gap: 12px; padding-top: 12px; }
}
@media (max-width: 440px) {
  .native-controls { width: 100%; justify-content: flex-end; }
  .native-state { margin-right: auto; }
  .native-activity { grid-template-columns: minmax(0, 1fr); max-height: 160px; }
}
.native-problem--expected { color: #a3a3a3; }
</style>
