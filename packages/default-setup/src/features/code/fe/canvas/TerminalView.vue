<template>
  <TrackedContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div class="relative h-full w-full" @pointerdown.capture="seen">
        <div ref="container" class="h-full w-full bg-[#1e1e1e] p-2"></div>
        <ScrollToBottomFob :visible="showScrollFob" @click="scrollToBottom()" />
        <TerminalRewind :terminal-info="terminalInfo" />
        <ContextMenuPortal>
          <ContextMenuContent :class="MENU_CONTENT_CLASS" :side-offset="5">
            <ContextMenuItem
              v-if="hasSelection"
              @select="copySelection"
              :class="MENU_ITEM_CLASS"
            >
              <Copy class="w-4 h-4" />
              Copy
            </ContextMenuItem>
            <ContextMenuItem @select="pasteClipboard" :class="MENU_ITEM_CLASS">
              <ClipboardPaste class="w-4 h-4" />
              Paste
            </ContextMenuItem>
            <ContextMenuItem @select="selectAll" :class="MENU_ITEM_CLASS">
              <TextSelect class="w-4 h-4" />
              Select All
            </ContextMenuItem>
            <ContextMenuSeparator :class="MENU_SEPARATOR_CLASS" />
            <ContextMenuItem @select="clearTerminal" :class="MENU_ITEM_CLASS">
              <Eraser class="w-4 h-4" />
              Clear
            </ContextMenuItem>
            <TerminalMenuExtras :terminal-id="terminalInfo.id" :attachment="() => attachment" />
            <ContextMenuSeparator :class="MENU_SEPARATOR_CLASS" />
            <ContextMenuItem @select="$emit('restart-terminal')" :class="MENU_ITEM_CLASS">
              <RotateCcw class="w-4 h-4" />
              Restart Terminal
            </ContextMenuItem>
            <ContextMenuItem @select="$emit('kill-terminal')" :class="MENU_ITEM_DANGER_CLASS">
              <Trash2 class="w-4 h-4" />
              Kill Terminal
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </div>
    </ContextMenuTrigger>
  </TrackedContextMenuRoot>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import ScrollToBottomFob from '@apackdev/ui/design/ScrollToBottomFob'
import TrackedContextMenuRoot from '@apackdev/ui/design/TrackedContextMenuRoot'
import {
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
} from 'reka-ui'
import { MENU_ITEM_CLASS, MENU_ITEM_DANGER_CLASS, MENU_CONTENT_CLASS, MENU_SEPARATOR_CLASS } from '#features/code/fe/features/explorer/constants.ts'
import { Copy, ClipboardPaste, TextSelect, Eraser, RotateCcw, Trash2 } from 'lucide-vue-next'
import { type CodeState } from '#features/code/fe/state.ts'
import type { TerminalInfo } from '#features/code/fe/features/terminal/state.ts'
import { terminalPool, type TerminalAttachment } from '#features/code/fe/utils/terminal-pool.ts'
import TerminalMenuExtras from '#features/code/fe/features/terminal/TerminalMenuExtras.vue'
import TerminalRewind from '#features/code/fe/features/terminal/TerminalRewind.vue'
import { panelChild } from '../features/children.ts';

/* --------------------------------------------------------------------------
 * Props & actor -------------------------------------------------------------------------- */
const props = defineProps<{
  terminalInfo: TerminalInfo
}>()

defineEmits<{
  'kill-terminal': []
  'restart-terminal': []
}>()

const codeActor: CodeState = useSurface()
const terminalActor = panelChild(codeActor, 'terminal')

/* --------------------------------------------------------------------------
 * Refs --------------------------------------------------------------------- */
const container = ref<HTMLElement>()
// **The whole of this host's reach into the terminal.** No emulator type crosses it: the pool owns the
// instance, its listeners and its size observer, so this component holds a terminal id and a container.
let attachment: TerminalAttachment | null = null
// Whether the session is following its output. The pool owns the value — it survives the unmount a tab
// switch causes — and this is the reactive mirror the scroll control is drawn from.
const isFollowingOutput = ref(true)
const showScrollFob = computed(() => !isFollowingOutput.value)
const hasSelection = ref(false)

/* --------------------------------------------------------------------------
 * Context menu actions ----------------------------------------------------- */
const scrollToBottom = () => attachment?.followOutput()

const copySelection = () => { void attachment?.copy() }

const pasteClipboard = () => {
  // As a paste rather than as input: the program is told it is one, and one that could run a command is
  // shown to the person first
  void navigator.clipboard.readText().then(text => {
    if (text) attachment?.paste(text)
  }).catch(() => {})
}

const selectAll = () => attachment?.selectAll()

const clearTerminal = () => attachment?.clear()

/** The person is looking at this terminal, so what was waiting for them to has been seen */
const seen = () => terminalActor?.send({ type: 'terminal.SEEN', terminalId: props.terminalInfo.id })

/* --------------------------------------------------------------------------
 * Lifecycle ---------------------------------------------------------------- */
/** Whether this host is still the one mounted */
let mounted = false

onMounted(() => {
  if (!container.value) return
  mounted = true

  // The view is the pool's: this never makes or disposes one, and what is typed goes from the view to
  // its session without passing through here
  terminalPool.ensure(props.terminalInfo)
  if (!mounted || !container.value) return

  attachment = terminalPool.attach(props.terminalInfo.id, container.value, {
    onResize: ({ cols, rows, cellWidth, cellHeight }) => {
      terminalActor?.send({ type: 'terminal.RESIZE', terminalId: props.terminalInfo.id, cols, rows, cellWidth, cellHeight })
    },
    onSelectionChange: has => { hasSelection.value = has },
    onFollowingChange: following => { isFollowingOutput.value = following },
    // A path a program printed opens as the file it names, where the explorer opens every other
    onOpenPath: (path, at) => {
      panelChild(codeActor, 'explorer')?.send({ type: 'explorer.OPEN_FILE', path })
      // Shown at the line the program named, once the file is the one showing
      if (at) codeActor.send({ type: 'UPDATE_STATE', updates: { pendingRevealLine: { filePath: path, line: at.line, column: at.column } } })
    },
  })
  seen()

  // **Not focused on mount** (F15). A terminal mounts on a tab switch, a panel drag and an actor
  // replacement, none of which is the user asking for it — and taking focus from what they were typing in
  // is the whole defect. The view exposes `focus()` for the cases that *are* a request.
})

onBeforeUnmount(() => {
  mounted = false
  // The view is not disposed — it survives in the pool until `terminal.CLOSED`. Releasing is also how a
  // host that another has already taken over from detaches nothing (F1): during a remount the new host
  // attaches before this one unmounts.
  const letGo = attachment?.release() ?? false
  // The backend holds the grid to the smallest fit of the windows showing it, so a window that stops
  // showing one says so. Only when this host is what let go — during a remount the new host has already
  // attached (F1), and this would drop the fit it just recorded.
  if (letGo && attachment) terminalActor?.send({ type: 'terminal.DETACHED', terminalId: attachment.terminalId })
  attachment = null
})

/* --------------------------------------------------------------------------
 * Public API (exposed to parent via refs) ---------------------------------- */
function focus() {
  attachment?.focus()
}

defineExpose({ focus })
</script>

