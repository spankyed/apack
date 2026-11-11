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
                v-for="target in terminalTargets"
                :key="target.id"
                :data-terminal-target="target.id"
                @select="createTerminalOn(target.id)"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-neutral-200 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              >
                <Server :size="16" />
                New Terminal on {{ target.label }}
              </DropdownMenuItem>
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
          <!--
            **The container is a child of the trigger's element, never the element itself.** `as-child` makes
            reka-ui clone this trigger's child, and a template ref bound on the element it clones is bound for
            the first instance of this component in the process and no later one: a remount reaches
            `attachTerminal` with `container` undefined, returns at its own guard and draws nothing — no error,
            no warning, a blank panel until the window is reloaded. A `SurfaceScope` replacement or this
            section being `v-if`'d out and back is such a remount. `TerminalView.vue` was never affected
            because its ref is a grandchild of the trigger, which is the shape this now matches.
          -->
          <ContextMenuTrigger as-child>
            <div class="relative w-full h-full" @pointerdown.capture="seenPanelTerminal">
              <div ref="container" class="w-full h-full bg-[#1e1e1e] py-1 px-2"></div>
              <TerminalRewind :key="activeTerminalInfo.id" :terminal-info="activeTerminalInfo" />
            </div>
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
              <TerminalMenuExtras :terminal-id="activeTerminalInfo.id" :attachment="() => attachment" />
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
              data-terminal-row
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
              <span
                v-if="terminal.target"
                class="flex-shrink-0 rounded bg-neutral-700/60 px-1 text-[10px] text-neutral-300"
                :title="`Runs on ${terminal.target.label}`"
                data-terminal-on
              >{{ terminal.target.label }}</span>
              <TerminalActivityBadge :activity="activity[terminal.id]" :kept="terminal.kept === true" />
              <!-- **A terminal whose shell died is kept so its last output can be read**, which only works
                   if the list says so: drawn like a live one, it invites typing that goes nowhere and gives
                   no reason for the screen having stopped. -->
              <span
                v-if="terminal.exited"
                class="flex-shrink-0 text-[10px] uppercase tracking-wide text-amber-500/80"
                :title="exitedTitle(terminal)"
              >{{ terminal.exited.unreached ? 'not connected' : 'exited' }}</span>
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
import { ChevronRight, ChevronDown, Plus, X, Edit, Trash2, PanelTop, PanelBottom, Terminal as TerminalIcon, Ellipsis, Square, Copy, ClipboardPaste, TextSelect, Eraser, RotateCcw, Server } from 'lucide-vue-next'
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
import { terminalNameFor } from '#features/code/fe/utils/terminal-name.ts'
import { useTerminalActions } from '#features/code/fe/composables/useTerminalActions.ts'
import RunScriptPopover from './RunScriptPopover.vue'
import TerminalActivityBadge from './TerminalActivityBadge.vue'
import TerminalMenuExtras from './TerminalMenuExtras.vue'
import TerminalRewind from './TerminalRewind.vue'
import ContextMenuPopup from '@apackdev/ui/design/ContextMenuPopup'
import { useSectionVisibilityMenu } from '#features/code/fe/composables/useSectionVisibilityMenu.ts'
import type { TerminalScript } from '#generated/types.ts'
import type { TerminalAttachment } from '#features/code/fe/utils/terminal-pool.ts'
import { panelChild } from '../children.ts';

const props = withDefaults(defineProps<{ height?: number }>(), { height: 256 })

// Actors
const codeActor: CodeState = useSurface()
const terminalActor = panelChild(codeActor, 'terminal')!

// State selectors
const panelTerminalId = useSelector(codeActor, (state) => state.context.panelTerminalId)
const openFiles = useSelector(codeActor, (state) => state.context.openFiles)
const terminals = useSelector(terminalActor, (state) => state.context.terminals)
const activity = useSelector(terminalActor, (state) => state.context.activity)

const featureSettings = useSettings('code')
const storedCodeSettings = featureSettings.value
const confirmTerminalClose = computed(() => storedCodeSettings.value?.confirmTerminalClose ?? true)
const closeTerminalOnTabClose = computed(() => storedCodeSettings.value?.closeTerminalOnTabClose ?? true)
const terminalScripts = computed(() => (storedCodeSettings.value?.terminalScripts ?? []) as TerminalScript[])
const terminalTargets = computed(() => storedCodeSettings.value?.terminalTargets ?? [])

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

// Terminal rendering. **The whole of this host's reach into the terminal is its attachment**: the pool owns
// the emulator, its listeners and its size observer, so nothing here holds an emulator type.
const hasSelection = ref(false)
let attachment: TerminalAttachment | null = null

/** Set by `selectTerminal`, read by the attach it causes: whether this attach is a user's request (F15) */
let focusOnAttach = false

/** What a terminal whose shell has gone says when you hover it */
const exitedTitle = (terminal: TerminalInfo) => terminal.exited?.unreached
  ? `Not connected to ${terminal.target?.label ?? 'its target'}. Restart the terminal to connect`
  : terminal.exited?.code == null
  ? 'The shell ended without a status (a signal)'
  : `The shell ended with status ${terminal.exited.code}`

/**
 * Which attach is the current one.
 *
 * **The emulator's module is loaded on demand, so an attach can be awaiting when the next one starts** —
 * the user clicking through the terminal list faster than one opens. Each attach takes a number and drops
 * itself if another has started since, so the panel draws the terminal asked for last and not whichever
 * module load happened to finish last. A detach bumps it too, so an attach whose host has gone draws
 * nothing.
 */
let attaching = 0

const attachTerminal = (terminalId: string) => {
  const generation = ++attaching
  const info = terminals.value.find((t: TerminalInfo) => t.id === terminalId)
  if (!container.value || !info) {
    // **The request dies with the attach it was made for.** `selectTerminal` arms the flag because the
    // selection is what attaches, a tick later — and in that tick the panel can collapse, the host can be
    // replaced, or this terminal can leave the list, any of which lands here. A flag left armed is spent by
    // whatever attaches next — a re-open, a remount, a reconnect-driven list — stealing focus from whatever
    // the user is typing in, which is the defect it exists to prevent (F15).
    focusOnAttach = false
    return
  }

  // What is typed goes from the view to its session; this host never carries a key
  void Promise.resolve(terminalPool.ensure(info)).then(entry => {
    // Superseded, closed while it was opening, or the panel has gone: the request to focus dies with the
    // attach it was made for, exactly as it does for the cases above.
    if (!entry || generation !== attaching || !container.value) {
      if (generation === attaching) focusOnAttach = false
      return
    }

    attachment = terminalPool.attach(terminalId, container.value, {
      onResize: ({ cols, rows, cellWidth, cellHeight }) => {
        terminalActor?.send({ type: 'terminal.RESIZE', terminalId, cols, rows, cellWidth, cellHeight })
      },
      onSelectionChange: has => { hasSelection.value = has },
      // A path a program printed opens as the file it names, where the explorer opens every other
      onOpenPath: (path, at) => {
      panelChild(codeActor, 'explorer')?.send({ type: 'explorer.OPEN_FILE', path })
      // Shown at the line the program named, once the file is the one showing
      if (at) codeActor.send({ type: 'UPDATE_STATE', updates: { pendingRevealLine: { filePath: path, line: at.line, column: at.column } } })
    },
    })
    terminalActor.send({ type: 'terminal.SEEN', terminalId })

    // **Focused only when the user asked for this terminal** (F15). An attach happens on mount too — a
    // panel re-open, an actor replacement, a reconnect — none of which is a request, and taking focus from
    // what they were typing in is the defect. `selectTerminal` is the request, and sets the flag this
    // reads.
    if (focusOnAttach) {
      focusOnAttach = false
      attachment?.focus()
    }
  })
}

/**
 * Lets go of whatever this host is drawing.
 *
 * `handingOver` says an attach for the terminal the user asked for follows in this same turn — a switch from
 * one terminal to another — in which case the request to focus is still that attach's and must survive.
 * Clearing it unconditionally made the flag dead for the one case it exists for: every switch detaches
 * first, so clicking a terminal while another was drawn here cleared the request before the attach could
 * spend it, and the user's keystrokes went on reaching the list button they had clicked.
 */
const detachTerminal = ({ handingOver = false } = {}) => {
  // An attach still awaiting its module load is no longer current, so it will draw nothing
  attaching += 1
  // Releasing is also how a host another has taken over from detaches nothing (F1)
  const letGo = attachment?.release() ?? false
  // **The backend holds the grid to the smallest fit of the windows showing it**, so a window that has
  // stopped showing one has to say so or it goes on holding that terminal small for every other window.
  // Only when this host is what let go: during a remount the new host has already attached, and this would
  // drop the fit it just recorded.
  if (letGo && attachment) terminalActor?.send({ type: 'terminal.DETACHED', terminalId: attachment.terminalId })
  attachment = null
  hasSelection.value = false
  // Letting go ends any outstanding request to focus, for the same reason the guard above does: the attach
  // it was armed for is not going to happen, and the next one is somebody else's
  if (!handingOver) focusOnAttach = false
}

// Context menu actions
const copySelection = () => { void attachment?.copy() }

const pasteClipboard = () => {
  // **Through the emulator, not as input** (F12). This host sent the text as a keystroke, so a pasted
  // newline ran the command and no application ever saw the bracketed-paste markers it had asked for.
  void navigator.clipboard.readText().then(text => {
    if (text) attachment?.paste(text)
  }).catch(() => {})
}

const selectAll = () => attachment?.selectAll()

const clearTerminal = () => attachment?.clear()

/** The person is looking at the panel's terminal, so what was waiting for them to has been seen */
const seenPanelTerminal = () => {
  if (panelTerminalId.value) terminalActor.send({ type: 'terminal.SEEN', terminalId: panelTerminalId.value })
}

const killPanelTerminal = () => {
  if (!panelTerminalId.value) return
  terminalActor.send({ type: 'terminal.CLOSE', terminalId: panelTerminalId.value })
}

/**
 * **Restart in place — T6.** Closing and creating produced a terminal with a *different id*, so everything
 * attached to the old one went with it: its pin, its group, its position in the tab strip, and the output
 * of the shell that just failed, which is usually what the user restarted it to read. The backend keeps the
 * terminal and starts a new generation under it, so there is nothing here to carry across.
 */
const restartPanelTerminal = () => {
  if (!panelTerminalId.value) return
  terminalActor.send({ type: 'terminal.RESTART', terminalId: panelTerminalId.value })
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

/** A terminal somewhere other than this machine: on one of the targets the settings name */
const createTerminalOn = (target: string) => {
  terminalActor?.send({ type: 'terminal.CREATE', on: target })
  if (!isExpanded.value) {
    codeActor.send({ type: 'TOGGLE_PANEL_TERMINAL' })
  }
}

const runScript = (script: TerminalScript) => {
  const hasPanel = panelTerminalId.value && terminals.value.some((t: TerminalInfo) => t.id === panelTerminalId.value)
  if (hasPanel) {
    // Reuse existing panel terminal
    // Ended the way this shell ends a line (X6), which the descriptor carries because a window cannot know
    const submit = terminals.value.find((t: TerminalInfo) => t.id === panelTerminalId.value)?.submit ?? '\n'
    terminalActor?.send({ type: 'terminal.INPUT', terminalId: panelTerminalId.value!, data: script.command + submit })
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
  // **Already drawn here, so the click is answered now** rather than armed for an attach that will not
  // happen: the watch below skips `attachTerminal` when the attachment already names this terminal, so a
  // flag set here would survive the click and be spent by the next attach — a panel re-open, an actor
  // replacement, a reconnect — which is the F15 defect the flag exists to prevent. Arming it only where an
  // attach is certain is what keeps the request from outliving the turn it was made in.
  if (attachment?.terminalId === terminalId) {
    attachment.focus()
    return
  }
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
        // Driven frame by frame while the divider is dragged; the size observer would catch up a layout
        // pass behind, which is visible on a drag and nowhere else
        attachment?.refit()
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
  renameValue.value = terminal.customTitle || terminalNameFor(terminal.cwd) || terminal.title
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
  if (expanded && termId && info && !attachment) {
    attachTerminal(termId)
  }
})

// Watch expand/collapse, panelTerminalId, and activeTerminalInfo (for when terminals list arrives after expand)
watch([isExpanded, panelTerminalId, activeTerminalInfo], async ([expanded, termId, info]) => {
  if (expanded && termId && info) {
    // Detach old terminal if switching, handing the pending focus request to the attach below
    if (attachment && attachment.terminalId !== termId) {
      detachTerminal({ handingOver: true })
    }
    // Only attach if not already attached to this terminal — the attachment names the one it holds
    if (attachment?.terminalId !== termId) {
      await nextTick()
      attachTerminal(termId)
    }
  } else {
    // **Anything else means there is nothing to draw**, the panel collapsed, no terminal selected, *and* a
    // terminal that is gone from the list while still selected — which is the case this used to miss (T7):
    // `expanded` and `termId` were both truthy, so neither branch ran and this host held an attachment to a
    // session that no longer exists.
    detachTerminal()
  }
})

onBeforeUnmount(() => {
  detachTerminal()
  document.removeEventListener('mousedown', onDocumentClick, true)
})
</script>

