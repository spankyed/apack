import { setup, assign, enqueueActions, type ActorRefFrom } from 'xstate';
import { fromAsk, sendToSystem } from '#generated/events.ts';
import type { AnswerPayload, AskName, AskOutcome } from '@apackdev/sdk/events';
import { safeEvents } from '@apackdev/sdk/helpers';
import type { Contract as CodeSystemContract } from '#features/code/be/contract.ts';
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
  terminals: TerminalInfo[]
  /** By terminal, for the ones whose program has said something */
  activity: Record<string, TerminalActivity>
  /** The recording this window is looking back through, when it is */
  rewind: TerminalRewindView | null
  /**
   * What each outstanding `terminal.CREATE_TERMINAL` meant, by the id its ask was spawned under.
   *
   * **Keyed by the ask, because nothing about the terminal identifies it.** A fetch keys its answers by what it
   * asked for; a terminal ask carries nothing that does, since the backend mints the id. The ask's own id is what
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
   * The last of this window's asks that was not done, held until the canvas has told the person: a terminal that is
   * not there, a shell that would not start. A new object for each, so two failures with one message are two
   */
  failure: { message: string } | null
}

/** The terminal asks of the code system */
type TerminalAsks = { [K in Extract<AskName<CodeSystemContract>, `terminal.${string}`>]: CodeSystemContract['asks'][K] }

/**
 * The asks this machine makes several of at once, by the name each is spawned under: a spawned ask's id is
 * `<name>.<n>`, so its ending arrives as `xstate.done.actor.<name>.<n>` and a transition names the kind it is about
 */
type SpawnedAsks = {
  create: 'terminal.CREATE_TERMINAL'
  close: 'terminal.CLOSE_TERMINAL'
  restart: 'terminal.RESTART_TERMINAL'
  resize: 'terminal.RESIZE_TERMINAL'
  rename: 'terminal.RENAME_TERMINAL'
  openTab: 'terminal.OPEN_TERMINAL_TAB'
  keep: 'terminal.KEEP_TERMINAL'
  rewind: 'terminal.REWIND'
  seek: 'terminal.REWIND_SEEK'
}

/** How an ask ended, as the event its actor finishes with: a spawned one, or the list the `listing` state invokes */
type AskEnded =
  | { [Name in keyof SpawnedAsks]: { type: `xstate.done.actor.${Name}.${string}`; output: AskOutcome<TerminalAsks[SpawnedAsks[Name]]>; actorId: string } }[keyof SpawnedAsks]
  | { type: 'xstate.done.actor.list'; output: AskOutcome<TerminalAsks['terminal.REFRESH_LIST']>; actorId: string }

/** A grid the pty runs at: broadcast when it moved, or the answer to this window's own fit when that was refused */
type TerminalGrid = { terminalId: string; cols: number; rows: number }

export type Event =
  /** How each ask this machine made ended */
  | AskEnded
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
  // The person was told of the failure held: the canvas says so once it has shown it
  | { type: 'terminal.FAILURE_TOLD' }
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

/** The id the next ask of a kind is spawned under, which no other ask has */
let spawned = 0
const askId = <Name extends keyof SpawnedAsks>(name: Name): `${Name}.${number}` => `${name}.${++spawned}`

/** How the ask an event ends ended; throws for an event that ends none, which is an action on the wrong transition */
function outcomeIn(event: Event): AskEnded['output'] {
  if (!('output' in event)) throw new Error(`Expected the end of an ask, got ${event.type}`)
  return event.output
}

/** Whether an event is the end of a spawned ask of that kind */
const ends = (name: keyof SpawnedAsks, event: Event): boolean => event.type.startsWith(`xstate.done.actor.${name}.`)

/** The answer a spawned ask ended with, for an action its transition runs only when it was answered (`answered`) */
function answerIn<Name extends keyof SpawnedAsks>(name: Name, event: Event): AnswerPayload<TerminalAsks[SpawnedAsks[Name]]> {
  const outcome = outcomeIn(event)
  if (!ends(name, event) || !outcome.ok) throw new Error(`Expected the answer to a ${name} ask, got ${event.type}`)
  return outcome.value as AnswerPayload<TerminalAsks[SpawnedAsks[Name]]>
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
    list: fromAsk('code', 'terminal.REFRESH_LIST'),
    create: fromAsk('code', 'terminal.CREATE_TERMINAL'),
    close: fromAsk('code', 'terminal.CLOSE_TERMINAL'),
    restart: fromAsk('code', 'terminal.RESTART_TERMINAL'),
    resize: fromAsk('code', 'terminal.RESIZE_TERMINAL'),
    rename: fromAsk('code', 'terminal.RENAME_TERMINAL'),
    openTab: fromAsk('code', 'terminal.OPEN_TERMINAL_TAB'),
    keep: fromAsk('code', 'terminal.KEEP_TERMINAL'),
    rewind: fromAsk('code', 'terminal.REWIND'),
    seek: fromAsk('code', 'terminal.REWIND_SEEK'),
  },
  guards: {
    /** The ask an event ends was answered, rather than refused */
    answered: ({ event }) => outcomeIn(event).ok,
    /** This window's fit was refused: its answer is the grid the pty runs at instead */
    fitRefused: ({ event }) => {
      const outcome = outcomeIn(event)
      return ends('resize', event) && outcome.ok && outcome.value !== null
    },
  },
  actions: {
    /** An ask that ended is no longer this machine's child */
    forgetAsk: enqueueActions(({ enqueue, event }) => {
      if ('actorId' in event) enqueue.stopChild(event.actorId)
    }),

    /**
     * An ask of this window's that was not done, kept for the canvas to tell the person. The window that asked is the
     * one that shows it: the system answers a failure to its asker and tells nobody else
     */
    noteAskFailure: assign(({ event }) => {
      const outcome = outcomeIn(event)
      return outcome.ok ? {} : { failure: { message: outcome.failure.message } }
    }),

    /** The intent is recorded under the id its ask is spawned under, which is what the ask's ending names */
    createTerminal: enqueueActions(({ event, self, enqueue }) => {
      const ev = typeOf('terminal.CREATE', event)
      const parentContext = getParentContext(self)
      const baseDir = parentContext?.baseDirectory
      const id = askId('create')

      enqueue.assign(({ context }) => ({
        pendingOpens: { ...context.pendingOpens, [id]: { target: ev.target ?? null, command: ev.command ?? null } },
      }))
      enqueue.spawnChild('create', {
        id,
        input: {
          title: ev.title,
          // `on` is one of the settings' targets: somewhere else, where this machine's directory names nothing
          ...(ev.on === undefined
            ? { cwd: ev.cwd || (baseDir && baseDir.trim() ? baseDir : undefined) }
            : { target: ev.on }),
        },
      })
    }),

    closeTerminal: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('close', { id: askId('close'), input: { terminalId: typeOf('terminal.CLOSE', event).terminalId } })
    }),

    restartTerminal: enqueueActions(({ event, enqueue }) => {
      enqueue.spawnChild('restart', { id: askId('restart'), input: { terminalId: typeOf('terminal.RESTART', event).terminalId } })
    }),

    sendTerminalInput: ({ event }) => {
      const ev = typeOf('terminal.INPUT', event)
      sendToSystem('code', { type: 'terminal.TERMINAL_INPUT', terminalId: ev.terminalId, data: ev.data })
    },

    releaseTerminalFit: ({ event }) => {
      sendToSystem('code', { type: 'terminal.STOPPED_FITTING', terminalId: typeOf('terminal.DETACHED', event).terminalId })
    },

    resizeTerminal: enqueueActions(({ event, enqueue }) => {
      const { terminalId, cols, rows, cellWidth, cellHeight } = typeOf('terminal.RESIZE', event)
      enqueue.spawnChild('resize', { id: askId('resize'), input: { terminalId, cols, rows, cellWidth, cellHeight } })
    }),

    renameTerminal: enqueueActions(({ event, enqueue }) => {
      const { terminalId, customTitle } = typeOf('terminal.RENAME', event)
      enqueue.spawnChild('rename', { id: askId('rename'), input: { terminalId, customTitle } })
    }),

    assignTerminals: enqueueActions(({ enqueue, self, event }) => {
      const outcome = outcomeIn(event)
      if (event.type !== 'xstate.done.actor.list' || !outcome.ok) throw new Error(`Expected the list of terminals, got ${event.type}`)
      const terminals = outcome.value as TerminalInfo[]
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
     * **Removing it is what used to happen and is what loses the error.** A shell that exits 0 still sends
     * `terminal.CLOSED` and the terminal still goes; this is the other case, where the screen holds the
     * reason the user now wants to read.
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
      const id = event.type === 'terminal.RESIZED' || ends('resize', event) ? gridIn(event)?.terminalId
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
      if (!('actorId' in event)) return {}
      const { [event.actorId]: _ended, ...pendingOpens } = context.pendingOpens
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
        sendToSystem('code', { type: 'terminal.STATUS_SEEN', terminalId: id })
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
      enqueue.spawnChild('keep', { id: askId('keep'), input: { terminalId, kept } })
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
      enqueue.spawnChild('rewind', { id: askId('rewind'), input: { terminalId, cols, rows } })
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
      if (context.rewind) sendToSystem('code', { type: 'terminal.REWIND_RESIZE', session: context.rewind.session, cols: ev.cols, rows: ev.rows })
    },

    seekRewind: enqueueActions(({ context, event, enqueue }) => {
      if (context.rewind) enqueue.spawnChild('seek', { id: askId('seek'), input: { session: context.rewind.session, at: typeOf('terminal.REWIND_SEEK', event).at } })
    }),

    noteRewindSought: assign(({ context, event }) => {
      const sought = answerIn('seek', event)
      if (!sought || context.rewind?.session !== sought.session) return {}
      return { rewind: { ...context.rewind, at: sought.at } }
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
     * The ask's id says *which of that window's asks*, which addressing cannot — see `pendingOpens`.
     */
    handleTerminalOpened: enqueueActions(({ enqueue, context, self, event }) => {
      const terminalInfo = answerIn('create', event)
      const { target, command } = ('actorId' in event ? context.pendingOpens[event.actorId] : undefined) ?? { target: null, command: null }
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
        enqueue.spawnChild('openTab', { id: askId('openTab'), input: { terminalId } })
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
    terminals: [],
    activity: {},
    rewind: null,
    pendingOpens: {},
    bells: {},
    notifying: {},
    statusNotified: {},
    failure: null
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
    // Entering `listing` again stops the ask under way and asks again: the list wanted is the one as it stands now
    'terminal.REFRESH_LIST': {
      target: '.listing', reenter: true
    },
    'terminal.OPEN_TAB': {
      actions: 'openTerminalTab'
    },
    'terminal.OPEN_TABS': {
      actions: 'openTerminalTabs'
    },
    // The surface started over its folder: what is running there
    CODE_STARTED: {
      target: '.listing', reenter: true
    },
    // The news, which every window takes: the list grows and nothing else happens
    // A terminal exists, in some window: ask for the list again, which the system answers this window alone
    'terminal.CREATED': {
      target: '.listing', reenter: true
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
    'terminal.FAILURE_TOLD': { actions: assign({ failure: null }) },
    'terminal.KEEP': { actions: 'keepTerminal' },
    'terminal.KEPT': { actions: ['markKept', 'describeTerminal'] },
    'terminal.REWIND': { actions: 'askForRewind' },
    'terminal.REWIND_SEEK': { actions: 'seekRewind' },
    'terminal.REWIND_CLOSE': { actions: 'closeRewind' },
    'terminal.REWIND_RESIZE': { actions: 'resizeRewind' },
    'terminal.RESIZED': {
      actions: ['updateTerminalGrid', 'describeTerminal']
    },
    // How each of this window's asks ended: its answer taken, or its failure kept for the panel to tell
    'xstate.done.actor.create.*': [
      { guard: 'answered', actions: ['handleTerminalOpened', 'forgetOpen', 'forgetAsk'] },
      { actions: ['forgetOpen', 'noteAskFailure', 'forgetAsk'] },
    ],
    'xstate.done.actor.openTab.*': [
      { guard: 'answered', actions: ['handleTerminalTabOpened', 'forgetAsk'] },
      { actions: ['noteAskFailure', 'forgetAsk'] },
    ],
    'xstate.done.actor.rewind.*': [
      { guard: 'answered', actions: ['openRewind', 'forgetAsk'] },
      { actions: ['noteAskFailure', 'forgetAsk'] },
    ],
    'xstate.done.actor.seek.*': [
      { guard: 'answered', actions: ['noteRewindSought', 'forgetAsk'] },
      { actions: ['noteAskFailure', 'forgetAsk'] },
    ],
    'xstate.done.actor.resize.*': [
      { guard: 'fitRefused', actions: ['updateTerminalGrid', 'describeTerminal', 'forgetAsk'] },
      { actions: ['noteAskFailure', 'forgetAsk'] },
    ],
    // Done is all these answer with, which the news tells every window: only a failure is this window's to show
    'xstate.done.actor.close.*': { actions: ['noteAskFailure', 'forgetAsk'] },
    'xstate.done.actor.restart.*': { actions: ['noteAskFailure', 'forgetAsk'] },
    'xstate.done.actor.rename.*': { actions: ['noteAskFailure', 'forgetAsk'] },
    'xstate.done.actor.keep.*': { actions: ['noteAskFailure', 'forgetAsk'] },
  },
  states: {
    idle: {},
    // The running terminals are being asked for, for exactly as long as this state is
    listing: {
      invoke: {
        id: 'list',
        src: 'list',
        input: {},
        onDone: [
          { guard: 'answered', target: 'idle', actions: 'assignTerminals' },
          { target: 'idle', actions: 'noteAskFailure' },
        ],
      },
    },
  }
});

/** The terminal child's actor, as the code surface's components reach it with `codeChild()` */
export type TerminalActor = ActorRefFrom<typeof terminalState>;
