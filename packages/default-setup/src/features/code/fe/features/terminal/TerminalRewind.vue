<!--
  A terminal's recording, looked back through: drawn over the terminal it is a recording of, with the
  moment shown under it. What is drawn is a session of its own with no process, so nothing typed here
  reaches the shell, which runs on underneath.
-->
<template>
  <div v-if="rewind" data-terminal-rewind class="absolute inset-0 z-10 flex flex-col bg-[#1e1e1e]">
    <div ref="container" class="min-h-0 flex-1 p-2"></div>
    <div class="flex items-center gap-3 border-t border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300">
      <History class="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
      <input
        type="range"
        class="min-w-0 flex-1 accent-blue-500"
        aria-label="The moment shown"
        data-terminal-rewind-moment
        :min="rewind.first"
        :max="rewind.last"
        :value="rewind.at"
        @input="seek(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="flex-shrink-0 tabular-nums text-neutral-400" data-terminal-rewind-time>{{ shown }}</span>
      <button
        class="flex-shrink-0 rounded border border-neutral-600 px-2 py-0.5 hover:bg-neutral-800"
        data-terminal-rewind-close
        @click="terminalActor.send({ type: 'terminal.REWIND_CLOSE' })"
      >
        Back to now
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'
import { useSelector } from '@xstate/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { History } from 'lucide-vue-next'
import { type CodeState } from '#features/code/fe/state.ts'
import { rewindViewId, type TerminalInfo } from '#features/code/fe/features/terminal/state.ts'
import { terminalPool } from '#extensions/terminal/pool.ts'
import { panelChild } from '../children.ts'

/** How often a drag of the moment asks for another: each is a screen rebuilt and sent */
const SEEK_EVERY_MS = 50

const props = defineProps<{ terminalInfo: TerminalInfo }>()

const codeActor: CodeState = useSurface()
const terminalActor = panelChild(codeActor, 'terminal')!
const rewind = useSelector(terminalActor, (state) =>
  state.context.rewind?.terminalId === props.terminalInfo.id ? state.context.rewind : null)
const container = ref<HTMLElement>()

const shown = computed(() => rewind.value ? new Date(rewind.value.at).toLocaleTimeString() : '')

// The recording is drawn by a view of its own, pooled under a name no terminal has
watch(() => rewind.value?.session, async (session, _before, onCleanup) => {
  if (!session) return
  await nextTick()
  if (!container.value) return
  const id = rewindViewId(session)
  // A recording is on this machine's broker and has no shell under it, whatever the terminal it is of has
  terminalPool.ensure({ ...props.terminalInfo, id: id as TerminalInfo['id'], session, exited: undefined, target: undefined })
  // Drawn at the grid that fits where it is shown, as a terminal is
  const attachment = terminalPool.attach(id, container.value, {
    onResize: ({ cols, rows }) => terminalActor.send({ type: 'terminal.REWIND_RESIZE', cols, rows }),
  })
  onCleanup(() => { attachment?.release() })
}, { immediate: true })

let wanted: number | undefined
let waiting: ReturnType<typeof setTimeout> | undefined
function seek(at: number) {
  wanted = at
  waiting ??= setTimeout(() => {
    waiting = undefined
    if (wanted !== undefined) terminalActor.send({ type: 'terminal.REWIND_SEEK', at: wanted })
  }, SEEK_EVERY_MS)
}

// Looking back ends with the host that was showing it: a recording nobody is looking at is closed
onBeforeUnmount(() => {
  if (waiting) clearTimeout(waiting)
  if (rewind.value) terminalActor.send({ type: 'terminal.REWIND_CLOSE' })
})
</script>
