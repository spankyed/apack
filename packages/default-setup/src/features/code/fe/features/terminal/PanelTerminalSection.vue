<template>
  <div class="flex-shrink-0 border-t border-neutral-800">
    <!-- Collapsible header -->
    <div
      class="flex items-center justify-between p-3 px-5 cursor-pointer hover:bg-neutral-800/60 transition-colors"
      @click="codeActor.send({ type: 'TOGGLE_PANEL_TERMINAL' })"
      @contextmenu.prevent="onSectionContextMenu"
    >
      <div class="flex items-center gap-1 text-xs font-medium text-neutral-400">
        <ChevronRight v-if="!isExpanded" class="w-3 h-3" />
        <ChevronDown v-else class="w-3 h-3" />
        TERMINAL
      </div>
      <div class="flex items-center gap-1" @click.stop>
        <RunScriptPopover :scripts="terminalScripts" @run="runScript" @run-new="runScriptInNewTerminal" @update="updateScripts" />
        <button
          @click="stopTerminal"
          class="p-1 hover:bg-neutral-700 rounded transition-colors"
          title="Stop (Ctrl+C)"
          :disabled="!panelTerminalId"
        >
          <Square class="w-3 h-3 text-neutral-400 fill-neutral-400" :class="{ 'opacity-30': !panelTerminalId }" />
        </button>
        <button
          @click="createTerminal"
          class="p-1 hover:bg-neutral-700 rounded transition-colors"
          title="New Terminal"
        >
          <Plus class="w-3.5 h-3.5 text-neutral-400" />
        </button>
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button class="p-1 hover:bg-neutral-700 rounded transition-colors" title="Terminal actions">
              <Ellipsis class="w-3.5 h-3.5 text-neutral-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="min-w-[160px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50" :side-offset="5">
              <DropdownMenuItem
                @select="killAllTerminals"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-red-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              >
                <Trash2 :size="16" />
                Kill All Terminals
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
    </div>

    <!-- Expanded content: terminal + list side-by-side -->
    <div v-if="isExpanded" class="flex overflow-hidden" :style="{ height: `${height}px` }">
      <!-- Terminal view (left) -->
      <div class="flex-1 min-w-0">
        <TrackedContextMenuRoot v-if="activeTerminalInfo">
          <ContextMenuTrigger as-child>
            <div ref="container" class="w-full h-full bg-[#1e1e1e]"></div>
          </ContextMenuTrigger>
          <ContextMenuPortal>
            <ContextMenuContent :class="MENU_CONTENT_CLASS" :side-offset="5">
              <ContextMenuItem v-if="hasSelection" @select="copySelection" :class="MENU_ITEM_CLASS">
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
              <ContextMenuItem @select="restartPanelTerminal" :class="MENU_ITEM_CLASS">
                <RotateCcw class="w-4 h-4" />
                Restart Terminal
              </ContextMenuItem>
              <ContextMenuItem @select="killPanelTerminal" :class="MENU_ITEM_DANGER_CLASS">
                <Trash2 class="w-4 h-4" />
                Kill Terminal
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuPortal>
        </TrackedContextMenuRoot>
        <div v-else class="flex items-center justify-center h-full text-xs text-neutral-500">
          No terminal selected
        </div>
      </div>

      <!-- Resize handle between terminal and list -->
      <div
        v-if="terminals.length > 0"
        class="w-0 h-full flex-shrink-0 relative cursor-col-resize group z-10"
        @mousedown.prevent="startListResize"
      >
        <div class="absolute top-0 bottom-0 -left-1 w-2 group-hover:bg-blue-500/50 transition-colors" />
      </div>

      <!-- Terminal list (right sidebar) -->
      <div v-if="terminals.length > 0" class="flex-shrink-0 border-l border-neutral-800 overflow-y-auto" :style="{ width: `${listWidth}px` }">
        <ContextMenuRoot v-for="terminal in terminals" :key="terminal.id">
          <ContextMenuTrigger as-child>
            <div
              @click="!isInTab(terminal.id) ? selectTerminal(terminal.id) : undefined"
              class="group flex items-center gap-1.5 px-2 py-1.5 text-xs transition-colors"
              :class="[
                isInTab(terminal.id)
                  ? 'text-neutral-600 cursor-default'
                  : panelTerminalId === terminal.id
                    ? 'bg-neutral-800 text-neutral-200 cursor-pointer'
                    : 'text-neutral-400 hover:bg-neutral-800/50 cursor-pointer'
              ]"
              :title="getShellName(terminal.shell) + ' — ' + getTerminalDisplayName(terminal) + (isInTab(terminal.id) ? ' (in tab)' : '')"
            >
              <TerminalIcon class="w-3 h-3 flex-shrink-0" />
              <!-- Inline rename input -->
              <div v-if="renamingTerminalId === terminal.id" @click.stop class="flex-1 min-w-0">
                <input
                  ref="renameInput"
                  v-model="renameValue"
                  @blur="finishRename"
                  @keydown.enter="finishRename"
                  @keydown.esc="cancelRename"
                  class="w-full px-1 text-xs bg-transparent border border-primary-500 rounded text-neutral-200 focus:outline-none"
                />
              </div>
              <span v-else class="flex-1 min-w-0 truncate">{{ getTerminalDisplayName(terminal) }}</span>
              <button
                v-if="renamingTerminalId !== terminal.id"
                @click.stop="handleCloseTerminal(terminal)"
                class="p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                title="Close terminal"
              >
                <X class="w-2.5 h-2.5 text-neutral-500 hover:text-red-400" />
              </button>
            </div>
          </ContextMenuTrigger>

          <ContextMenuPortal>
            <ContextMenuContent class="min-w-[160px] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 z-50">
              <ContextMenuItem
                v-if="!isInTab(terminal.id)"
                @select="openInTab(terminal.id)"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              >
                <PanelTop :size="16" />
                Open in Tab
              </ContextMenuItem>
              <ContextMenuItem
                v-if="isInTab(terminal.id)"
                @select="moveToPanel(terminal.id)"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              >
                <PanelBottom :size="16" />
                Move back here
              </ContextMenuItem>
              <ContextMenuItem
                @select="startRename(terminal)"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              >
                <Edit :size="16" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                @select="handleCloseTerminal(terminal)"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-red-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              >
                <Trash2 :size="16" />
                Close Terminal
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuPortal>
        </ContextMenuRoot>
      </div>
    </div>

    <ContextMenuPopup
      :show="showMenu"
      :pos="menuPos"
      :items="sectionMenuItems"
      @close="showMenu = false"
    />
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { useSettings } from '#generated/settings-fe.ts'
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useSelector } from '@xstate/vue'
import { ChevronRight, ChevronDown, Plus, X, Edit, Trash2, PanelTop, PanelBottom, Terminal as TerminalIcon, Ellipsis, Square, Copy, ClipboardPaste, TextSelect, Eraser, RotateCcw } from 'lucide-vue-next'
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
} from 'reka-ui'
import TrackedContextMenuRoot from '@apackdev/ui/design/TrackedContextMenuRoot'
import { MENU_ITEM_CLASS, MENU_ITEM_DANGER_CLASS, MENU_CONTENT_CLASS, MENU_SEPARATOR_CLASS } from '#features/code/fe/features/explorer/constants.ts'
import type { CodeState } from '#features/code/fe/state.ts'
import type { TerminalInfo } from './state.ts'
import { terminalPool } from '#features/code/fe/utils/terminal-pool.ts'
import { useTerminalActions } from '#features/code/fe/composables/useTerminalActions.ts'
import RunScriptPopover from './RunScriptPopover.vue'
import ContextMenuPopup from '@apackdev/ui/design/ContextMenuPopup'
import { useSectionVisibilityMenu } from '#features/code/fe/composables/useSectionVisibilityMenu.ts'
import type { TerminalScript } from '#generated/types.ts'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { IDisposable } from '@xterm/xterm'
import { codeChild } from '../children.ts';

const props = withDefaults(defineProps<{ height?: number }>(), { height: 256 })

// Actors
const codeActor: CodeState = useSurface()
const terminalActor = codeChild(codeActor, 'terminal')!

// State selectors
const panelTerminalId = useSelector(codeActor, (state) => state.context.panelTerminalId)
const openFiles = useSelector(codeActor, (state) => state.context.openFiles)
const terminals = useSelector(terminalActor, (state) => state.context.terminals)

const featureSettings = useSettings('code')
const storedCodeSettings = featureSettings.value
const confirmTerminalClose = computed(() => storedCodeSettings.value?.confirmTerminalClose ?? true)
const closeTerminalOnTabClose = computed(() => storedCodeSettings.value?.closeTerminalOnTabClose ?? true)
const terminalScripts = computed(() => (storedCodeSettings.value?.terminalScripts ?? []) as TerminalScript[])

const { getTerminalDisplayName, } = useTerminalActions(terminalActor, confirmTerminalClose, closeTerminalOnTabClose)

// Section visibility context menu
const codeSettings = useSelector(codeActor, (state) => state.context.settings)
const { showMenu, menuPos, sectionMenuItems, onSectionContextMenu } = useSectionVisibilityMenu(codeSettings)

// Derived
const activeTerminalInfo = computed(() =>
  terminals.value.find((t: TerminalInfo) => t.id === panelTerminalId.value)
)
const isInTab = (terminalId: string) =>
  openFiles.value.some((f: any) => f.path === `terminal:${terminalId}` && f.isTerminal)
const getShellName = (shell?: string) => shell?.split('/').pop() ?? 'terminal'

// Local state
const isExpanded = useSelector(codeActor, (state) => state.context.panelTerminalExpanded)
const container = ref<HTMLElement>()
const listWidth = ref(125)
const MIN_LIST_WIDTH = 80
const MAX_LIST_WIDTH = 300

// Terminal rendering
const hasSelection = ref(false)
let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let attachedTerminalId: string | null = null  // tracks which terminal is actually attached to the DOM
const viewDisposables: IDisposable[] = []

/** Set by `selectTerminal`, read by the attach it causes: whether this attach is a user's request (F15) */
let focusOnAttach = false

const attachTerminal = (terminalId: string) => {
  const info = terminals.value.find((t: TerminalInfo) => t.id === terminalId)
  if (!container.value || !info) return

  const sendInput = (data: string) => {
    terminalActor?.send({ type: 'terminal.INPUT', terminalId, data })
  }

  const entry = terminalPool.ensure(info, sendInput)
  terminalPool.attach(terminalId, container.value)
  attachedTerminalId = terminalId

  term = entry.term
  fitAddon = entry.fitAddon

  // Defer fit to next frame so the browser has laid out the re-attached wrapper
  requestAnimationFrame(() => {
    fitAddon?.fit()
    sendResize(terminalId)
    terminalPool.syncViewport(terminalId)
  })

  // The session's own scroll policy, not this host's: the canvas honoured pinning and this scrolled to the
  // bottom on every write, so the same terminal jumped under the user here and not there (F2)
  viewDisposables.push(term.onWriteParsed(() => {
    if (terminalPool.isPinned(terminalId)) term?.scrollToBottom()
  }))

  // And this host updates that policy, so scrolling back in the panel holds while output arrives
  const viewport = term.element?.querySelector('.xterm-viewport') as HTMLElement | null
  if (viewport) {
    const onScroll = () => {
      const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 2
      terminalPool.setPinned(terminalId, atBottom)
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    viewDisposables.push({ dispose: () => viewport.removeEventListener('scroll', onScroll) })
  }

  viewDisposables.push(term.onResize(({ cols, rows }) => {
    terminalActor?.send({ type: 'terminal.RESIZE', terminalId, cols, rows })
  }))

  viewDisposables.push(term.onSelectionChange(() => {
    hasSelection.value = !!term?.getSelection()
  }))

  resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      fitAddon?.fit()
      if (attachedTerminalId) terminalPool.syncViewport(attachedTerminalId)
    })
  })
  resizeObserver.observe(container.value)

  // **Focused only when the user asked for this terminal** (F15). This runs on mount too — a panel re-open,
  // an actor replacement, a reconnect — none of which is a request, and taking focus from what they were
  // typing in is the defect. `selectTerminal` is the request, and sets the flag the attach it triggers reads.
  if (focusOnAttach) {
    focusOnAttach = false
    term.focus()
  }
}

const detachTerminal = () => {
  resizeObserver?.disconnect()
  resizeObserver = null
  for (const d of viewDisposables) {
    try { d.dispose() } catch { /* ignore */ }
  }
  viewDisposables.length = 0
  if (attachedTerminalId) {
    // Named, so a host another has taken over from detaches nothing (F1)
    terminalPool.detach(attachedTerminalId, container.value ?? undefined)
    attachedTerminalId = null
  }
  hasSelection.value = false
  term = null
  fitAddon = null
}

const sendResize = (terminalId: string) => {
  if (!term) return
  terminalActor?.send({
    type: 'terminal.RESIZE',
    terminalId,
    cols: term.cols,
    rows: term.rows
  })
}

// Context menu actions
const copySelection = () => {
  if (!term) return
  const selection = term.getSelection()
  if (selection) navigator.clipboard.writeText(selection)
}

const pasteClipboard = async () => {
  if (!term || !panelTerminalId.value) return
  const text = await navigator.clipboard.readText()
  if (text) {
    terminalActor?.send({ type: 'terminal.INPUT', terminalId: panelTerminalId.value, data: text })
  }
}

const selectAll = () => {
  term?.selectAll()
}

const clearTerminal = () => {
  term?.clear()
}

const killPanelTerminal = () => {
  if (!panelTerminalId.value) return
  terminalActor.send({ type: 'terminal.CLOSE', terminalId: panelTerminalId.value })
}

const restartPanelTerminal = () => {
  const info = activeTerminalInfo.value
  if (!info || !panelTerminalId.value) return
  // `terminal.CREATE` carries no shell — the event the child sends the system has only title and cwd — so the
  // restarted terminal takes the default shell, as it always has. Passing `info.shell` here only looked otherwise.
  const { cwd } = info
  terminalActor.send({ type: 'terminal.CLOSE', terminalId: panelTerminalId.value })
  terminalActor.send({ type: 'terminal.CREATE', cwd })
}

// Actions
const stopTerminal = () => {
  if (!panelTerminalId.value) return
  terminalActor?.send({ type: 'terminal.INPUT', terminalId: panelTerminalId.value, data: '\x03' })
}

const createTerminal = () => {
  terminalActor?.send({ type: 'terminal.CREATE' })
  if (!isExpanded.value) {
    codeActor.send({ type: 'TOGGLE_PANEL_TERMINAL' })
  }
}

const runScript = (script: TerminalScript) => {
  const hasPanel = panelTerminalId.value && terminals.value.some((t: TerminalInfo) => t.id === panelTerminalId.value)
  if (hasPanel) {
    // Reuse existing panel terminal
    terminalActor?.send({ type: 'terminal.INPUT', terminalId: panelTerminalId.value!, data: script.command + '\n' })
  } else {
    // No panel terminal — create a new one
    terminalActor?.send({ type: 'terminal.CREATE', title: script.label, command: script.command })
  }
  if (!isExpanded.value) {
    codeActor.send({ type: 'TOGGLE_PANEL_TERMINAL' })
  }
}

const runScriptInNewTerminal = (script: TerminalScript) => {
  terminalActor?.send({ type: 'terminal.CREATE', title: script.label, command: script.command })
  if (!isExpanded.value) {
    codeActor.send({ type: 'TOGGLE_PANEL_TERMINAL' })
  }
}

const updateScripts = (scripts: TerminalScript[]) => {
  featureSettings.set({ path: ['terminalScripts'], value: scripts })
}

const killAllTerminals = () => {
  if (terminals.value.length === 0) return
  if (confirmTerminalClose.value && !confirm(`Kill all ${terminals.value.length} terminals?`)) return
  // The copy is the point: `terminals` is a selector over the actor's state and `send` is synchronous, so
  // closing one shortens the array being iterated.
  // eslint-disable-next-line no-useless-spread
  for (const terminal of [...terminals.value]) {
    terminalActor?.send({ type: 'terminal.CLOSE', terminalId: terminal.id })
  }
}

const selectTerminal = (terminalId: string) => {
  // The selection is what attaches, a tick later, so the request is recorded rather than acted on here
  focusOnAttach = true
  codeActor.send({ type: 'SELECT_PANEL_TERMINAL', terminalId })
}

const openInTab = (terminalId: string) => {
  codeActor.send({ type: 'OPEN_TERMINAL_IN_TAB', terminalId })
}

const moveToPanel = (terminalId: string) => {
  codeActor.send({ type: 'MOVE_TERMINAL_TO_PANEL', path: `terminal:${terminalId}` })
}

const handleCloseTerminal = (terminal: TerminalInfo) => {
  if (confirmTerminalClose.value) {
    const displayName = getTerminalDisplayName(terminal)
    if (!confirm(`Close terminal "${displayName}"?`)) return
  }
  terminalActor?.send({ type: 'terminal.CLOSE', terminalId: terminal.id })
}

// List resize
const startListResize = (e: MouseEvent) => {
  const startX = e.clientX
  const startWidth = listWidth.value

  let rafPending = false
  const onMouseMove = (e: MouseEvent) => {
    const delta = startX - e.clientX // dragging left = wider list
    listWidth.value = Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, startWidth + delta))
    if (!rafPending) {
      rafPending = true
      requestAnimationFrame(() => {
        fitAddon?.fit()
        rafPending = false
      })
    }
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// Rename
const renamingTerminalId = ref<string | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement[]>([])

const startRename = (terminal: TerminalInfo) => {
  renamingTerminalId.value = terminal.id
  renameValue.value = terminal.customTitle || terminal.cwd.split('/').filter(Boolean).pop() || terminal.title
}

// Focus the rename input when it appears + click-outside to dismiss
watch(renamingTerminalId, async (id) => {
  if (id) {
    // Wait for Vue to render the input, then focus
    await nextTick()
    // May need a second tick for the v-for array ref to populate
    await nextTick()
    const input = renameInput.value?.[0]
    input?.focus()
    input?.select()
    document.addEventListener('mousedown', onDocumentClick, true)
  } else {
    document.removeEventListener('mousedown', onDocumentClick, true)
  }
})

const onDocumentClick = (e: MouseEvent) => {
  if (!renamingTerminalId.value) return
  const input = renameInput.value?.[0]
  if (input && !input.contains(e.target as Node)) {
    finishRename()
  }
}

const finishRename = () => {
  if (renamingTerminalId.value && renameValue.value.trim()) {
    terminalActor?.send({
      type: 'terminal.RENAME',
      terminalId: renamingTerminalId.value,
      customTitle: renameValue.value.trim()
    })
  }
  cancelRename()
}

const cancelRename = () => {
  renamingTerminalId.value = null
  renameValue.value = ''
}

// Attach on mount if values are already available (e.g. after inspection panel re-open,
// where the watcher below won't fire because all values are already stable).
onMounted(() => {
  const expanded = isExpanded.value
  const termId = panelTerminalId.value
  const info = activeTerminalInfo.value
  if (expanded && termId && info && !attachedTerminalId) {
    attachTerminal(termId)
  }
})

// Watch expand/collapse, panelTerminalId, and activeTerminalInfo (for when terminals list arrives after expand)
watch([isExpanded, panelTerminalId, activeTerminalInfo], async ([expanded, termId, info]) => {
  if (expanded && termId && info) {
    // Detach old terminal if switching
    if (attachedTerminalId && attachedTerminalId !== termId) {
      detachTerminal()
    }
    // Only attach if not already attached to this terminal
    if (attachedTerminalId !== termId) {
      await nextTick()
      attachTerminal(termId)
    }
  } else if (!expanded || !termId) {
    detachTerminal()
  }
})

onBeforeUnmount(() => {
  detachTerminal()
  document.removeEventListener('mousedown', onDocumentClick, true)
})
</script>

<style scoped>
:deep(.xterm) {
  height: 100%;
  padding: 4px 8px;
}

:deep(.xterm-viewport) {
  background-color: transparent !important;
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
