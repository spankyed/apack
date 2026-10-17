<template>
  <section :class="active ? ['flex min-h-0 flex-1 flex-col bg-[#1c1c1c]', expanded ? 'fixed inset-x-0 bottom-0 top-10 z-40' : ''] : 'flex shrink-0 justify-end px-4 py-1'" aria-label="Claude native interface">
    <div v-if="!active" class="flex items-center gap-3">
      <span v-if="view?.problem" role="status" class="text-xs text-red-300">{{ view.problem }}</span>
      <button type="button" class="rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-neutral-200 disabled:opacity-40" :disabled="busy || view?.opening" @click="open">{{ view?.opening ? 'Opening native interface…' : 'Use native interface' }}</button>
    </div>
    <template v-else>
      <header class="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2 text-xs text-neutral-400">
        <span class="flex-1 font-medium text-neutral-200">Claude Code <span class="ml-2 font-normal text-neutral-500">Native interface</span></span>
        <span role="status">{{ view?.state?.status }}</span>
        <button type="button" class="rounded-md px-2 py-1 hover:bg-white/5 hover:text-white" @click="expanded = !expanded">{{ expanded ? 'Minimize' : 'Expand' }}</button>
        <button v-if="ended" type="button" class="rounded-md px-2 py-1 hover:bg-white/5 hover:text-white" @click="dismissed = true">Back to conversation</button>
        <button v-else type="button" class="rounded-md px-2 py-1 hover:bg-white/5 hover:text-white" @click="stop">Stop session</button>
      </header>
      <div ref="viewport" class="min-h-36 min-w-0 flex-1 overflow-hidden p-3" aria-label="Claude terminal" />
      <div class="max-h-48 shrink-0 overflow-y-auto border-t border-white/[0.06] px-4 py-3 text-xs">
        <NativeStatusText v-if="view?.state?.mainStatus" data-testid="native-main-status" class="block leading-5 text-neutral-300" :text="view.state.mainStatus" />
        <ul v-if="view?.state?.tasks.length" aria-label="Native Claude agents" class="mt-2 space-y-1.5">
          <li v-for="task in view.state.tasks" :key="task.id" :data-native-task-id="task.id" class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-neutral-400">
            <span class="font-medium text-neutral-300">{{ task.name }}</span><span>{{ task.status }}</span>
            <NativeStatusText v-if="task.statusText" :text="task.statusText" />
          </li>
        </ul>
        <p v-if="view?.problem" role="alert" class="mt-2 text-red-300">{{ view.problem }}</p>
      </div>
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
const expanded = ref(true)
const dismissed = ref(false)
const ended = computed(() => ['exited', 'error'].includes(view.value?.state?.status ?? ''))
const active = computed(() => !!view.value?.state && !dismissed.value)
const viewport = ref<HTMLElement>()
let terminal: ReturnType<typeof mountNativeTerminal> | undefined, observer: ResizeObserver | undefined
let attachedOwner: string | undefined
const identity = () => ({ threadId: props.threadId, mountId })
function renew() { actor.send({ type: 'CLAUDE_TERMINAL_MOUNT', ...identity() }) }
function open() { dismissed.value = false; actor.send({ type: 'CLAUDE_TERMINAL_OPEN', ...identity() }) }
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
