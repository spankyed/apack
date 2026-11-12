import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { sendToSystem } from '#generated/events.ts';
import { newCall, recordCall, settleCall } from '@apackdev/sdk/events';
import { terminalPool } from '../../utils/terminal-pool.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { removeTabs, nextActiveFromHistory } from '../../utils/tab-management.ts';
import type { TerminalInfo } from '../../../be/types.ts'

/**
 * **The type the system publishes, not a window's copy of it**, which is why it is imported and re-exported
 * rather than declared here.
 *
 * A copy drifts silently in both directions. One missing a field still compiles where a handler writes it —
 * `markTerminalCrashed` writes `exited`, and `.map`'s result is no fresh object literal, so excess-property
 * checking never runs — and a field the backend publishes that the copy omits is dropped on the way in with
 * nothing to say so. The window's half of `terminal.*` is this shape or it is wrong.
 */
export type { TerminalInfo }

/** The name a recording's view is pooled under, which is not a terminal's and cannot be taken for one */
export const rewindViewId = (session: string) => `rewind:${session}`

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

/**
 * What a terminal's program has said that is not on its screen, as its tab shows it.
 *
 * **A program's claims, drawn and never acted on**: a bell and a notification mark the tab until the
 * person looks at the terminal, progress is what the program last said of how far along it is, and
 * `title` is what it last named its terminal.
 */
export interface TerminalActivity {
  bell?: boolean
  notification?: { title: string; body: string }
  progress?: { state: 'running' | 'error' | 'indeterminate' | 'paused'; percent: number | null }
  title?: string
}

/** A recording this window has open to look back through */
export interface TerminalRewindView {
  terminalId: string
  /** What its view is drawn from */
  session: string
  /** The moments it runs between, and the one it shows, in milliseconds since the Unix epoch */
  first: number
  last: number
  at: number
}

export interface CodeTerminalContext {
  terminals: TerminalInfo[]
  /** By terminal, for the ones whose program has said something */
  activity: Record<string, TerminalActivity>
  /** The recording this window is looking back through, when it is */
  rewind: TerminalRewindView | null
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
  | { type: 'terminal.CREATE'; title?: string; cwd?: string; target?: 'tab'; command?: string; on?: string }
  | { type: 'terminal.CLOSE'; terminalId: string }
  | { type: 'terminal.RESTART'; terminalId: string }
  | { type: 'terminal.INPUT'; terminalId: string; data: string }
  | { type: 'terminal.RESIZE'; terminalId: string; cols: number; rows: number; cellWidth?: number; cellHeight?: number }
  /** This window has stopped drawing that terminal, so its fit should stop holding the grid down */
  | { type: 'terminal.DETACHED'; terminalId: string }
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
  | { type: 'terminal.CLIPBOARD'; data: { terminalId: string; text: string } }
  | { type: 'terminal.BELL'; data: { terminalId: string } }
  | { type: 'terminal.NOTIFIED'; data: { terminalId: string; title: string; body: string } }
  | { type: 'terminal.PROGRESS'; data: { terminalId: string; state: 'none' | 'running' | 'error' | 'indeterminate' | 'paused'; percent: number | null } }
  | { type: 'terminal.TITLED'; data: { terminalId: string; title: string } }
  /** The person is looking at that terminal: what was waiting for them to is no longer */
  | { type: 'terminal.SEEN'; terminalId: string }
  | { type: 'terminal.KEEP'; terminalId: string; kept: boolean }
  | { type: 'terminal.KEPT'; data: { terminalId: string; kept: boolean } }
  | { type: 'terminal.REWIND'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.REWOUND'; data: { terminalId: string; session: string; first: number; last: number } }
  | { type: 'terminal.REWIND_SEEK'; at: number }
  | { type: 'terminal.REWIND_SOUGHT'; data: { session: string; at: number } }
  | { type: 'terminal.REWIND_CLOSE' }
  | { type: 'terminal.REWIND_RESIZE'; cols: number; rows: number }
  | { type: 'terminal.ERROR'; data: { message: string; terminalId?: string } }
  | { type: 'terminal.RESIZED'; data: { terminalId: string; cols: number; rows: number } }
  | { type: 'terminal.TERMINAL_TAB_OPENED'; data: TerminalInfo }

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
      const ev = event as { type: 'terminal.CREATE'; title?: string; cwd?: string; target?: 'tab'; command?: string; on?: string }
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
          // `on` is one of the settings' targets: somewhere else, where this machine's directory names nothing
          ...(ev.on === undefined
            ? { cwd: ev.cwd || (baseDir && baseDir.trim() ? baseDir : undefined) }
            : { target: ev.on }),
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

    releaseTerminalFit: ({ event }) => {
      const ev = event as { type: 'terminal.DETACHED'; terminalId: string }
      sendToSystem('code', { type: 'terminal.STOPPED_FITTING', terminalId: ev.terminalId })
    },

    resizeTerminal: ({ event }) => {
      const ev = event as {
        type: 'terminal.RESIZE'; terminalId: string; cols: number; rows: number
        cellWidth?: number; cellHeight?: number
      }
      sendToSystem('code', {
        type: 'terminal.RESIZE_TERMINAL',
        terminalId: ev.terminalId,
        cols: ev.cols,
        rows: ev.rows,
        cellWidth: ev.cellWidth,
        cellHeight: ev.cellHeight,
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

    /** Draws the terminal from the session answering now, and says on it that the shell is a new one */
    /**
     * Tells the pool what the list now says of the terminal this event was about. Every event that changes
     * one runs this after its own change, so what draws a terminal never holds an older word on it than
     * the list does.
     */
    describeTerminal: ({ context, event }) => {
      const data = (event as { data?: { terminalId?: string; id?: string } }).data
      const id = data?.terminalId ?? data?.id
      const info = context.terminals.find(terminal => terminal.id === id)
      if (info) terminalPool.describe(info)
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

    /**
     * The grid the pty is running at, which is not always the one this window asked for.
     *
     * **What a window holds has to be the accepted grid, not its own fit.** A pty has one `(cols, rows)` and
     * the window that opened it owns them, so a second window's fit is refused. What is drawn follows the
     * session's own frames, which carry the grid in force; this is the same fact for whatever lists it.
     */
    updateTerminalGrid: assign(({ context, event }) => {
      const ev = event as { type: 'terminal.RESIZED'; data: { terminalId: string; cols: number; rows: number } }
      // It arrives two ways and both end here: broadcast when the size moved, and replied to this window
      // alone when its own fit was refused.
      return {
        terminals: context.terminals.map(terminal => terminal.id === ev.data.terminalId
          ? { ...terminal, cols: ev.data.cols, rows: ev.data.rows }
          : terminal),
      }
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
      terminalPool.dispose(ev.data.terminalId)
    },

    /** What a closed terminal's program had said goes with it */
    forgetActivity: assign(({ context, event }) => {
      const ev = event as { type: 'terminal.CLOSED'; data: { terminalId: string } }
      const { [ev.data.terminalId]: _gone, ...activity } = context.activity
      return { activity }
    }),

    /**
     * Raises a notification with the system where this window is not the one being looked at: the program
     * asked for the person to be told, and a mark on a tab they cannot see tells them nothing.
     *
     * **One notification for one thing a program said, however many windows heard it.** Every window
     * showing the code surface is told, and each one that is not in front raises it under the same tag,
     * which the system shows once.
     */
    notifySystem: ({ event }) => {
      const ev = event as Extract<Event, { type: 'terminal.NOTIFIED' }>
      if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      new Notification(ev.data.title || 'Terminal', { body: ev.data.body, tag: `terminal:${ev.data.terminalId}` })
    },

    /** What a terminal's program said that is not on its screen, kept for its tab to show */
    noteActivity: assign(({ context, event }) => {
      const ev = event as Extract<Event, { type: 'terminal.BELL' | 'terminal.NOTIFIED' | 'terminal.PROGRESS' | 'terminal.TITLED' }>
      const id = ev.data.terminalId
      const before = context.activity[id] ?? {}
      let after: TerminalActivity
      switch (ev.type) {
        case 'terminal.BELL': after = { ...before, bell: true }; break
        case 'terminal.NOTIFIED': after = { ...before, notification: { title: ev.data.title, body: ev.data.body } }; break
        case 'terminal.PROGRESS': {
          const { progress: _was, ...rest } = before
          after = ev.data.state === 'none' ? rest : { ...rest, progress: { state: ev.data.state, percent: ev.data.percent } }
          break
        }
        case 'terminal.TITLED': {
          const { title: _was, ...rest } = before
          after = ev.data.title === '' ? rest : { ...rest, title: ev.data.title }
          break
        }
      }
      return { activity: { ...context.activity, [id]: after } }
    }),

    /** The person looked: the bell and the notification were for them, and have been seen */
    markSeen: assign(({ context, event }) => {
      const ev = event as { type: 'terminal.SEEN'; terminalId: string }
      const before = context.activity[ev.terminalId]
      if (!before?.bell && !before?.notification) return {}
      const { bell: _bell, notification: _notification, ...rest } = before
      return { activity: { ...context.activity, [ev.terminalId]: rest } }
    }),

    keepTerminal: ({ event }) => {
      const ev = event as { type: 'terminal.KEEP'; terminalId: string; kept: boolean }
      sendToSystem('code', { type: 'terminal.KEEP_TERMINAL', terminalId: ev.terminalId, kept: ev.kept })
    },

    markKept: assign(({ context, event }) => {
      const ev = event as { type: 'terminal.KEPT'; data: { terminalId: string; kept: boolean } }
      return {
        terminals: context.terminals.map(terminal => terminal.id === ev.data.terminalId
          ? { ...terminal, kept: ev.data.kept }
          : terminal),
      }
    }),

    askForRewind: ({ event }) => {
      const ev = event as { type: 'terminal.REWIND'; terminalId: string; cols: number; rows: number }
      sendToSystem('code', { type: 'terminal.REWIND', terminalId: ev.terminalId, cols: ev.cols, rows: ev.rows })
    },

    /** A recording opened for this window: shown at its end, which is where the terminal is now */
    openRewind: assign(({ context, event }) => {
      const ev = event as { type: 'terminal.REWOUND'; data: { terminalId: string; session: string; first: number; last: number } }
      // The one this window was looking at is closed where it was opened; what drew it goes here
      if (context.rewind && context.rewind.session !== ev.data.session) terminalPool.dispose(rewindViewId(context.rewind.session))
      return { rewind: { ...ev.data, at: ev.data.last } }
    }),

    resizeRewind: ({ context, event }) => {
      const ev = event as { type: 'terminal.REWIND_RESIZE'; cols: number; rows: number }
      if (context.rewind) sendToSystem('code', { type: 'terminal.REWIND_RESIZE', session: context.rewind.session, cols: ev.cols, rows: ev.rows })
    },

    seekRewind: ({ context, event }) => {
      const ev = event as { type: 'terminal.REWIND_SEEK'; at: number }
      if (context.rewind) sendToSystem('code', { type: 'terminal.REWIND_SEEK', session: context.rewind.session, at: ev.at })
    },

    noteRewindSought: assign(({ context, event }) => {
      const ev = event as { type: 'terminal.REWIND_SOUGHT'; data: { session: string; at: number } }
      if (context.rewind?.session !== ev.data.session) return {}
      return { rewind: { ...context.rewind, at: ev.data.at } }
    }),

    closeRewind: assign(({ context }) => {
      if (context.rewind) {
        sendToSystem('code', { type: 'terminal.REWIND_CLOSE', session: context.rewind.session })
        terminalPool.dispose(rewindViewId(context.rewind.session))
      }
      return { rewind: null }
    }),

    /**
     * A program asked for text to be put on the clipboard.
     *
     * **Every window that shows the code surface hears this and asks the main process to write it.** The text is the
     * same in each, so the result is the same, and the write needs no focus: a window's own clipboard write is refused
     * by the browser while its document is not focused, which is when a program's write usually arrives. The main
     * process answers whether it wrote the text; one too large to hold is refused, not cut.
     */
    writeClipboard: ({ event }) => {
      const ev = event as { type: 'terminal.CLIPBOARD'; data: { terminalId: string; text: string } }
      void window.electronAPI?.clipboard.writeText(ev.data.text)
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
    activity: {},
    rewind: null,
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
    'terminal.DETACHED': {
      actions: 'releaseTerminalFit'
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
      actions: ['handleTerminalClosed', 'forgetActivity']
    },
    'terminal.CRASHED': {
      actions: ['markTerminalCrashed', 'describeTerminal', 'noteCrashOnScreen']
    },
    'terminal.RESTARTED': {
      actions: ['takeRestartedTerminal', 'describeTerminal']
    },
    'terminal.RENAMED': {
      actions: 'updateTerminalTitle'
    },
    'terminal.CWD_CHANGED': {
      actions: ['updateTerminalCwd', 'describeTerminal']
    },
    'terminal.CLIPBOARD': {
      actions: 'writeClipboard'
    },
    'terminal.BELL': { actions: 'noteActivity' },
    'terminal.NOTIFIED': { actions: ['noteActivity', 'notifySystem'] },
    'terminal.PROGRESS': { actions: 'noteActivity' },
    'terminal.TITLED': { actions: 'noteActivity' },
    'terminal.SEEN': { actions: 'markSeen' },
    'terminal.KEEP': { actions: 'keepTerminal' },
    'terminal.KEPT': { actions: ['markKept', 'describeTerminal'] },
    'terminal.REWIND': { actions: 'askForRewind' },
    'terminal.REWOUND': { actions: 'openRewind' },
    'terminal.REWIND_SEEK': { actions: 'seekRewind' },
    'terminal.REWIND_SOUGHT': { actions: 'noteRewindSought' },
    'terminal.REWIND_CLOSE': { actions: 'closeRewind' },
    'terminal.REWIND_RESIZE': { actions: 'resizeRewind' },
    'terminal.ERROR': {
      actions: 'settleFailedAsk'
    },
    'terminal.RESIZED': {
      actions: ['updateTerminalGrid', 'describeTerminal']
    },
    'terminal.TERMINAL_TAB_OPENED': {
      actions: 'handleTerminalTabOpened'
    }
  },
  states: {
    idle: {
    }
  }
});

/** The terminal child's actor, as the code surface's components reach it with `codeChild()` */
export type TerminalActor = ActorRefFrom<typeof terminalState>;
