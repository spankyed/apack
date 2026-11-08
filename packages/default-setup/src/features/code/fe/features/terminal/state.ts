import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { sendToSystem } from '#generated/events.ts';
import { newCall, recordCall, settleCall } from '@apackdev/sdk/events';
import { terminalEventBus } from '../../utils/terminal-events.ts';
import { terminalPool } from '../../utils/terminal-pool.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { removeTabs, nextActiveFromHistory } from '../../utils/tab-management.ts';

export interface TerminalInfo {
  id: string
  title: string
  customTitle?: string
  pid: number
  shell?: string
  cwd: string
  active: boolean
  /**
   * The session's size **when this was published**, which is a starting point and not a live reading.
   *
   * **A pty has one size and it is whatever a window last fitted**, so the live value lives where the
   * session does: the service keeps it current and `restart` re-opens the shell at it. What a window holds
   * is the snapshot it was last listed or opened with, and its one consumer wants exactly that — the pool
   * builds the emulator at this size and `fitAddon.fit()` replaces it on the next frame, so it is the width
   * a replayed screen is first drawn at and nothing more.
   *
   * It is spelled out because it reads as live and is not: a drive scenario waited on it for the size a
   * window had just fitted and timed out at the creation size, with every resize having landed correctly
   * (F18). Nothing is missing — a window that wants the size it fitted computed it, and the pty's own is
   * the broker's to answer.
   */
  cols: number
  /** The session's rows when this was published; see `cols` */
  rows: number
  /**
   * How far back this session can be scrolled, which is the host's number and not this window's.
   *
   * Unlike `cols` this is not a starting point: it is the bound the pool builds the emulator with, and
   * exceeding it would draw lines that cannot survive a reattach — the host is what answers a screen read
   * when no window holds the bytes. It was pinned here as 10,000 against the broker's 1,000, so closing and
   * reopening a window silently lost nine tenths of the scrollback.
   */
  scrollback: number
  /**
   * What ends a typed line for this session's shell — X6.
   *
   * A window cannot know which shell is on the other end, and it matters: typed into a Windows console,
   * `\n` is echoed and never runs, so a command sits on screen looking typed while nothing happens. The
   * backend computes it where the shell is chosen.
   */
  submit: string
}

const createTerminalTab = (info: TerminalInfo) => ({
  path: `terminal:${info.id}`,
  content: '',
  modified: false,
  isTerminal: true,
  terminalInfo: info
})

/** What this window meant by one `terminal.CREATE`, held until that ask is answered */
interface PendingOpen {
  /** `'tab'` routes the created terminal to a canvas tab; otherwise it goes to the panel */
  target: 'tab' | null
  /** A command to run in it once it exists */
  command: string | null
}

export interface CodeTerminalContext {
  terminals: TerminalInfo[]
  /**
   * What each outstanding `terminal.CREATE_TERMINAL` meant, by the call it was asked under.
   *
   * **Keyed by the call, because nothing about the terminal identifies the ask.** A fetch keys its answers
   * by what it asked for; a terminal ask carries nothing that does, since the backend mints the id. The call
   * is what the asker has and the answer echoes, so it is the only key available.
   *
   * **One slot for all of them is the trap**, and it is invisible when it fires: two creates in flight share
   * it, so the second's intent is what the first answer reads and the second answer finds nothing. Run
   * "build" then "test" before the first answer and `test` runs in the build terminal
   * (`docs/issues/ISSUE-terminal-integration-review.md`, T4).
   *
   * An entry is removed by whichever answer settles the ask (`terminal.OPENED` or `terminal.ERROR`, both
   * replied), so the map holds only what is genuinely in flight.
   */
  pendingOpens: Record<string, PendingOpen>
}

export type Event =
  | { type: 'terminal.CREATE'; title?: string; cwd?: string; target?: 'tab'; command?: string }
  | { type: 'terminal.CLOSE'; terminalId: string }
  | { type: 'terminal.RESTART'; terminalId: string }
  | { type: 'terminal.INPUT'; terminalId: string; data: string }
  | { type: 'terminal.RESIZE'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.RENAME'; terminalId: string; customTitle: string }
  | { type: 'terminal.REFRESH_LIST' }
  | { type: 'terminal.OPEN_TAB'; terminalInfo: TerminalInfo }
  | { type: 'terminal.OPEN_TABS'; terminalIds: string[] }
  | { type: 'terminal.TERMINALS_LISTED'; data: TerminalInfo[] }
  | { type: 'terminal.CREATED'; data: { terminalId: string } }
  | { type: 'terminal.OPENED'; data: TerminalInfo }
  | { type: 'terminal.CLOSED'; data: { terminalId: string } }
  | { type: 'terminal.CRASHED'; data: { terminalId: string; code: number | null } }
  | { type: 'terminal.RESTARTED'; data: TerminalInfo }
  | { type: 'terminal.RENAMED'; data: { terminalId: string; customTitle: string } }
  | { type: 'terminal.CWD_CHANGED'; data: { terminalId: string; cwd: string; title?: string } }
  | { type: 'terminal.OUTPUT'; data: { terminalId: string; data: string } }
  | { type: 'terminal.ERROR'; data: { message: string; terminalId?: string } }
  | { type: 'terminal.TERMINAL_TAB_OPENED'; data: TerminalInfo }
  | { type: 'CODE_STARTUP'; data: { terminals?: TerminalInfo[] } };  // Broadcasted event

export const terminalState = setup({
  types: {
    context: {} as CodeTerminalContext,
    events: {} as Event
  },
  actions: {
    /**
     * **`enqueueActions`, so the intent is recorded under its call before the ask is sent.** A send made
     * from inside an `assign` producer runs before the assign is applied, so an answer arriving in the same
     * turn is matched against a record the ask has not written yet.
     */
    createTerminal: enqueueActions(({ event, self, enqueue }) => {
      const ev = event as { type: 'terminal.CREATE'; title?: string; cwd?: string; target?: 'tab'; command?: string }
      const parentContext = getParentContext(self)
      const baseDir = parentContext?.baseDirectory
      const call = newCall()

      enqueue.assign(({ context }) => ({
        pendingOpens: recordCall(context.pendingOpens, call, { target: ev.target ?? null, command: ev.command ?? null }),
      }))
      enqueue(() => {
        sendToSystem('code', {
          type: 'terminal.CREATE_TERMINAL',
          title: ev.title,
          cwd: ev.cwd || (baseDir && baseDir.trim() ? baseDir : undefined),
        }, { call })
      })
    }),

    closeTerminal: ({ event }) => {
      const ev = event as { type: 'terminal.CLOSE'; terminalId: string }
      sendToSystem('code', { type: 'terminal.CLOSE_TERMINAL', terminalId: ev.terminalId })
    },

    restartTerminal: ({ event }) => {
      const ev = event as { type: 'terminal.RESTART'; terminalId: string }
      sendToSystem('code', { type: 'terminal.RESTART_TERMINAL', terminalId: ev.terminalId })
    },

    sendTerminalInput: ({ event }) => {
      const ev = event as { type: 'terminal.INPUT'; terminalId: string; data: string }
      sendToSystem('code', { type: 'terminal.TERMINAL_INPUT', terminalId: ev.terminalId, data: ev.data })
    },

    resizeTerminal: ({ event }) => {
      const ev = event as { type: 'terminal.RESIZE'; terminalId: string; cols: number; rows: number }
      sendToSystem('code', {
        type: 'terminal.RESIZE_TERMINAL',
        terminalId: ev.terminalId,
        cols: ev.cols,
        rows: ev.rows,
      })
    },

    renameTerminal: ({ event }) => {
      const ev = event as { type: 'terminal.RENAME'; terminalId: string; customTitle: string }
      sendToSystem('code', {
        type: 'terminal.RENAME_TERMINAL',
        terminalId: ev.terminalId,
        customTitle: ev.customTitle,
      })
    },

    listTerminals: () => {
      sendToSystem('code', { type: 'terminal.REFRESH_LIST' })
    },

    assignTerminals: enqueueActions(({ enqueue, self, event }) => {
      const ev = event as { type: 'terminal.TERMINALS_LISTED'; data: TerminalInfo[] }
      const terminals = ev.data || []
      enqueue(assign({ terminals }))

      enqueue(() => {
        // A terminal keeps its id across a backend restart but not its process, so this is where a pool
        // entry learns the shell under it was replaced
        terminalPool.syncProcesses(terminals)

        const parentContext = getParentContext(self)
        const pendingTabIds: string[] | undefined = parentContext?.pendingTerminalTabIds

        const updates: Partial<{ panelTerminalId: string | null; pendingTerminalTabIds: undefined; pendingTabOrder: Array<{ path: string; order: number }> | undefined }> = {}

        // Restore deferred terminal tabs
        if (pendingTabIds && pendingTabIds.length > 0 && terminals.length > 0) {
          const restoredIds: string[] = []
          const staleTabPaths: string[] = []

          for (const terminalId of pendingTabIds) {
            const info = terminals.find(t => t.id === terminalId)
            if (info) {
              addTabToParent(self, createTerminalTab(info), false, {
                activeFilePath: parentContext?.activeFilePath
              })
              restoredIds.push(terminalId)
            } else {
              // Terminal no longer exists on backend — mark for cleanup
              staleTabPaths.push(`terminal:${terminalId}`)
            }
          }

          // Clean stale terminal paths from pendingTabOrder so restoration can complete
          if (staleTabPaths.length > 0 && parentContext?.pendingTabOrder) {
            const filtered = parentContext.pendingTabOrder.filter(
              (t: any) => !staleTabPaths.includes(t.path)
            )
            updates.pendingTabOrder = filtered.length > 0 ? filtered : undefined
          }

          updates.pendingTerminalTabIds = undefined
        }

        const tabbedIds = new Set(
          (parentContext?.openFiles || []).filter((f: any) => f.isTerminal).map((f: any) => f.terminalInfo.id)
        )
        if (pendingTabIds) {
          for (const id of pendingTabIds) tabbedIds.add(id)
        }

        // Auto-select panel terminal if none selected, persisted ID is stale,
        // or persisted panel placement conflicts with a terminal editor tab.
        const currentPanelId = parentContext?.panelTerminalId
        const panelTerminalExists = currentPanelId && terminals.some(t => t.id === currentPanelId)
        const panelTerminalIsTabbed = currentPanelId ? tabbedIds.has(currentPanelId) : false

        if ((!currentPanelId || !panelTerminalExists || panelTerminalIsTabbed) && terminals.length > 0) {
          const available = terminals.find(t => !tabbedIds.has(t.id))
          if (available) {
            updates.panelTerminalId = available.id
          } else if (!panelTerminalExists || panelTerminalIsTabbed) {
            updates.panelTerminalId = null
          }
        }

        if (Object.keys(updates).length > 0) {
          updateParentState(self, updates)
        }
      })
    }),


    removeTerminal: assign({
      terminals: ({ context, event }) => {
        const ev = event as { type: 'terminal.CLOSED'; data: { terminalId: string } }
        return context.terminals.filter(t => t.id !== ev.data.terminalId)
      }
    }),

    /**
     * A shell died badly and its terminal stays.
     *
     * **Removing it is what used to happen and is what loses the error.** A shell that exits 0 still sends
     * `terminal.CLOSED` and the terminal still goes; this is the other case, where the screen holds the
     * reason the user now wants to read.
     */
    markTerminalCrashed: assign({
      terminals: ({ context, event }) => {
        const ev = event as { type: 'terminal.CRASHED'; data: { terminalId: string; code: number | null } }
        return context.terminals.map(one =>
          one.id === ev.data.terminalId ? { ...one, active: false, exited: { code: ev.data.code } } : one)
      }
    }),

    /** Says on the screen that the shell has gone, where the user is already looking */
    noteCrashOnScreen: ({ event }) => {
      const ev = event as { type: 'terminal.CRASHED'; data: { terminalId: string; code: number | null } }
      terminalPool.noteExit(ev.data.terminalId, ev.data.code)
    },

    /** Tells the window's emulator which process is answering now, so one boundary draws one seam */
    noteRestartOnScreen: ({ event }) => {
      const ev = event as { type: 'terminal.RESTARTED'; data: TerminalInfo }
      terminalPool.noteRestart(ev.data.id, ev.data.pid)
    },

    /** A new shell under a terminal that was already there: its descriptor is replaced, its place is not */
    takeRestartedTerminal: assign({
      terminals: ({ context, event }) => {
        const ev = event as { type: 'terminal.RESTARTED'; data: TerminalInfo }
        return context.terminals.map(one => one.id === ev.data.id ? ev.data : one)
      }
    }),

    updateTerminalTitle: enqueueActions(({ enqueue, context, event, self }) => {
      const ev = event as { type: 'terminal.RENAMED'; data: { terminalId: string; customTitle: string } }

      // Update local terminals list
      enqueue.assign({
        terminals: context.terminals.map(t =>
          t.id === ev.data.terminalId
            ? { ...t, customTitle: ev.data.customTitle }
            : t
        )
      })

      // Tell parent to surgically update the matching terminal tab.
      // Avoids sending a full openFiles snapshot which can race with pending ADD_TAB events.
      enqueue(() => {
        sendEventToParent(self, {
          type: 'TERMINAL_TAB_INFO_CHANGED',
          terminalId: ev.data.terminalId,
          changes: { customTitle: ev.data.customTitle }
        })
      })
    }),

    updateTerminalCwd: enqueueActions(({ enqueue, context, event, self }) => {
      const ev = event as { type: 'terminal.CWD_CHANGED'; data: { terminalId: string; cwd: string; title?: string } }

      // Update terminal info in context
      enqueue(assign({
        terminals: context.terminals.map(t => {
          if (t.id === ev.data.terminalId) {
            const updated = { ...t, cwd: ev.data.cwd }
            // Update title if provided (when no customTitle is set)
            if (ev.data.title) {
              updated.title = ev.data.title
            }
            return updated
          }
          return t
        })
      }))

      // Tell parent to surgically update the matching terminal tab.
      // Avoids sending a full openFiles snapshot which can race with pending ADD_TAB events.
      enqueue(() => {
        sendEventToParent(self, {
          type: 'TERMINAL_TAB_INFO_CHANGED',
          terminalId: ev.data.terminalId,
          changes: { cwd: ev.data.cwd, title: ev.data.title }
        })
      })
    }),

    /**
     * A failed ask stops being outstanding. What the user is told is the backend's job, through `reportError`
     * — the app raises the toast. This surface held the message in a context field instead, which nothing
     * rendered, and that is what made every terminal failure silent.
     *
     * A replied error settles the ask it answers, so its intent goes with it: a create that failed would
     * otherwise leave its target and command in the map for the life of the surface. Only `pending` is
     * wanted here — there is nothing to do with what the failed ask meant.
     */
    settleFailedAsk: assign(({ event, context }) => ({
      pendingOpens: settleCall(context.pendingOpens, event).pending
    })),

    cleanupTerminalOutput: ({ event }) => {
      const ev = event as { type: 'terminal.CLOSED'; data: { terminalId: string } }
      terminalEventBus.clearOutput(ev.data.terminalId)
      terminalPool.dispose(ev.data.terminalId)
    },

    handleTerminalOutput: ({ event }) => {
      const ev = event as { type: 'terminal.OUTPUT'; data: { terminalId: string; data: string } }
      terminalEventBus.emit(ev.data.terminalId, ev.data.data)
    },

    /**
     * Opens the terminal *this* window asked for, the way *that* ask asked for it.
     *
     * **Two correlations, answering different questions.** Addressing says *which window*: only the asker is
     * sent `terminal.OPENED`, so hang this off the broadcast `terminal.CREATED` instead and every open
     * window routes a terminal it never asked for into its own panel and runs a command nobody typed there.
     * The call says *which of that window's asks*, which addressing cannot — see `pendingOpens`.
     *
     * An answer whose call names no outstanding ask opens with the defaults, the panel and no command, which
     * is what a terminal this window did not ask for should do.
     */
    handleTerminalOpened: enqueueActions(({ enqueue, context, self, event }) => {
      const { recorded, pending } = settleCall(context.pendingOpens, event)
      const { target, command } = recorded ?? { target: null, command: null }
      enqueue.assign({ pendingOpens: pending })
      enqueue(() => {
        const ev = event as { type: 'terminal.OPENED'; data: TerminalInfo }
        const terminalInfo = ev.data

        if (target === 'tab') {
          // Explicit tab target — create canvas tab
          addTabToParent(self, createTerminalTab(terminalInfo))
        } else {
          // Default — route to panel, and show it. A terminal spawned into a collapsed panel is one the
          // user asked for and cannot see; "Open Terminal Here" was the way to meet it
          updateParentState(self, { panelTerminalId: terminalInfo.id, panelTerminalExpanded: true })
        }

        // Run pending command if set. **Ended the way this shell ends a line** (X6): a window cannot know
        // which shell is on the other end, so the descriptor carries it
        if (command) {
          sendToSystem('code', {
            type: 'terminal.TERMINAL_INPUT',
            terminalId: terminalInfo.id,
            // A descriptor from before this field existed, or from a backend mid-reload, must not put the
            // word `undefined` on the end of the user's command
            data: command + (terminalInfo.submit ?? '\n'),
          })
        }
      })
    }),

    handleTerminalClosed: enqueueActions(({ enqueue, context, self, event }) => {
      enqueue('removeTerminal')
      enqueue('cleanupTerminalOutput')
      enqueue(() => {
        const ev = event as { type: 'terminal.CLOSED'; data: { terminalId: string } }
        const terminalId = ev.data.terminalId
        const parentContext = getParentContext(self)
        const terminalPath = `terminal:${terminalId}`

        // Remove canvas tab if present
        const result = removeTabs(
          parentContext?.openFiles || [],
          terminalPath,
          parentContext?.activeFilePath
        )
        if (parentContext?.activeFilePath === terminalPath && result.openFiles.length > 0) {
          result.activeFilePath = nextActiveFromHistory(parentContext?.tabViewHistory || [], result.openFiles)
        }

        // If this was the panel terminal, auto-select next available
        let panelUpdate: { panelTerminalId: string | null } | undefined
        if (parentContext?.panelTerminalId === terminalId) {
          const tabbedIds = new Set(
            (result.openFiles || []).filter((f: any) => f.isTerminal).map((f: any) => f.terminalInfo.id)
          )
          // `context` is the snapshot this body was entered with, so the closed terminal is still in it:
          // `removeTerminal` is queued above and assigns after the body returns. Excluding it by id rather
          // than relying on that order, since the order is what made the panel show a dead terminal
          const next = context.terminals.find(t => t.id !== terminalId && !tabbedIds.has(t.id))
          panelUpdate = { panelTerminalId: next?.id ?? null }
        }

        updateParentState(self, { ...result, ...panelUpdate })
      })
    }),

    handleCodeStartup: ({ event, self }) => {
      const ev = event as { type: 'CODE_STARTUP'; data: { terminals?: TerminalInfo[] } }
      // If startup includes terminals, handle them like TERMINALS_LISTED
      if (ev.data?.terminals) {
        self.send({
          type: 'terminal.TERMINALS_LISTED',
          data: ev.data.terminals
        })
      }
    },

    openTerminalTab: ({ event, self }) => {
      const ev = event as { type: 'terminal.OPEN_TAB'; terminalInfo: TerminalInfo }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []
      const terminalPath = `terminal:${ev.terminalInfo.id}`

      // Check if terminal tab already exists
      const existingTab = openFiles.find((f: any) => f.path === terminalPath)

      if (existingTab) {
        // Tab already exists, just activate it
        updateParentState(self, {
          activeFilePath: terminalPath
        })
      } else {
        addTabToParent(self, createTerminalTab(ev.terminalInfo))
      }
    },

    openTerminalTabs: ({ event }) => {
      const ev = event as { type: 'terminal.OPEN_TABS'; terminalIds: string[] }
      // Send individual requests to backend for each terminal
      ev.terminalIds.forEach(terminalId => {
        sendToSystem('code', { type: 'terminal.OPEN_TERMINAL_TAB', terminalId })
      })
    },

    handleTerminalTabOpened: ({ event, self }) => {
      const ev = event as { type: 'terminal.TERMINAL_TAB_OPENED'; data: TerminalInfo }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []
      const terminalPath = `terminal:${ev.data.id}`

      // Check if terminal tab already exists
      const existingTab = openFiles.find((f: any) => f.path === terminalPath)

      if (existingTab) {
        // Tab already exists, don't create duplicate
        // For restored tabs, we might not want to change active tab
        return
      }

      // Create terminal tab but keep current active tab
      addTabToParent(self, createTerminalTab(ev.data), false, {
        activeFilePath: parentContext?.activeFilePath
      })
    }
  }
}).createMachine({
  id: 'terminal',
  initial: 'idle',
  context: {
    terminals: [],
    pendingOpens: {}
  },
  on: {
    'terminal.CREATE': {
      actions: 'createTerminal'
    },
    'terminal.CLOSE': {
      actions: 'closeTerminal'
    },
    'terminal.RESTART': {
      actions: 'restartTerminal'
    },
    'terminal.INPUT': {
      actions: 'sendTerminalInput'
    },
    'terminal.RESIZE': {
      actions: 'resizeTerminal'
    },
    'terminal.RENAME': {
      actions: 'renameTerminal'
    },
    'terminal.REFRESH_LIST': {
      actions: 'listTerminals'
    },
    'terminal.OPEN_TAB': {
      actions: 'openTerminalTab'
    },
    'terminal.OPEN_TABS': {
      actions: 'openTerminalTabs'
    },
    'terminal.TERMINALS_LISTED': {
      actions: 'assignTerminals'
    },
    // The news, which every window takes: the list grows and nothing else happens
    // A terminal exists, in some window: ask for the list again, which the system answers this window alone
    'terminal.CREATED': {
      actions: 'listTerminals'
    },
    // The answer, which only the window that asked is sent
    'terminal.OPENED': {
      actions: ['handleTerminalOpened']
    },
    'terminal.CLOSED': {
      actions: 'handleTerminalClosed'
    },
    'terminal.CRASHED': {
      actions: ['markTerminalCrashed', 'noteCrashOnScreen']
    },
    'terminal.RESTARTED': {
      actions: ['takeRestartedTerminal', 'noteRestartOnScreen']
    },
    'terminal.RENAMED': {
      actions: 'updateTerminalTitle'
    },
    'terminal.CWD_CHANGED': {
      actions: 'updateTerminalCwd'
    },
    'terminal.OUTPUT': {
      actions: 'handleTerminalOutput'
    },
    'terminal.ERROR': {
      actions: 'settleFailedAsk'
    },
    'terminal.TERMINAL_TAB_OPENED': {
      actions: 'handleTerminalTabOpened'
    },
    'CODE_STARTUP': {
      actions: 'handleCodeStartup'
    }
  },
  states: {
    idle: {
    }
  }
});

/** The terminal child's actor, as the code surface's components reach it with `codeChild()` */
export type TerminalActor = ActorRefFrom<typeof terminalState>;
