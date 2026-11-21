<!--
  The terminal's own entries in its context menu, for whichever host draws one: finding text, copying what
  the last command printed, keeping the shell running when the app is not, and looking back through what
  it printed. Rendered inside the host's menu content, so the two hosts offer the same things.
-->
<template>
  <ContextMenuItem data-terminal-menu="find" @select="attachment()?.find()" :class="MENU_ITEM_CLASS">
    <Search class="w-4 h-4" />
    Find…
  </ContextMenuItem>
  <ContextMenuItem
    data-terminal-menu="copy-output"
    :disabled="!hasCommands"
    @select="copyLastOutput"
    :class="[MENU_ITEM_CLASS, !hasCommands && 'opacity-40']"
  >
    <ClipboardCopy class="w-4 h-4" />
    Copy Last Command Output
  </ContextMenuItem>
  <ContextMenuSeparator :class="MENU_SEPARATOR_CLASS" />
  <ContextMenuItem
    v-if="live?.active && (live.recorded || live.target)"
    data-terminal-menu="keep"
    @select="terminalActor.send({ type: 'terminal.KEEP', terminalId: terminalId, kept: !live.kept })"
    :class="MENU_ITEM_CLASS"
  >
    <component :is="live.kept ? PinOff : Pin" class="w-4 h-4" />
    {{ live.kept ? 'Stop Keeping It Running' : 'Keep Running When the App Quits' }}
  </ContextMenuItem>
  <ContextMenuItem v-if="live?.recorded" data-terminal-menu="rewind" @select="lookBack" :class="MENU_ITEM_CLASS">
    <History class="w-4 h-4" />
    Look Back…
  </ContextMenuItem>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'
import { useSelector } from '@xstate/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ContextMenuItem, ContextMenuSeparator } from 'reka-ui'
import { ClipboardCopy, History, Pin, PinOff, Search } from 'lucide-vue-next'
import { MENU_ITEM_CLASS, MENU_SEPARATOR_CLASS } from '#features/code/fe/features/explorer/constants.ts'
import { type CodeState } from '#features/code/fe/state.ts'
import type { TerminalAttachment } from '#extensions/terminal/pool.ts'
import { panelChild } from '../children.ts'

const props = defineProps<{
  terminalId: string
  /** The host's hold on the terminal, asked for when an entry is chosen: it changes as hosts remount */
  attachment: () => TerminalAttachment | null
}>()

const codeActor: CodeState = useSurface()
const terminalActor = panelChild(codeActor, 'terminal')!
/** The terminal as the list has it now, which a tab's copy of it is not */
const live = useSelector(terminalActor, (state) => state.context.terminals.find(terminal => terminal.id === props.terminalId))

// This is mounted when the menu opens, which is the moment the question is about
const hasCommands = ref(false)
onMounted(() => { hasCommands.value = props.attachment()?.hasCommands() ?? false })
onBeforeUnmount(() => { hasCommands.value = false })

const copyLastOutput = () => { void props.attachment()?.copyLastOutput() }

const lookBack = () => {
  const terminal = live.value
  if (terminal) terminalActor.send({ type: 'terminal.REWIND', terminalId: terminal.id, cols: terminal.cols, rows: terminal.rows })
}
</script>
