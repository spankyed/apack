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
import type { Terminal, IDisposable } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { type CodeState } from '#features/code/fe/state.ts'
import type { TerminalInfo } from '#features/code/fe/features/terminal/state.ts'
import { terminalPool } from '#features/code/fe/utils/terminal-pool.ts'
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
let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
const viewDisposables: IDisposable[] = []
// Pin state is owned by the pool (survives tab-switch remounts); this ref is
// just a reactive mirror so the FOB can show/hide. Always write both.
const isPinnedToBottom = ref(true)
const showScrollFob = computed(() => !isPinnedToBottom.value)
const hasSelection = ref(false)

/* --------------------------------------------------------------------------
 * Helpers ------------------------------------------------------------------ */
const scrollToBottom = () => {
  isPinnedToBottom.value = true
  terminalPool.setPinned(props.terminalInfo.id, true)
  terminalPool.syncViewport(props.terminalInfo.id)
}

const sendResize = () => {
  if (!term) return
  terminalActor?.send({
    type: 'terminal.RESIZE',
    terminalId: props.terminalInfo.id,
    cols: term.cols,
    rows: term.rows
  })
}

/* --------------------------------------------------------------------------
 * Context menu actions ----------------------------------------------------- */
const copySelection = () => {
  if (!term) return
  const selection = term.getSelection()
  // A clipboard the window may not read or write rejects; unhandled, that is a console error nobody can
  // act on (F16)
  if (selection) void navigator.clipboard.writeText(selection).catch(() => {})
}

const pasteClipboard = async () => {
  if (!term) return
  // **Through the emulator, not as input** (F12): `term.paste` wraps the text in the bracketed-paste
  // markers when the application has asked for them, which is how a shell or an editor tells a paste from
  // typing. Sent as input, a pasted newline runs a command.
  const text = await navigator.clipboard.readText().catch(() => '')
  if (text) term.paste(text)
}

const selectAll = () => {
  term?.selectAll()
}

const clearTerminal = () => {
  term?.clear()
}

/* --------------------------------------------------------------------------
 * Lifecycle ---------------------------------------------------------------- */
onMounted(() => {
  if (!container.value) return

  const sendInput = (data: string) => {
    terminalActor?.send({ type: 'terminal.INPUT', terminalId: props.terminalInfo.id, data })
  }

  // Ensure a pool entry exists for this terminal, then attach its wrapper
  // into our container. The xterm instance lives in the pool — we never
  // construct or dispose it here.
  const entry = terminalPool.ensure(props.terminalInfo, sendInput)
  terminalPool.attach(props.terminalInfo.id, container.value)

  term = entry.term
  fitAddon = entry.fitAddon
  // Mirror pool-owned pin state into a local reactive ref for FOB visibility.
  isPinnedToBottom.value = entry.pinnedToBottom

  // Defer fit to next frame so the browser has laid out the re-attached wrapper
  // and container dimensions are accurate for cols/rows calculation.
  requestAnimationFrame(() => {
    fitAddon?.fit()
    sendResize()
    terminalPool.syncViewport(props.terminalInfo.id)
  })

  // Track user scroll to support "pin to bottom"
  const viewport = term.element?.querySelector('.xterm-viewport') as HTMLElement | null
  if (viewport) {
    const onScroll = () => {
      const pinned = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 10
      isPinnedToBottom.value = pinned
      terminalPool.setPinned(props.terminalInfo.id, pinned)
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    viewDisposables.push({ dispose: () => viewport.removeEventListener('scroll', onScroll) })
  }

  // Track selection for the context menu
  viewDisposables.push(term.onSelectionChange(() => {
    hasSelection.value = !!term?.getSelection()
  }))

  // Auto-scroll on live writes while pinned. During live writes xterm's
  // own scroll-follow works (ydisp advances with ybase), so the cheap
  // in-tree scrollToBottom suffices — no pool round-trip needed.
  viewDisposables.push(term.onWriteParsed(() => {
    if (isPinnedToBottom.value) term?.scrollToBottom()
  }))

  // Forward xterm resize (driven by fit()) to the backend pty
  viewDisposables.push(term.onResize(({ cols, rows }) => {
    terminalActor?.send({ type: 'terminal.RESIZE', terminalId: props.terminalInfo.id, cols, rows })
  }))

  // Keep the terminal sized with its container
  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit()
    sendResize()
    if (isPinnedToBottom.value) terminalPool.syncViewport(props.terminalInfo.id)
  })
  resizeObserver.observe(container.value)

  // **Not focused on mount** (F15). A terminal mounts on a tab switch, a panel drag and an actor
  // replacement, none of which is the user asking for it — and taking focus from what they were typing in
  // is the whole defect. The view exposes `focus()` for the cases that *are* a request.
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null

  for (const d of viewDisposables) {
    try { d.dispose() } catch { /* ignore */ }
  }
  viewDisposables.length = 0

  // Detach the pool's wrapper from our container but DO NOT dispose the xterm
  // instance — it survives in the pool until terminal.CLOSED. **Our container is named**, so a host that
  // another has already taken over from detaches nothing (F1): during a remount the new host attaches
  // before this one unmounts.
  terminalPool.detach(props.terminalInfo.id, container.value ?? undefined)

  term = null
  fitAddon = null
})

/* --------------------------------------------------------------------------
 * Public API (exposed to parent via refs) ---------------------------------- */
function focus() {
  term?.focus()
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
