<template>
  <TrackedContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div class="relative h-full w-full" @pointerdown.capture="seen">
        <!-- The bell's flash: the terminal's state says when a bell is flashing (it owns the timing), and this only paints it -->
        <div
          ref="container"
          :class="['h-full w-full p-2', bellFlashing ? 'bg-neutral-600' : 'bg-[#1e1e1e]']"
          @dragover="onDragOver"
          @drop="onDrop"
          :data-bell-flash="bellFlashing ? 'true' : undefined"
        ></div>
        <ScrollToBottomFob :visible="showScrollFob" @click="scrollToBottom()" />
        <!-- The commands the shell marked, newest first: each one's status, its output, and running it again -->
        <div v-if="commands.length" class="absolute top-2 right-2 z-10 flex flex-col items-end">
          <button
            type="button"
            data-testid="command-blocks-toggle"
            class="rounded bg-neutral-800/90 border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700"
            @click="showCommands = !showCommands"
          >
            Commands ({{ commands.length }})
          </button>
          <ul
            v-if="showCommands"
            data-testid="command-blocks"
            class="mt-1 max-h-72 w-[28rem] overflow-y-auto rounded border border-neutral-700 bg-neutral-900/95 text-xs"
          >
            <li
              v-for="command in newestFirst"
              :key="command.id"
              data-testid="command-block"
              :data-failed="failed(command) ? 'true' : undefined"
              :class="failed(command) ? 'bg-red-950/60' : ''"
              class="flex items-center gap-2 border-b border-neutral-800 px-2 py-1 last:border-b-0"
            >
              <span class="flex-1 truncate font-mono text-neutral-100" :title="command.command ?? ''">
                {{ command.command ?? 'unknown command' }}
              </span>
              <span class="shrink-0 text-neutral-400">{{ statusOf(command) }}</span>
              <button
                type="button"
                class="shrink-0 text-neutral-300 hover:text-white disabled:text-neutral-600"
                :disabled="command.output === null"
                @click="copyOutput(command)"
              >
                Copy output
              </button>
              <button
                type="button"
                class="shrink-0 text-neutral-300 hover:text-white disabled:text-neutral-600"
                :disabled="command.command === null"
                @click="rerun(command)"
              >
                Re-run
              </button>
              <button
                type="button"
                data-testid="command-fold"
                class="shrink-0 text-neutral-300 hover:text-white disabled:text-neutral-600"
                :disabled="command.output === null || command.end === null"
                @click="toggleFold(command)"
              >
                {{ isFolded(command) ? 'Unfold' : 'Fold' }}
              </button>
            </li>
          </ul>
        </div>
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
import { useSelector } from '@xstate/vue'

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
import { terminalPool, type TerminalAttachment, type Command } from '#features/code/fe/utils/terminal-pool.ts'
import TerminalMenuExtras from '#features/code/fe/features/terminal/TerminalMenuExtras.vue'
import TerminalRewind from '#features/code/fe/features/terminal/TerminalRewind.vue'
import { panelChild } from '../features/children.ts';
import { dropShellOf, dropText } from '../utils/drop-text.ts';

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
const terminalActor = panelChild(codeActor, 'terminal')!
// Whether this terminal's bell is flashing now, which the state starts and ends
const bellFlashing = useSelector(terminalActor, (state) => state.context.bells[props.terminalInfo.id] === 'flashing')

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
// The commands the shell has marked, as the pool last heard them, and whether their list is open
const commands = ref<readonly Command[]>([])
const showCommands = ref(false)
const newestFirst = computed(() => [...commands.value].reverse())
/** A command that ended with a non-zero status, which is what its row is highlighted for */
const failed = (command: Command) => (command.outcome.kind === 'exited' || command.outcome.kind === 'claimed')
  && command.outcome.code !== null && command.outcome.code !== 0
const statusOf = (command: Command): string => {
  const outcome = command.outcome
  if (outcome.kind === 'running') return 'running'
  if (outcome.kind === 'exited') return `exit ${outcome.code}`
  if (outcome.kind === 'claimed') return outcome.code === null ? 'finished' : `exit ${outcome.code} (claimed)`
  return 'status unknown'
}

/* --------------------------------------------------------------------------
 * Command blocks ----------------------------------------------------------- */
const copyOutput = (command: Command) => { void attachment?.copyCommand(command) }
/** Runs the command again, in the terminal it was run in: the shell decides what that means */
const rerun = (command: Command) => { if (command.command !== null) attachment?.rerun(command.command) }
/** Which commands' output is folded: the pool keeps it, and this mirrors it for the rows to show */
const folded = ref<ReadonlySet<number>>(new Set())
const isFolded = (command: Command) => folded.value.has(command.id)
const toggleFold = (command: Command) => {
  attachment?.setFolded(command, !isFolded(command))
  folded.value = new Set([...folded.value].filter((id) => id !== command.id).concat(isFolded(command) ? [] : [command.id]))
}

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

/* --------------------------------------------------------------------------
 * Drops ---------------------------------------------------------------------
 * Files dropped on the terminal insert their paths as a paste, quoted for the shell it runs (D9). Only a
 * drag that carries files is taken: text dragged in is left to the browser, and nothing here takes focus. */
const carriesFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files')

const onDragOver = (event: DragEvent) => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const onDrop = (event: DragEvent) => {
  if (!carriesFiles(event)) return
  // Taken even when nothing is inserted: a file dropped on the page would otherwise open in the window
  event.preventDefault()
  const shell = dropShellOf(props.terminalInfo.shell)
  const getPath = window.electronAPI?.fileUtils?.getPathForFile
  if (shell === undefined || !getPath || !attachment) return
  const paths: string[] = []
  for (const file of Array.from(event.dataTransfer?.files ?? [])) {
    const path: string = getPath(file)
    if (path) paths.push(path)
  }
  const text = dropText(paths, shell)
  if (text) attachment.paste(text)
}

const clearTerminal = () => attachment?.clear()

/** The person is looking at this terminal, so what was waiting for them to has been seen */
const seen = () => terminalActor.send({ type: 'terminal.SEEN', terminalId: props.terminalInfo.id })

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
      terminalActor.send({ type: 'terminal.RESIZE', terminalId: props.terminalInfo.id, cols, rows, cellWidth, cellHeight })
    },
    onSelectionChange: has => { hasSelection.value = has },
    onFollowingChange: following => { isFollowingOutput.value = following },
    onCommands: list => { commands.value = list },
    // A path a program printed opens as the file it names, where the explorer opens every other
    onOpenPath: (path, at) => {
      panelChild(codeActor, 'explorer')?.send({ type: 'explorer.OPEN_FILE', path })
      // Shown at the line the program named, once the file is the one showing
      if (at) codeActor.send({ type: 'UPDATE_STATE', updates: { pendingRevealLine: { filePath: path, line: at.line, column: at.column } } })
    },
  })
  // The pool's view outlives this component, so what it already knows is shown now rather than at the next command
  if (attachment) {
    const held = attachment
    commands.value = [...held.commands()]
    folded.value = new Set(held.commands().filter(command => held.isFolded(command)).map(command => command.id))
  }
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
  if (letGo && attachment) terminalActor.send({ type: 'terminal.DETACHED', terminalId: attachment.terminalId })
  attachment = null
})

/* --------------------------------------------------------------------------
 * Public API (exposed to parent via refs) ---------------------------------- */
function focus() {
  attachment?.focus()
}

defineExpose({ focus })
</script>

