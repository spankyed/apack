<template>
  <TrackedContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div class="relative h-full w-full">
        <div ref="container" class="h-full w-full bg-[#1e1e1e]"></div>
        <ScrollToBottomFob :visible="showScrollFob" @click="scrollToBottom()" />
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
import { codeChild } from '../features/children.ts';

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
const terminalActor = codeChild(codeActor, 'terminal')

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

const copySelection = () => {
  const selection = attachment?.selection()
  // A clipboard the window may not read or write rejects; unhandled, that is a console error nobody can
  // act on (F16)
  if (selection) void navigator.clipboard.writeText(selection).catch(() => {})
}

const pasteClipboard = () => {
  // Through the emulator rather than as input (F12), which the attachment is the one way to do
  void navigator.clipboard.readText().then(text => {
    if (text) attachment?.paste(text)
  }).catch(() => {})
}

const selectAll = () => attachment?.selectAll()

const clearTerminal = () => attachment?.clear()

/* --------------------------------------------------------------------------
 * Lifecycle ---------------------------------------------------------------- */
onMounted(() => {
  if (!container.value) return

  // The emulator is the pool's: this never constructs or disposes one
  terminalPool.ensure(props.terminalInfo, data => {
    terminalActor?.send({ type: 'terminal.INPUT', terminalId: props.terminalInfo.id, data })
  })
  attachment = terminalPool.attach(props.terminalInfo.id, container.value, {
    onResize: ({ cols, rows }) => {
      terminalActor?.send({ type: 'terminal.RESIZE', terminalId: props.terminalInfo.id, cols, rows })
    },
    onSelectionChange: has => { hasSelection.value = has },
    onFollowingChange: following => { isFollowingOutput.value = following },
  })

  // **Not focused on mount** (F15). A terminal mounts on a tab switch, a panel drag and an actor
  // replacement, none of which is the user asking for it — and taking focus from what they were typing in
  // is the whole defect. The view exposes `focus()` for the cases that *are* a request.
})

onBeforeUnmount(() => {
  // The emulator is not disposed — it survives in the pool until `terminal.CLOSED`. Releasing is also how a
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

<style scoped>
/* Terminal container should not create its own scroll */
:host,
:deep(.xterm) {
  height: 100%;
  padding: 8px;
}

/* Terminal-specific scrollbar styling */
:deep(.xterm-viewport) {
  background-color: transparent !important;
  /* Override global scrollbar styles for terminal */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 14px;
  height: 14px;
  background-color: rgba(0, 0, 0, 0.1);
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 0;
  border: 3px solid transparent;
  background-clip: padding-box;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: rgba(255, 255, 255, 0.3);
}

:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background-color: transparent;
  border: none;
}

:deep(.xterm-viewport::-webkit-scrollbar-corner) {
  background-color: transparent;
}
</style>
