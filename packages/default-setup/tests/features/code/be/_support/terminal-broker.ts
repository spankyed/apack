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
import type { TerminalListeners } from '@apackdev/sdk/services'

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
  /**
   * Ends the shell under a session as the OS would.
   *
   * **The status is the whole of the decision**, because only the status says whether the user meant it:
   * `exit`, `logout` and Ctrl-D all end a shell with 0, and a segfault, an OOM kill and a failing `set -e`
   * script do not.
   */
  endShell(id: string, code: number | null): void
  /** Bytes arriving from a session's shell */
  emit(id: string, data: string): void
  /** Refuses the nth open (1-based), as a broker that would not start */
  refuseOpen(nth: number, why?: string): void
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
  const listening = new Map<string, TerminalListeners>()
  const refusals = new Map<number, string>()
  const refusedTerminations = new Map<string, string>()
  let next = 0

  mockService('terminal', {
    open: async (options: OpenOptions, listeners: TerminalListeners) => {
      next += 1
      const refusal = refusals.get(next)
      if (refusal !== undefined) throw new Error(refusal)
      const id = `broker-${next}`
      const pid = pidBase + next
      listening.set(id, listeners)
      opened.push({ id, pid, options, listenersGivenAtOpen: typeof listeners?.onOutput === 'function' })
      return {
        id,
        pid,
        write: async (data: string) => { written.push({ id, data }) },
        resize: async (cols: number, rows: number) => { resized.push({ id, cols, rows }) },
        // A signal, as the broker's kill is. A double exiting 0 here would let the service decide a close
        // by reading the code — which is the one thing that cannot work, so a case would pass while the app
        // marked every closed terminal crashed
        terminate: async () => {
          const refusal = refusedTerminations.get(id)
          // Nothing is recorded and no exit is delivered: a refused kill ended nothing, and the caller has
          // only this rejection to act on
          if (refusal !== undefined) throw new Error(refusal)
          terminated.push(id)
          listening.get(id)?.onExit(1)
        },
      }
    },
  })

  const listenersFor = (id: string): TerminalListeners => {
    const found = listening.get(id)
    if (!found) throw new Error(`no session ${id} was opened; these were: ${opened.map(o => o.id).join(', ') || 'none'}`)
    return found
  }
  return {
    opened, resized, written, terminated,
    endShell: (id, code) => listenersFor(id).onExit(code),
    emit: (id, data) => listenersFor(id).onOutput(data),
    refuseOpen: (nth, why = 'the broker would not start') => { refusals.set(nth, why) },
    refuseTerminate: (id, why = 'the broker would not end the session') => { refusedTerminations.set(id, why) },
  }
}
