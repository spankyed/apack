import { ClaudeProtocolError } from './errors.ts'
import type { StreamLine } from './types.ts'

/** Snapshot pending native tasks per result; a later buffered notification must not change an earlier result. */
export function createBackgroundTaskTracker() {
  const active = new Set<string>()
  const results = new WeakMap<object, boolean>()
  return {
    observe(line: StreamLine): void {
      if (line.type === 'system') {
        const event = line as { subtype?: unknown; task_id?: unknown; status?: unknown }
        if (typeof event.task_id === 'string') {
          if (event.subtype === 'task_started') active.add(event.task_id)
          if (event.subtype === 'task_notification'
            && ['completed', 'failed', 'stopped'].includes(String(event.status))) active.delete(event.task_id)
        }
      }
      if (line.type === 'result') results.set(line, active.size > 0)
    },
    hasPendingTasks(result: StreamLine): boolean {
      const pending = results.get(result)
      if (pending === undefined) throw new ClaudeProtocolError('Expected a result emitted by this query')
      return pending
    },
  }
}
