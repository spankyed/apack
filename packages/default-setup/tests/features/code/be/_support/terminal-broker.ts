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
import type { TerminalListeners, TerminalSession, TerminalSignal, TerminalSignalScope } from '@apackdev/sdk/services'

/** The options the service was opened with, whole, so a case reads the field it is about */
export interface OpenOptions {
  cols: number
  rows: number
  shell?: string
  args?: readonly string[]
  env?: Record<string, string>
  cwd?: string
}

export interface OpenedSession {
  id: string
  pid: number
  options: OpenOptions
  /**
   * Whether the listeners arrived *with* the open, which is F8: there is no window in which output has
   * nowhere to go. A service that registered them afterwards hands this `false`.
   */
  listenersGivenAtOpen: boolean
}

export interface RecordingBroker {
  readonly opened: readonly OpenedSession[]
  readonly resized: ReadonlyArray<{ id: string; cols: number; rows: number }>
  readonly written: ReadonlyArray<{ id: string; data: string }>
  /** The sessions `terminate()` was called on, in order */
  readonly terminated: readonly string[]
  /** `pause()` and `resume()` as they were called, in order, so a case reads the sequence and not a count */
  readonly flow: ReadonlyArray<{ id: string; kind: 'pause' | 'resume' }>
  /** The signals sent, with what each was aimed at */
  readonly signalled: ReadonlyArray<{ id: string; signal: TerminalSignal; scope: TerminalSignalScope }>
  /**
   * Ends the shell under a session as the OS would.
   *
   * **The status is the whole of the decision**, because only the status says whether the user meant it:
   * `exit`, `logout` and Ctrl-D all end a shell with 0, and a segfault, an OOM kill and a failing `set -e`
   * script do not.
   */
  endShell(id: string, code: number | null, signal?: string | null): void
  /** Bytes arriving from a session's shell */
  emit(id: string, data: string): void
  /** The sessions the broker still has: opened and not yet ended */
  readonly live: readonly string[]
  /** The sessions `adopt()` was asked for, in order, whether or not the broker still had them */
  readonly adopted: readonly string[]
  /** Refuses the nth open (1-based), as a broker that would not start */
  refuseOpen(nth: number, why?: string): void
  /**
   * What the session's shell will report as its directory when asked.
   *
   * **The broker is the authority on the markers**, so this is where a reported directory comes from: it
   * reads the sequence out of the stream and answers `facts()` with what it read. A case drives the app's
   * half by emitting bytes that *say* a marker arrived and setting what the broker would then say — which
   * is the shape the real pair has, since the app never parses those bytes itself.
   */
  reportsCwd(id: string, cwd: string | null): void
  /**
   * Refuses to end a session, as a broker that has gone or lost the socket does.
   *
   * **The refusal matters because no exit follows it.** A `terminate` that rejects ends nothing and
   * reports nothing, so whatever the service does about the terminal it is closing, it does without a
   * second chance — there is no later `onExit` to finish the job.
   */
  refuseTerminate(id: string, why?: string): void
}

/**
 * Installs the double. `pidBase` only keeps one spec's pids apart from another's in a failure message; no
 * behaviour reads a pid, which is the service's own rule — nothing addresses a session by it.
 */
export function recordingBroker({ pidBase = 1000 }: { pidBase?: number } = {}): RecordingBroker {
  const opened: OpenedSession[] = []
  const resized: Array<{ id: string; cols: number; rows: number }> = []
  const written: Array<{ id: string; data: string }> = []
  const terminated: string[] = []
  const flow: Array<{ id: string; kind: 'pause' | 'resume' }> = []
  const signalled: Array<{ id: string; signal: TerminalSignal; scope: TerminalSignalScope }> = []
  const listening = new Map<string, TerminalListeners>()
  const refusals = new Map<number, string>()
  const refusedTerminations = new Map<string, string>()
  const reportedCwds = new Map<string, string | null>()
  const live = new Set<string>()
  const adopted: string[] = []
  let next = 0

  /**
   * One session handle for both routes, because what a holder may do with a session does not depend on how
   * it came to hold it — and because this file's own history is six copies that drifted.
   */
  const handle = (id: string, pid: number | null): TerminalSession => ({
    id,
    pid,
    scrollback: 1000,
    write: async (data: string) => { written.push({ id, data }) },
    resize: async (cols: number, rows: number) => { resized.push({ id, cols, rows }) },
    facts: async () => ({
      cwd: reportedCwds.get(id) ?? null,
      command: null,
      running: false,
      exitStatus: null,
    }),
    pause: async () => { flow.push({ id, kind: 'pause' }) },
    resume: async () => { flow.push({ id, kind: 'resume' }) },
    signal: async (signal, scope) => { signalled.push({ id, signal, scope }) },
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

  mockService('terminal', {
    open: async (options: OpenOptions, listeners: TerminalListeners) => {
      next += 1
      const refusal = refusals.get(next)
      if (refusal !== undefined) throw new Error(refusal)
      const id = `broker-${next}`
      const pid = pidBase + next
      listening.set(id, listeners)
      live.add(id)
      opened.push({ id, pid, options, listenersGivenAtOpen: typeof listeners?.onOutput === 'function' })
      return handle(id, pid)
    },

    /**
     * Takes up a session the broker still has, as a restarted service does.
     *
     * **Refuses an id it does not know**, which is the case that matters: a full app restart ends every
     * session, so a stored id is stale far more often than not, and a double that answered for any id would
     * let the fall-back to a fresh shell go untested.
     */
    adopt: async (id: string, listeners: TerminalListeners) => {
      adopted.push(id)
      if (!live.has(id)) throw new Error(`no session ${id}`)
      listening.set(id, listeners)
      // As the broker does: a pid is answered for a spawn and for nothing else
      return handle(id, null)
    },
  })

  const listenersFor = (id: string): TerminalListeners => {
    const found = listening.get(id)
    if (!found) throw new Error(`no session ${id} was opened; these were: ${opened.map(o => o.id).join(', ') || 'none'}`)
    return found
  }
  return {
    opened, resized, written, terminated, adopted, flow, signalled,
    get live() { return [...live] },
    endShell: (id, code, signal = null) => {
      // The broker forgets a session as it exits, which is what makes its id refuse an adoption afterwards
      live.delete(id)
      listenersFor(id).onExit(code, signal)
    },
    emit: (id, data) => listenersFor(id).onOutput(data),
    refuseOpen: (nth, why = 'the broker would not start') => { refusals.set(nth, why) },
    refuseTerminate: (id, why = 'the broker would not end the session') => { refusedTerminations.set(id, why) },
    reportsCwd: (id, cwd) => { reportedCwds.set(id, cwd) },
  }
}
