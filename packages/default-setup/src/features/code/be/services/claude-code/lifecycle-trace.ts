import { randomUUID } from 'node:crypto'
import { createLogger } from '@apackdev/sdk/logger'
import { NATIVE_NOTIFICATION_ROUTES, type NativeNotificationRoute } from './native-plugin/program.ts'

const logger = createLogger('claude-lifecycle')
type LifecycleEvent = 'launch' | 'ready' | 'cancel_requested' | 'exit' | 'turn_start' | 'turn_end' | 'reset' | 'control_start' | 'control_end' | 'handoff_start' | 'handoff_end' | 'reconciliation' | 'notifications_dropped'
// `route` is the one string a caller may pass, and only one of the plugin's five: a notification that did
// not arrive is reported by name and count, which is what makes the plugin's drops readable rather than
// swallowed. It is held to that closed set here for the same reason `outcome` is.
interface TraceFacts { outcome?: 'ok' | 'error' | 'timeout' | 'cancelled' | 'closed' | 'missing_suffix' | 'conflict'; route?: NativeNotificationRoute; pid?: number; code?: number; count?: number; discardedBytes?: number }

/** Opaque correlation and fixed fields only; callers cannot serialize conversation payloads. */
export function createClaudeLifecycleTrace(kind: 'print' | 'terminal' | 'conversation' | 'control' | 'handoff', sink = (facts: Record<string, unknown>) => logger.debug('lifecycle', facts), pid?: number) {
  const owner = randomUUID(), started = performance.now()
  let finished = false
  return (event: LifecycleEvent, facts: TraceFacts = {}) => {
    if (finished) return
    if (event === 'exit') finished = true
    const value: Record<string, unknown> = {kind, owner, event, ...(Number.isSafeInteger(pid) ? {pid} : {}), elapsedMs: Math.round(performance.now()-started)}
    if (facts.outcome && ['ok','error','timeout','cancelled','closed','missing_suffix','conflict'].includes(facts.outcome)) value.outcome = facts.outcome
    if (facts.route && (NATIVE_NOTIFICATION_ROUTES as readonly string[]).includes(facts.route)) value.route = facts.route
    for (const key of ['pid','code','count','discardedBytes'] as const) if (Number.isSafeInteger(facts[key])) value[key] = facts[key]
    try {sink(value)} catch { /* logging never controls process lifetime */ }
  }
}
