// The reads a window has running whose answer it no longer takes. The commit panel takes only the answer to its latest
// blame and its latest page of history (`answersCall`), so an earlier one still running is git working for nobody: a
// blame of a large file, or a file's history walked back through every commit. A window asking again stops its earlier
// read of that kind, and a window going stops all of its.
import { onConnectionEnded } from '@apackdev/sdk/events';

/** What a window reads of which only the latest ask is taken */
export type WindowRead = 'blame' | 'history'

/** The running reads, by the connection that asked and then by kind */
const running = new Map<string, Map<WindowRead, AbortController>>()

/**
 * A read for the window on `client`, stopping the one of this kind it asked for before. `signal` stops this one in
 * turn, and `done` lets it go once answered. An ask no window made (`client` absent) stops nothing and cannot be stopped
 */
export function windowRead(client: string | undefined, kind: WindowRead): { signal?: AbortSignal; done: () => void } {
  if (!client) return { done: () => {} }
  const reads = running.get(client) ?? new Map<WindowRead, AbortController>()
  running.set(client, reads)
  reads.get(kind)?.abort()
  const controller = new AbortController()
  reads.set(kind, controller)
  return {
    signal: controller.signal,
    done: () => {
      if (reads.get(kind) !== controller) return
      reads.delete(kind)
      if (reads.size === 0 && running.get(client) === reads) running.delete(client)
    },
  }
}

/** Stops every read the window on `client` has running */
export function stopWindowReads(client: string): void {
  for (const controller of running.get(client)?.values() ?? []) controller.abort()
  running.delete(client)
}

/**
 * Follows connections ending, so a window that goes stops its reads. Taken from `boot.onInit`, since it reads the bound
 * app, and disposed from `boot.onShutdown`
 */
export function startStoppingWindowReads(): () => void {
  return onConnectionEnded(stopWindowReads)
}
