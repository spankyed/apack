<template>
  <section :class="[active ? 'native-session' : 'native-launch', { 'native-session--expanded': active && expanded }]" aria-label="Claude native interface">
    <div v-if="!active" class="native-launch__actions">
      <span v-if="view?.problem || view?.state?.problem" role="status" class="native-problem">{{ view?.problem || view?.state?.problem }}</span>
      <button type="button" class="native-button native-button--launch" :disabled="busy || view?.opening" @click="open">
        <span aria-hidden="true" class="native-command">›_</span>
        {{ view?.opening ? 'Opening native interface…' : 'Use native interface' }}
      </button>
    </div>
    <template v-else>
      <header class="native-header">
        <div class="native-identity">
          <span class="native-mark" aria-hidden="true">›_</span>
          <div class="native-heading">
            <h2>Claude Code <span class="native-interface-label">Native interface</span></h2>
            <p :title="view?.state?.cwd">{{ workspaceName }}</p>
          </div>
        </div>
        <div class="native-controls">
          <span role="status" class="native-state" :class="{ 'native-state--live': view?.state?.status === 'live', 'native-state--error': view?.state?.status === 'error' }">
            <span aria-hidden="true" />{{ stateLabel }}
          </span>
          <button type="button" class="native-button native-button--size" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? 'Minimize' : 'Expand' }}</button>
          <button v-if="active" type="button" class="native-button native-button--return" @click="dismissed = true">Back to conversation <span aria-hidden="true">↗</span></button>
          <button v-if="!ended" type="button" class="native-button native-button--stop" @click="stop"><span class="native-stop-icon" aria-hidden="true" />Stop session</button>
        </div>
      </header>
      <div class="native-console">
        <div ref="viewport" class="native-viewport" aria-label="Claude terminal" />
      </div>
      <footer v-if="view?.state?.mainStatus || view?.state?.tasks.length || view?.problem || view?.state?.problem" class="native-activity">
        <div v-if="view?.state?.mainStatus" class="native-summary">
          <span class="native-section-label">Session status</span>
          <NativeStatusText data-testid="native-main-status" class="native-summary__text" :text="view.state.mainStatus" />
        </div>
        <div v-if="view?.state?.tasks.length" class="native-agents">
          <div class="native-section-label">Agents <span class="native-count">{{ view.state.tasks.length }}</span></div>
          <ul aria-label="Native Claude agents" class="native-agent-list">
            <li v-for="task in view.state.tasks" :key="task.id" :data-native-task-id="task.id" class="native-agent">
              <div class="native-agent__heading"><span class="native-agent__name">{{ task.name }}</span><span class="native-agent__state">{{ task.status }}</span></div>
              <NativeStatusText v-if="task.statusText" class="native-agent__detail" :text="task.statusText" />
            </li>
          </ul>
        </div>
        <p v-if="view?.problem || view?.state?.problem" role="alert" class="native-problem">{{ view?.problem || view?.state?.problem }}</p>
      </footer>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSelector } from '@xstate/vue'
import { usePlugin } from '@apackdev/sdk/fe'
import type { ThreadsState } from '../state.ts'
import { mountNativeTerminal } from './native-terminal-pool.ts'
import NativeStatusText from './NativeStatusText.vue'
const props = defineProps<{ threadId: string; busy: boolean }>()
const emit = defineEmits<{ active: [value: boolean] }>()
const actor: ThreadsState = usePlugin()
const mountId = crypto.randomUUID()
const views = useSelector(actor, state => state.context.nativeTerminalViews)
const view = computed(() => views.value[mountId])
const workspaceName = computed(() => view.value?.state?.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || 'Current workspace')
const stateLabel = computed(() => {
  const state = view.value?.state
  if (state?.status === 'live') return state.busy ? 'Working' : 'Connected'
  return state?.status === 'starting' ? 'Connecting' : state?.status === 'error' ? 'Connection error' : 'Session ended'
})
const expanded = ref(true)
const dismissed = ref(false)
const requested = ref(false)
const ended = computed(() => ['exited', 'error'].includes(view.value?.state?.status ?? ''))
const active = computed(() => !!view.value?.state && requested.value && !dismissed.value)
const viewport = ref<HTMLElement>()
let terminal: ReturnType<typeof mountNativeTerminal> | undefined, observer: ResizeObserver | undefined
let attachedOwner: string | undefined
const identity = () => ({ threadId: props.threadId, mountId })
function renew() { actor.send({ type: 'CLAUDE_TERMINAL_MOUNT', ...identity() }) }
function open() { requested.value = true; dismissed.value = false; actor.send({ type: 'CLAUDE_TERMINAL_OPEN', ...identity() }) }
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
renew(); const heartbeat = setInterval(renew, 10000)
onBeforeUnmount(() => { clearInterval(heartbeat); detach(); actor.send({ type: 'CLAUDE_TERMINAL_UNMOUNT', ...identity() }); emit('active', false) })
</script>

<style scoped>
.native-launch { display: flex; flex-shrink: 0; justify-content: flex-end; padding: 6px 20px; }
.native-launch__actions { display: flex; align-items: center; gap: 12px; }
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
</style>
