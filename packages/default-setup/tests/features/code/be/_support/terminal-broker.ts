// The broker, stood in for: one double every backend terminal spec opens its sessions through.
//
// **It was seven copies, and six of them lied the same way.** `terminate: async () => {}` ended no shell,
// where the real broker's kill is a signal — `portable-pty` sends SIGHUP and reports a signal death as a
// non-zero code; Windows is `TerminateProcess(…, 127)`. A double that reports nothing means the service's
// own "was this a close or a crash?" decision is never exercised, which is why two defects of exactly that
// shape (an exit from a replaced session, and a close read as a crash) could not be caught by any case in
// this directory until one copy was made faithful.
//
// So fidelity lives here once. A case records what it cares about by reading the slice it wants off the
// returned object; nothing is per-spec except which slice it reads.
import { mockService } from '@apackdev/testing/harness'
import type { TerminalCellSize, TerminalColors, TerminalCommand, TerminalService, TerminalTarget, TerminalEvent, TerminalListeners, TerminalRewind, TerminalSession, TerminalSessionSummary, TerminalSignal, TerminalSignalScope } from '@apackdev/sdk/services'

/** The options the service was opened with, whole, so a case reads the field it is about */
export interface OpenOptions {
  cols: number
  rows: number
  shell?: string
  args?: readonly string[]
  env?: Record<string, string>
  unset?: readonly string[]
  cwd?: string
  colors?: TerminalColors
  record?: string
  restore?: boolean
  images?: boolean
  marksKey?: string
}

export interface OpenedSession {
  id: string
  /** The command of the target it was opened on, or `null` for this machine */
  target: readonly string[] | null
  pid: number
  options: OpenOptions
  /**
   * Whether the listeners arrived *with* the open, which is F8: there is no window in which output has
   * nowhere to go. A service that registered them afterwards hands this `false`.
   */
  listenersGivenAtOpen: boolean
  /** Whether the session was opened to be sent its bytes, which one a window draws is not */
  asksForBytes: boolean
}

export interface RecordingBroker {
  readonly opened: readonly OpenedSession[]
  /** Each resize, with the size of a cell where the caller gave one */
  readonly resized: ReadonlyArray<{ id: string; cols: number; rows: number; cell?: TerminalCellSize }>
  readonly written: ReadonlyArray<{ id: string; data: string }>
  /** The sessions `terminate()` was called on, in order */
  readonly terminated: readonly string[]
  /** `pause()` and `resume()` as they were called, in order, so a case reads the sequence and not a count */
  readonly flow: ReadonlyArray<{ id: string; kind: 'pause' | 'resume' }>
  /** The signals sent, with what each was aimed at */
  readonly signalled: ReadonlyArray<{ id: string; signal: TerminalSignal; scope: TerminalSignalScope }>
  /** The pids a session was asked about, in order */
  readonly askedOwns: ReadonlyArray<{ id: string; pid: number }>
  /** Says a pid is inside a session's tree, as a process it started would be */
  declareOwned(id: string, pid: number): void
  /**
   * Ends the shell under a session as the OS would.
   *
   * **The status is the whole of the decision**, because only the status says whether the user meant it:
   * `exit`, `logout` and Ctrl-D all end a shell with 0, and a segfault, an OOM kill and a failing `set -e`
   * script do not.
   */
  endShell(id: string, code: number | null, signal?: string | null): void
  /** The session's program did something that is not on its screen, which its holder is told as it happens */
  happens(id: string, event: TerminalEvent): void
  /** The sessions the broker still has: opened and not yet ended */
  readonly live: readonly string[]
  /** The sessions `adopt()` was asked for, in order, whether or not the broker still had them */
  readonly adopted: readonly string[]
  /** Refuses the nth open (1-based), as a broker that would not start */
  refuseOpen(nth: number, why?: string): void
  /** Makes every target unreachable, or reachable again: each ask of one is refused with `why` and counted */
  targetsUnreachable(why: string | undefined): void
  /** How many times a target was asked for anything while it could not be reached */
  readonly refusedByTarget: number
  /**
   * What the session's shell will report as its directory when asked.
   *
   * **The broker is the authority on the markers**, so this is where a reported directory comes from: it
   * reads the sequence out of the stream and answers `facts()` with what it read. A case drives the app's
   * half by emitting bytes that *say* a marker arrived and setting what the broker would then say — which
   * is the shape the real pair has, since the app never parses those bytes itself.
   */
  reportsCwd(id: string, cwd: string | null): void
  /** The session's shell reports that a command it started has ended */
  reportsCommandFinished(id: string): void
  /**
   * Refuses to end a session, as a broker that has gone or lost the socket does.
   *
   * **The refusal matters because no exit follows it.** A `terminate` that rejects ends nothing and
   * reports nothing, so whatever the service does about the terminal it is closing, it does without a
   * second chance — there is no later `onExit` to finish the job.
   */
  refuseTerminate(id: string, why?: string): void
  /**
   * Holds the **next** resize of that session until `settleResize`, as a broker a socket away does.
   *
   * **Every other call here answers in the same turn, which hides every ordering question.** A real resize
   * is a round trip, so two decisions about one pty — a window's fit, and a window going — are in flight
   * together and answer in whatever order the broker gets to them. What that costs when the app writes the
   * grid on the answer is a `cols`/`rows` that describes a size the pty is not running at.
   */
  deferResize(id: string): void
  /** Lets a held resize answer */
  settleResize(id: string): void
  /** The sessions asked to outlive the app, as `keep()` last left each */
  readonly kept: readonly string[]
  /** The commands a session's shell will be said to have run, and what each printed */
  reportsCommands(id: string, commands: ReadonlyArray<TerminalCommand & { output?: string }>): void
  /** The recordings opened to be looked back through, at the grid each was last drawn at, with every moment each was asked to show */
  readonly rewound: ReadonlyArray<{ id: string; recording: string; cols: number; rows: number; sought: number[]; closed: boolean }>
  /** Says a recording does not exist, so opening it is refused */
  refuseRewind(why?: string): void
}

/**
 * Installs the double. `pidBase` only keeps one spec's pids apart from another's in a failure message; no
 * behaviour reads a pid, which is the service's own rule — nothing addresses a session by it.
 */
export function recordingBroker({ pidBase = 1000 }: { pidBase?: number } = {}): RecordingBroker {
  const opened: OpenedSession[] = []
  const resized: Array<{ id: string; cols: number; rows: number; cell?: TerminalCellSize }> = []
  const written: Array<{ id: string; data: string }> = []
  const terminated: string[] = []
  const flow: Array<{ id: string; kind: 'pause' | 'resume' }> = []
  const signalled: Array<{ id: string; signal: TerminalSignal; scope: TerminalSignalScope }> = []
  const askedOwns: Array<{ id: string; pid: number }> = []
  const owned = new Map<string, Set<number>>()
  const listening = new Map<string, TerminalListeners>()
  const refusals = new Map<number, string>()
  const refusedTerminations = new Map<string, string>()
  const reportedCwds = new Map<string, string | null>()
  const finishedCommands = new Map<string, number>()
  /** Sessions whose next resize is held, and what releases each */
  const deferredResizes = new Map<string, () => void>()
  const heldResizes = new Map<string, Promise<void>>()
  const live = new Set<string>()
  const kept = new Set<string>()
  const commandsOf = new Map<string, ReadonlyArray<TerminalCommand & { output?: string }>>()
  const rewound: Array<{ id: string; recording: string; cols: number; rows: number; sought: number[]; closed: boolean }> = []
  let rewindRefusal: string | undefined
  let unreachable: string | undefined
  let refusedByTarget = 0
  /** Refuses as a target that cannot be reached does, where one cannot be and this is an ask of one */
  const reach = (target: readonly string[] | null): void => {
    if (target === null || unreachable === undefined) return
    refusedByTarget += 1
    throw new Error(unreachable)
  }
  const adopted: string[] = []
  let next = 0

  /**
   * One session handle for both routes, because what a holder may do with a session does not depend on how
   * it came to hold it — and because this file's own history is six copies that drifted.
   */
  const handle = (id: string, handlePid: number | null, target: readonly string[] | null = null, asked?: OpenOptions): TerminalSession => ({
    id,
    // As the broker answers: recorded where a recording was asked for, and unsaid for one taken up again
    recorded: asked === undefined ? null : asked.record !== undefined,
    restored: asked?.restore === true && asked.record !== undefined,
    // As the host names a target to a window: by a key made from its command
    target: target === null ? null : `key:${target.join(' ')}`,
    pid: handlePid,
    scrollback: 1000,
    write: async (data: string) => { written.push({ id, data }) },
    resize: async (cols: number, rows: number, cell?: TerminalCellSize) => {
      resized.push(cell ? { id, cols, rows, cell } : { id, cols, rows })
      const held = heldResizes.get(id)
      if (held === undefined) return
      heldResizes.delete(id)
      await held
    },
    facts: async () => ({
      cwd: reportedCwds.get(id) ?? null,
      command: null,
      running: false,
      outcome: null,
      finished: finishedCommands.get(id) ?? 0,
      vouched: false,
      refused: 0,
    }),
    pause: async () => { flow.push({ id, kind: 'pause' }) },
    resume: async () => { flow.push({ id, kind: 'resume' }) },
    // **Its own process is inside its tree**, which is the edge a walk gets wrong by starting a hop up;
    // anything else is one a case declared
    owns: async (pid: number) => {
      askedOwns.push({ id, pid })
      return pid === handlePid || (owned.get(id)?.has(pid) ?? false)
    },
    signal: async (signal, scope) => { signalled.push({ id, signal, scope }) },
    commands: async () => (commandsOf.get(id) ?? []).map(({ output: _output, ...command }) => command),
    commandOutput: async (command: number) => commandsOf.get(id)?.find(one => one.id === command)?.output ?? null,
    keep: async (keeping: boolean) => { if (keeping) kept.add(id); else kept.delete(id) },
    // **A signal, as the broker's kill is**, and a signal is not an exit code: `portable-pty` kills with
    // SIGHUP and the protocol reports that by name with no code at all. A double answering a number here
    // would let the service decide a close by reading the code — the one thing that cannot work, so a case
    // would pass while the app marked every closed terminal crashed
    terminate: async () => {
      const refusal = refusedTerminations.get(id)
      // Nothing is recorded and no exit is delivered: a refused kill ended nothing, and the caller has
      // only this rejection to act on
      if (refusal !== undefined) throw new Error(refusal)
      terminated.push(id)
      listening.get(id)?.onExit(null, 'SIGHUP')
    },
  })

  /** The service for one broker: this machine's, or the one a target's command reaches */
  const serviceFor = (target: readonly string[] | null): TerminalService => ({
    open: async (options: OpenOptions, listeners: TerminalListeners) => {
      reach(target)
      next += 1
      const refusal = refusals.get(next)
      if (refusal !== undefined) throw new Error(refusal)
      const id = `broker-${next}`
      const pid = pidBase + next
      listening.set(id, listeners)
      live.add(id)
      opened.push({
        id, target, pid, options,
        listenersGivenAtOpen: typeof listeners?.onEvent === 'function',
        asksForBytes: typeof listeners?.onOutput === 'function',
      })
      return handle(id, pid, target, options)
    },

    /**
     * Takes up a session the broker still has, as a restarted service does.
     *
     * **Refuses an id it does not know**, which is the case that matters: a full app restart ends every
     * session, so a stored id is stale far more often than not, and a double that answered for any id would
     * let the fall-back to a fresh shell go untested.
     */
    adopt: async (id: string, listeners: TerminalListeners) => {
      reach(target)
      adopted.push(id)
      if (!live.has(id)) throw new Error(`no session ${id}`)
      listening.set(id, listeners)
      // As the broker does: a pid is answered for a spawn and for nothing else
      return handle(id, null, target)
    },

    sessions: async (): Promise<TerminalSessionSummary[]> => (reach(target), [...live]).map(id => ({
      id, pid: opened.find(one => one.id === id)?.pid ?? 0, cols: 80, rows: 24, kept: kept.has(id), recorded: opened.find(one => one.id === id)?.options.record !== undefined,
      title: null, cwd: reportedCwds.get(id) ?? null, command: null, running: false,
    })),

    rewind: async (recording: string, size: { cols: number; rows: number }): Promise<TerminalRewind> => {
      if (rewindRefusal !== undefined) throw new Error(rewindRefusal)
      const entry = { id: `rewind-${rewound.length + 1}`, recording, ...size, sought: [] as number[], closed: false }
      rewound.push(entry)
      return {
        id: entry.id,
        first: 1_000,
        last: 9_000,
        // Held to what the recording covers, as the broker holds it
        seek: async (at: number) => { const shown = Math.min(9_000, Math.max(1_000, at)); entry.sought.push(shown); return shown },
        resize: async (cols: number, rows: number) => { entry.cols = cols; entry.rows = rows },
        close: async () => { entry.closed = true },
      }
    },
  
    at: (to: TerminalTarget) => serviceFor(to.command),
  })

  mockService('terminal', serviceFor(null))

  const listenersFor = (id: string): TerminalListeners => {
    const found = listening.get(id)
    if (!found) throw new Error(`no session ${id} was opened; these were: ${opened.map(o => o.id).join(', ') || 'none'}`)
    return found
  }
  return {
    opened, resized, written, terminated, adopted, flow, signalled, askedOwns, rewound,
    get kept() { return [...kept] },
    reportsCommands: (id, commands) => { commandsOf.set(id, commands) },
    refuseRewind: (why = 'there is no recording to look back through') => { rewindRefusal = why },
    declareOwned: (id, pid) => { owned.set(id, (owned.get(id) ?? new Set()).add(pid)) },
    get live() { return [...live] },
    endShell: (id, code, signal = null) => {
      // The broker forgets a session as it exits, which is what makes its id refuse an adoption afterwards
      live.delete(id)
      listenersFor(id).onExit(code, signal)
    },
    happens: (id, event) => listenersFor(id).onEvent?.(event),
    refuseOpen: (nth, why = 'the broker would not start') => { refusals.set(nth, why) },
    targetsUnreachable: (why) => { unreachable = why },
    get refusedByTarget() { return refusedByTarget },
    refuseTerminate: (id, why = 'the broker would not end the session') => { refusedTerminations.set(id, why) },
    reportsCwd: (id, cwd) => { reportedCwds.set(id, cwd) },
    // Both halves of the fact: what `facts()` answers afterwards, and the event that says it happened
    reportsCommandFinished: (id) => {
      finishedCommands.set(id, (finishedCommands.get(id) ?? 0) + 1)
      listenersFor(id).onEvent?.({ kind: 'commandFinished', outcome: { kind: 'exited', code: 0 } })
    },
    deferResize: (id) => {
      let release = () => {}
      heldResizes.set(id, new Promise<void>(resolve => { release = () => { resolve() } }))
      deferredResizes.set(id, release)
    },
    settleResize: (id) => {
      deferredResizes.get(id)?.()
      deferredResizes.delete(id)
    },
  }
}
