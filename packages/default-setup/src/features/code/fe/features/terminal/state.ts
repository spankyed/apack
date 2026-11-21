import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { fromAsk, tell } from '#generated/events.ts';
import { safeEvents } from '@apackdev/sdk/helpers';
import { freshKey, makes, type MadeEvent, type Making } from '@apackdev/sdk/fe';
import { terminalPool } from '../../utils/terminal-pool.ts';
import { updateParentState, getParentContext, addTabToParent, sendEventToParent } from '../../utils/parent-communication.ts';
import { removeTabs, nextActiveFromHistory } from '../../utils/tab-management.ts';
import type { TerminalInfo, TerminalStatus } from '../../../be/types.ts'
import { lookedAt, needsLooking, newlyWanting, statusNotification } from './status.ts'
import { terminalNameFor } from '../../utils/terminal-name.ts'

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

/** How long a bell paints its terminal's flash (Phase 2, D7) */
export const BELL_FLASH_MS = 150
/**
 * The window in which a bell is the same bell as one already accepted: a bell inside it changes nothing. Measured from the
 * accepted bell, so the flash (150 ms) is followed by the rest of the window (350 ms) before another bell is a new one.
 */
export const BELL_WINDOW_MS = 500
/**
 * The window in which a terminal's bell notification is not repeated. It is its own gate, separate from the flash's
 * window: a bell that the flash ignores as the same bell can still be a notification of its own once this has closed.
 * The gate is not queued: a bell inside it is not notified and nothing notifies it later, so a run of bells inside one
 * second shows one notification, and the bells after it are seen only as flashes.
 */
export const BELL_NOTIFY_WINDOW_MS = 1000

/** The name a recording's view is pooled under, which is not a terminal's and cannot be taken for one */
export const rewindViewId = (session: string) => `rewind:${session}`

const createTerminalTab = (info: TerminalInfo) => ({
  path: `terminal:${info.id}`,
  content: '',
  modified: false,
  isTerminal: true,
  terminalInfo: info
})

/** What this window meant by one `terminal.CREATE`, held until the ask it made ends */
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
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
  terminals: TerminalInfo[]
  /** By terminal, for the ones whose program has said something */
  activity: Record<string, TerminalActivity>
  /** The recording this window is looking back through, when it is */
  rewind: TerminalRewindView | null
  /**
   * What each outstanding `terminal.CREATE_TERMINAL` meant, by the key its ask was made under.
   *
   * **Keyed by the ask, because nothing about the terminal identifies it.** A fetch keys its answers by what it
   * asked for; a terminal ask carries nothing that does, since the backend mints the id. The ask's own key is what
   * its ending names, so it is the only key available.
   *
   * **One slot for all of them is the trap**, and it is invisible when it fires: two creates in flight share
   * it, so the second's intent is what the first answer reads and the second answer finds nothing. Run
   * "build" then "test" before the first answer and `test` runs in the build terminal
   * (`docs/issues/ISSUE-terminal-integration-review.md`, T4).
   *
   * An entry is removed when its ask ends, with the terminal or with a refusal, so the map holds only what is
   * genuinely in flight.
   */
  pendingOpens: Record<string, PendingOpen>
  /**
   * The bells accepted and still inside their window, by terminal. `flashing` is the terminal's flash, which the view
   * paints; `quiet` is the rest of the window. Each entry is removed by a timer its accepted bell started, so an entry
   * never outlives its window. Empty of a terminal whose bells are not flashed when the flash setting is off, which
   * still opens the window so a notification is not repeated.
   */
  bells: Record<string, 'flashing' | 'quiet'>
  /**
   * The terminals whose bell notification was asked for within the last `BELL_NOTIFY_WINDOW_MS`. Each entry is removed by
   * a timer its notification started, so an entry never outlives its window.
   */
  notifying: Record<string, true>
  /**
   * The terminals a status notification was raised for and the person has not looked at since. One is raised
   * for a terminal and then none until they look, so a program going back and forth tells them once.
   */
  statusNotified: Record<string, true>
  /**
   * This window's asks that were not done, each held until the canvas has told the person: a terminal that is not
   * there, a shell that would not start. An object for each, so two failures with one message are two
   */
  failures: readonly TerminalAskFailure[]
}

/** An ask of this window's that was not done, as the canvas tells it */
export interface TerminalAskFailure { message: string }

/**
 * The asks this machine makes, each under the name the machine makes it by. The list of running terminals is one at
 * a time, the one made last being the one heard. Every other is made under a key of its own (`freshKey`), several
 * at once, so that every one asked for is done
 */
const made = makes(({ one, each }) => ({
  list: one(fromAsk('code', 'terminal.REFRESH_LIST')),
  create: each(fromAsk('code', 'terminal.CREATE_TERMINAL')),
  close: each(fromAsk('code', 'terminal.CLOSE_TERMINAL')),
  restart: each(fromAsk('code', 'terminal.RESTART_TERMINAL')),
  resize: each(fromAsk('code', 'terminal.RESIZE_TERMINAL')),
  rename: each(fromAsk('code', 'terminal.RENAME_TERMINAL')),
  openTab: each(fromAsk('code', 'terminal.OPEN_TERMINAL_TAB')),
  keep: each(fromAsk('code', 'terminal.KEEP_TERMINAL')),
  rewind: each(fromAsk('code', 'terminal.REWIND')),
  seek: each(fromAsk('code', 'terminal.REWIND_SEEK')),
}))

/** The name an ask is made under */
type Name = (typeof made.names)[number]

/** How an ask the machine made ended */
type Made = MadeEvent<typeof made>

/** How the ask made as `N` ended */
type OutcomeOf<N extends Name> = Extract<Made, { type: `made.${N}` }> extends { outcome: infer Outcome } ? Outcome : never

/** What the ask made as `N` is answered with */
type AnswerOf<N extends Name> = OutcomeOf<N> extends infer Outcome ? (Outcome extends { ok: true; value: infer Answer } ? Answer : never) : never

/** A grid the pty runs at: broadcast when it moved, or the answer to this window's own fit when that was refused */
type TerminalGrid = { terminalId: string; cols: number; rows: number }

export type Event =
  /** How each ask this machine made ended */
  | Made
  /** The surface started over its folder: the panel asks for the running terminals */
  | { type: 'CODE_STARTED' }
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
  | { type: 'terminal.CREATED'; data: { terminalId: string } }
  | { type: 'terminal.CLOSED'; data: { terminalId: string } }
  | { type: 'terminal.CRASHED'; data: { terminalId: string; code: number | null } }
  | { type: 'terminal.RESTARTED'; data: TerminalInfo }
  | { type: 'terminal.RENAMED'; data: { terminalId: string; customTitle: string } }
  | { type: 'terminal.CWD_CHANGED'; data: { terminalId: string; cwd: string; title?: string } }
  | { type: 'terminal.CLIPBOARD'; data: { terminalId: string; text: string } }
  | { type: 'terminal.BELL'; data: { terminalId: string; bellId: string } }
  | { type: 'terminal.NOTIFIED'; data: { terminalId: string; title: string; body: string } }
  | { type: 'terminal.PROGRESS'; data: { terminalId: string; state: 'none' | 'running' | 'error' | 'indeterminate' | 'paused'; percent: number | null } }
  | { type: 'terminal.TITLED'; data: { terminalId: string; title: string } }
  /** What a terminal's programs say they are doing, every record as it stands, and what of it has been seen */
  | { type: 'terminal.STATUS'; data: { terminalId: string; statuses: TerminalStatus[] } }
  /** The person is looking at that terminal: what was waiting for them to is no longer */
  | { type: 'terminal.SEEN'; terminalId: string }
  // The person was told of these failures, which stop being held: the canvas says so as it shows them
  | { type: 'terminal.FAILURES_TOLD'; told: readonly TerminalAskFailure[] }
  /** The machine's own timers: a bell's flash ends, and its window closes. Not sent by anything else. */
  | { type: 'terminal.BELL_FLASH_ENDED'; terminalId: string }
  | { type: 'terminal.BELL_WINDOW_ENDED'; terminalId: string }
  | { type: 'terminal.BELL_NOTIFY_WINDOW_ENDED'; terminalId: string }
  | { type: 'terminal.KEEP'; terminalId: string; kept: boolean }
  | { type: 'terminal.KEPT'; data: { terminalId: string; kept: boolean } }
  | { type: 'terminal.REWIND'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.REWIND_SEEK'; at: number }
  | { type: 'terminal.REWIND_CLOSE' }
  | { type: 'terminal.REWIND_RESIZE'; cols: number; rows: number }
  | { type: 'terminal.RESIZED'; data: TerminalGrid }

const typeOf = safeEvents<Event>()

/** How the ask an event ends ended; throws for an event that ends none, which is an action on the wrong transition */
function outcomeIn(event: Event): OutcomeOf<Name> {
  if (!('outcome' in event)) throw new Error(`Expected the end of an ask, got ${event.type}`)
  return event.outcome
}

/** The key the ask an event ends was made under; throws for an event that ends none made under one */
function keyIn(event: Event): string {
  if (!('key' in event)) throw new Error(`Expected the end of an ask made under a key, got ${event.type}`)
  return event.key
}

/** The answer an ask ended with, for an action its transition runs only when it was answered (`answered`) */
function answerIn<N extends Name>(name: N, event: Event): AnswerOf<N> {
  const outcome = outcomeIn(event)
  if (event.type !== `made.${name}` || !outcome.ok) throw new Error(`Expected the answer to a ${name} ask, got ${event.type}`)
  return outcome.value as AnswerOf<N>
}

/** The grid an event carries, as `terminal.RESIZED` or as the answer to this window's `terminal.RESIZE_TERMINAL` */
const gridIn = (event: Event): TerminalGrid | null =>
  event.type === 'terminal.RESIZED' ? event.data : answerIn('resize', event)

/**
 * Asks the main process to show the system notification a bell asks for. Through the bridge, because a window's own
 * `Notification` is refused while the window is not focused, which is the case this exists for.
 */
export function showBellNotification(bellId: string): void {
  void window.electronAPI?.notify?.show('Terminal', 'Rang the bell', bellId).catch(() => {})
}

/**
 * Asks the main process to tell the person a terminal's program wants them. Through the bridge, as a bell's
 * is, and under a tag so that every window that was not in front raises one between them.
 */
export function showStatusNotification(terminalId: string, terminal: string, record: TerminalStatus): void {
  const { title, body } = statusNotification(terminal, record)
  void window.electronAPI?.notify?.show(title, body, `terminal-status:${terminalId}:${record.id}:${record.changed}`).catch(() => {})
}

export const terminalState = setup({
  types: {
    context: {} as CodeTerminalContext,
    events: {} as Event
  },
  actors: {
    ...made.actors,
  },
  guards: {
    /** The ask an event ends was answered, rather than refused */
    answered: ({ event }) => outcomeIn(event).ok,
    /** This window's fit was refused: its answer is the grid the pty runs at instead */
    fitRefused: ({ event }) => {
      const outcome = outcomeIn(event)
      return event.type === 'made.resize' && outcome.ok && outcome.value !== null
    },
  },
  actions: {
    /**
     * An ask of this window's that was not done, kept for the canvas to tell the person. The window that asked is the
     * one that shows it: the system answers a failure to its asker and tells nobody else
     */
    noteAskFailure: assign(({ context, event }) => {
      const outcome = outcomeIn(event)
      return outcome.ok ? {} : { failures: [...context.failures, { message: outcome.failure.message }] }
    }),

    /** The failures the canvas told the person of stop being held; one noted since is still to tell */
    forgetToldFailures: assign(({ context, event }) => {
      const { told } = typeOf('terminal.FAILURES_TOLD', event)
      return { failures: context.failures.filter(failure => !told.includes(failure)) }
    }),

    /** The intent is recorded under the key its ask is made under, which is what the ask's ending names */
    createTerminal: enqueueActions(({ event, self, enqueue }) => {
      const ev = typeOf('terminal.CREATE', event)
      const parentContext = getParentContext(self)
      const baseDir = parentContext?.baseDirectory
      const key = freshKey()

      enqueue.assign(({ context }) => ({
        pendingOpens: { ...context.pendingOpens, [key]: { target: ev.target ?? null, command: ev.command ?? null } },
      }))
      made.make(enqueue, 'create', key, {
        title: ev.title,
        // `on` is one of the settings' targets: somewhere else, where this machine's directory names nothing
        ...(ev.on === undefined
          ? { cwd: ev.cwd || (baseDir && baseDir.trim() ? baseDir : undefined) }
          : { target: ev.on }),
      })
    }),

    /** Asks for the running terminals, in place of an ask for them under way */
    askForList: enqueueActions(({ enqueue }) => made.make(enqueue, 'list', {})),

    closeTerminal: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'close', freshKey(), { terminalId: typeOf('terminal.CLOSE', event).terminalId })
    }),

    restartTerminal: enqueueActions(({ event, enqueue }) => {
      made.make(enqueue, 'restart', freshKey(), { terminalId: typeOf('terminal.RESTART', event).terminalId })
    }),

    sendTerminalInput: ({ event }) => {
      const ev = typeOf('terminal.INPUT', event)
      tell('code', { type: 'terminal.TERMINAL_INPUT', terminalId: ev.terminalId, data: ev.data })
    },

    releaseTerminalFit: ({ event }) => {
      tell('code', { type: 'terminal.STOPPED_FITTING', terminalId: typeOf('terminal.DETACHED', event).terminalId })
    },

    resizeTerminal: enqueueActions(({ event, enqueue }) => {
      const { terminalId, cols, rows, cellWidth, cellHeight } = typeOf('terminal.RESIZE', event)
      made.make(enqueue, 'resize', freshKey(), { terminalId, cols, rows, cellWidth, cellHeight })
    }),

    renameTerminal: enqueueActions(({ event, enqueue }) => {
      const { terminalId, customTitle } = typeOf('terminal.RENAME', event)
      made.make(enqueue, 'rename', freshKey(), { terminalId, customTitle })
    }),

    assignTerminals: enqueueActions(({ enqueue, self, event }) => {
      const terminals: TerminalInfo[] = answerIn('list', event)
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
        const ev = typeOf('terminal.CLOSED', event)
        return context.terminals.filter(t => t.id !== ev.data.terminalId)
      }
    }),

    /**
     * A shell died badly and its terminal stays.
     *
     * **Removing it would lose the error.** A shell that exits 0 sends `terminal.CLOSED` and the terminal goes;
     * this is the other case, where the screen holds the reason the user wants to read.
     */
    markTerminalCrashed: assign({
      terminals: ({ context, event }) => {
        const ev = typeOf('terminal.CRASHED', event)
        return context.terminals.map(one =>
          one.id === ev.data.terminalId ? { ...one, active: false, exited: { code: ev.data.code } } : one)
      }
    }),

    /** Says on the screen that the shell has gone, where the user is already looking */
    noteCrashOnScreen: ({ event }) => {
      const ev = typeOf('terminal.CRASHED', event)
      terminalPool.noteExit(ev.data.terminalId, ev.data.code)
    },

    /**
     * Tells the pool what the list now says of the terminal this event was about. Every event that changes
     * one runs this after its own change, so what draws a terminal never holds an older word on it than
     * the list does.
     */
    describeTerminal: ({ context, event }) => {
      const id = event.type === 'terminal.RESIZED' || event.type === 'made.resize' ? gridIn(event)?.terminalId
        : event.type === 'terminal.RESTARTED' ? event.data.id
        : 'data' in event && typeof event.data === 'object' ? event.data.terminalId
        : undefined
      const info = context.terminals.find(terminal => terminal.id === id)
      if (info) terminalPool.describe(info)
    },

    /** A new shell under a terminal that was already there: its descriptor is replaced, its place is not */
    takeRestartedTerminal: assign({
      terminals: ({ context, event }) => {
        const ev = typeOf('terminal.RESTARTED', event)
        return context.terminals.map(one => one.id === ev.data.id ? ev.data : one)
      }
    }),

    updateTerminalTitle: enqueueActions(({ enqueue, context, event, self }) => {
      const ev = typeOf('terminal.RENAMED', event)

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
      // It arrives two ways and both end here: broadcast when the size moved, and answered to this window
      // alone when its own fit was refused.
      const grid = gridIn(event)
      if (!grid) return {}
      return {
        terminals: context.terminals.map(terminal => terminal.id === grid.terminalId
          ? { ...terminal, cols: grid.cols, rows: grid.rows }
          : terminal),
      }
    }),

    updateTerminalCwd: enqueueActions(({ enqueue, context, event, self }) => {
      const ev = typeOf('terminal.CWD_CHANGED', event)

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

    /** A create that ended stops being outstanding, and what it meant goes with it */
    forgetOpen: assign(({ context, event }) => {
      const { [keyIn(event)]: _ended, ...pendingOpens } = context.pendingOpens
      return { pendingOpens }
    }),

    cleanupTerminalOutput: ({ event }) => {
      terminalPool.dispose(typeOf('terminal.CLOSED', event).data.terminalId)
    },

    /** What a closed terminal's program had said goes with it */
    forgetActivity: assign(({ context, event }) => {
      const { [typeOf('terminal.CLOSED', event).data.terminalId]: _gone, ...activity } = context.activity
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
      const ev = typeOf('terminal.NOTIFIED', event)
      if (document.hasFocus() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      new Notification(ev.data.title || 'Terminal', { body: ev.data.body, tag: `terminal:${ev.data.terminalId}` })
    },

    /**
     * **Where a bell is accepted, and the only place the flash and the notification start.** A bell inside the window an
     * accepted bell opened is the same bell and does nothing, so a bell during a flash does not restart it. The flash and
     * the window are timers the machine raises itself: a terminal that stops takes them with it, and nothing watches a
     * value that could be set twice.
     */
    ringBell: enqueueActions(({ context, event, self, enqueue }) => {
      const ev = typeOf('terminal.BELL', event)
      const id = ev.data.terminalId
      const settings = getParentContext(self)?.settings
      if (context.bells[id] === undefined) {
        const flash = settings?.bellFlash !== false
        enqueue.assign({ bells: { ...context.bells, [id]: flash ? 'flashing' : 'quiet' } })
        if (flash) enqueue.raise({ type: 'terminal.BELL_FLASH_ENDED', terminalId: id }, { delay: BELL_FLASH_MS })
        enqueue.raise({ type: 'terminal.BELL_WINDOW_ENDED', terminalId: id }, { delay: BELL_WINDOW_MS })
      }
      // The notification has its own gate, not the flash's: a bell the flash ignores as the same bell can still be
      // notified once the notification window is clear. A bell inside it is not notified, and is not queued.
      if (context.notifying[id] !== undefined) return
      // Not while the window has the focus: the person can see the terminal then, and the flash says it
      if (settings?.bellNotification === true && !document.hasFocus()) {
        enqueue.assign({ notifying: { ...context.notifying, [id]: true } })
        enqueue.raise({ type: 'terminal.BELL_NOTIFY_WINDOW_ENDED', terminalId: id }, { delay: BELL_NOTIFY_WINDOW_MS })
        showBellNotification(ev.data.bellId)
      }
    }),

    endBellNotifyWindow: assign(({ context, event }) => {
      const { [typeOf('terminal.BELL_NOTIFY_WINDOW_ENDED', event).terminalId]: _closed, ...rest } = context.notifying
      return { notifying: rest }
    }),

    endBellFlash: assign(({ context, event }) => {
      const id = typeOf('terminal.BELL_FLASH_ENDED', event).terminalId
      if (context.bells[id] !== 'flashing') return {}
      return { bells: { ...context.bells, [id]: 'quiet' as const } }
    }),

    endBellWindow: assign(({ context, event }) => {
      const { [typeOf('terminal.BELL_WINDOW_ENDED', event).terminalId]: _closed, ...rest } = context.bells
      return { bells: rest }
    }),

    /** What a terminal's program said that is not on its screen, kept for its tab to show */
    noteActivity: assign(({ context, event }) => {
      const ev = typeOf(['terminal.BELL', 'terminal.NOTIFIED', 'terminal.PROGRESS', 'terminal.TITLED'], event)
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

    /**
     * Tells the person a terminal's program wants them, where they are not looking: it is waiting on them, or
     * finished or failed. **Once for a terminal until they look at it**, however often its program changes its
     * mind. Read before the records are taken, since it is the difference from what was held that says so.
     */
    notifyStatus: enqueueActions(({ context, event, self, enqueue }) => {
      const ev = typeOf('terminal.STATUS', event)
      const id = ev.data.terminalId
      const terminal = context.terminals.find(one => one.id === id)
      if (!terminal) return
      // Looked at in another window, which every window is told as the same records, seen
      if (lookedAt(terminal.statuses, ev.data.statuses)) {
        const { [id]: _looked, ...rest } = context.statusNotified
        enqueue.assign({ statusNotified: rest })
        return
      }
      const wanting = newlyWanting(terminal.statuses, ev.data.statuses)
      if (!wanting || context.statusNotified[id] !== undefined || document.hasFocus()) return
      if (getParentContext(self)?.settings?.terminalStatusNotification === false) return
      enqueue.assign({ statusNotified: { ...context.statusNotified, [id]: true } })
      showStatusNotification(id, terminal.customTitle || terminalNameFor(terminal.cwd) || terminal.title, wanting)
    }),

    /** What a terminal's programs say they are doing, replaced whole: there is nothing to merge */
    takeStatuses: assign(({ context, event }) => {
      const ev = typeOf('terminal.STATUS', event)
      return {
        terminals: context.terminals.map(terminal => {
          if (terminal.id !== ev.data.terminalId) return terminal
          const { statuses: _were, ...rest } = terminal
          return ev.data.statuses.length ? { ...rest, statuses: ev.data.statuses } : rest
        }),
      }
    }),

    /** The person looked, so what its programs wanted them for is seen — in every window, which the system tells */
    tellStatusSeen: enqueueActions(({ context, event, enqueue }) => {
      const id = typeOf('terminal.SEEN', event).terminalId
      if (context.statusNotified[id] !== undefined) {
        const { [id]: _looked, ...rest } = context.statusNotified
        enqueue.assign({ statusNotified: rest })
      }
      if (needsLooking(context.terminals.find(terminal => terminal.id === id)?.statuses)) {
        tell('code', { type: 'terminal.STATUS_SEEN', terminalId: id })
      }
    }),

    /** The person looked: the bell and the notification were for them, and have been seen */
    markSeen: assign(({ context, event }) => {
      const ev = typeOf('terminal.SEEN', event)
      const before = context.activity[ev.terminalId]
      if (!before?.bell && !before?.notification) return {}
      const { bell: _bell, notification: _notification, ...rest } = before
      return { activity: { ...context.activity, [ev.terminalId]: rest } }
    }),

    keepTerminal: enqueueActions(({ event, enqueue }) => {
      const { terminalId, kept } = typeOf('terminal.KEEP', event)
      made.make(enqueue, 'keep', freshKey(), { terminalId, kept })
    }),

    markKept: assign(({ context, event }) => {
      const ev = typeOf('terminal.KEPT', event)
      return {
        terminals: context.terminals.map(terminal => terminal.id === ev.data.terminalId
          ? { ...terminal, kept: ev.data.kept }
          : terminal),
      }
    }),

    askForRewind: enqueueActions(({ event, enqueue }) => {
      const { terminalId, cols, rows } = typeOf('terminal.REWIND', event)
      made.make(enqueue, 'rewind', freshKey(), { terminalId, cols, rows })
    }),

    /** A recording opened for this window: shown at its end, which is where the terminal is now */
    openRewind: assign(({ context, event }) => {
      const opened = answerIn('rewind', event)
      // The one this window was looking at is closed where it was opened; what drew it goes here
      if (context.rewind && context.rewind.session !== opened.session) terminalPool.dispose(rewindViewId(context.rewind.session))
      return { rewind: { ...opened, at: opened.last } }
    }),

    resizeRewind: ({ context, event }) => {
      const ev = typeOf('terminal.REWIND_RESIZE', event)
      if (context.rewind) tell('code', { type: 'terminal.REWIND_RESIZE', session: context.rewind.session, cols: ev.cols, rows: ev.rows })
    },

    seekRewind: enqueueActions(({ context, event, enqueue }) => {
      if (context.rewind) made.make(enqueue, 'seek', freshKey(), { session: context.rewind.session, at: typeOf('terminal.REWIND_SEEK', event).at })
    }),

    noteRewindSought: assign(({ context, event }) => {
      const sought = answerIn('seek', event)
      if (!sought || context.rewind?.session !== sought.session) return {}
      return { rewind: { ...context.rewind, at: sought.at } }
    }),

    closeRewind: assign(({ context }) => {
      if (context.rewind) {
        tell('code', { type: 'terminal.REWIND_CLOSE', session: context.rewind.session })
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
      const ev = typeOf('terminal.CLIPBOARD', event)
      // A refusal (the text is too large) and a failed call both leave the clipboard as it was, so neither is an error here
      void window.electronAPI?.clipboard.writeText(ev.data.text).catch(() => false)
    },

    /**
     * Opens the terminal *this* window asked for, the way *that* ask asked for it.
     *
     * **Two correlations, answering different questions.** Addressing says *which window*: only the asker is
     * answered with the terminal, so hang this off the broadcast `terminal.CREATED` instead and every open
     * window routes a terminal it never asked for into its own panel and runs a command nobody typed there.
     * The ask's key says *which of that window's asks*, which addressing cannot — see `pendingOpens`.
     */
    handleTerminalOpened: enqueueActions(({ enqueue, context, self, event }) => {
      const terminalInfo = answerIn('create', event)
      const { target, command } = context.pendingOpens[keyIn(event)] ?? { target: null, command: null }
      enqueue(() => {
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
          tell('code', {
            type: 'terminal.TERMINAL_INPUT',
            terminalId: terminalInfo.id,
            // A descriptor from before this field existed, or from a backend mid-reload, must not put the
            // word `undefined` on the end of the user's command
            data: command + (terminalInfo.submit ?? '\n'),
          })
        }
      })
    }),

    /** The closed terminal's tab goes, and the panel moves on from it. Run with `removeTerminal`, in either order */
    handleTerminalClosed: enqueueActions(({ enqueue, context, self, event }) => {
      enqueue(() => {
        const terminalId = typeOf('terminal.CLOSED', event).data.terminalId
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
          // Excluded by id rather than by this running after `removeTerminal`: relying on that order is what
          // made the panel show a dead terminal
          const next = context.terminals.find(t => t.id !== terminalId && !tabbedIds.has(t.id))
          panelUpdate = { panelTerminalId: next?.id ?? null }
        }

        updateParentState(self, { ...result, ...panelUpdate })
      })
    }),

    openTerminalTab: ({ event, self }) => {
      const ev = typeOf('terminal.OPEN_TAB', event)
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

    /** One ask for each terminal, each answered with the terminal to open */
    openTerminalTabs: enqueueActions(({ event, enqueue }) => {
      typeOf('terminal.OPEN_TABS', event).terminalIds.forEach(terminalId => {
        made.make(enqueue, 'openTab', freshKey(), { terminalId })
      })
    }),

    handleTerminalTabOpened: ({ event, self }) => {
      const ev = { data: answerIn('openTab', event) }
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
    making: made.none(),
    terminals: [],
    activity: {},
    rewind: null,
    pendingOpens: {},
    bells: {},
    notifying: {},
    statusNotified: {},
    failures: []
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
    // An ask for the list under way is given up for this one: the list wanted is the one as it stands now
    'terminal.REFRESH_LIST': {
      actions: 'askForList'
    },
    'terminal.OPEN_TAB': {
      actions: 'openTerminalTab'
    },
    'terminal.OPEN_TABS': {
      actions: 'openTerminalTabs'
    },
    // The surface started over its folder: what is running there
    CODE_STARTED: {
      actions: 'askForList'
    },
    // News, which every window takes: a terminal exists, in some window. The list is asked for again, which the
    // system answers this window alone, and nothing else happens
    'terminal.CREATED': {
      actions: 'askForList'
    },
    'terminal.CLOSED': {
      actions: ['removeTerminal', 'cleanupTerminalOutput', 'handleTerminalClosed', 'forgetActivity']
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
    'terminal.BELL': { actions: ['noteActivity', 'ringBell'] },
    'terminal.BELL_FLASH_ENDED': { actions: 'endBellFlash' },
    'terminal.BELL_WINDOW_ENDED': { actions: 'endBellWindow' },
    'terminal.BELL_NOTIFY_WINDOW_ENDED': { actions: 'endBellNotifyWindow' },
    'terminal.NOTIFIED': { actions: ['noteActivity', 'notifySystem'] },
    'terminal.PROGRESS': { actions: 'noteActivity' },
    'terminal.TITLED': { actions: 'noteActivity' },
    'terminal.STATUS': { actions: ['notifyStatus', 'takeStatuses'] },
    'terminal.SEEN': { actions: ['markSeen', 'tellStatusSeen'] },
    'terminal.FAILURES_TOLD': { actions: 'forgetToldFailures' },
    'terminal.KEEP': { actions: 'keepTerminal' },
    'terminal.KEPT': { actions: ['markKept', 'describeTerminal'] },
    'terminal.REWIND': { actions: 'askForRewind' },
    'terminal.REWIND_SEEK': { actions: 'seekRewind' },
    'terminal.REWIND_CLOSE': { actions: 'closeRewind' },
    'terminal.REWIND_RESIZE': { actions: 'resizeRewind' },
    'terminal.RESIZED': {
      actions: ['updateTerminalGrid', 'describeTerminal']
    },
    // How each of this window's asks ended: its answer taken, or its failure kept for the canvas to tell
    [made.done]: { actions: made.settle() },
    'made.list': [
      { guard: 'answered', actions: 'assignTerminals' },
      { actions: 'noteAskFailure' },
    ],
    'made.create': [
      { guard: 'answered', actions: ['handleTerminalOpened', 'forgetOpen'] },
      { actions: ['forgetOpen', 'noteAskFailure'] },
    ],
    'made.openTab': [
      { guard: 'answered', actions: 'handleTerminalTabOpened' },
      { actions: 'noteAskFailure' },
    ],
    'made.rewind': [
      { guard: 'answered', actions: 'openRewind' },
      { actions: 'noteAskFailure' },
    ],
    'made.seek': [
      { guard: 'answered', actions: 'noteRewindSought' },
      { actions: 'noteAskFailure' },
    ],
    'made.resize': [
      { guard: 'fitRefused', actions: ['updateTerminalGrid', 'describeTerminal'] },
      { actions: 'noteAskFailure' },
    ],
    // Done is all these answer with, which the news tells every window: only a failure is this window's to show
    'made.close': { actions: 'noteAskFailure' },
    'made.restart': { actions: 'noteAskFailure' },
    'made.rename': { actions: 'noteAskFailure' },
    'made.keep': { actions: 'noteAskFailure' },
  },
  states: {
    idle: {},
  }
});

/** The terminal child's actor, as the code surface's components reach it with `codeChild()` */
export type TerminalActor = ActorRefFrom<typeof terminalState>;
