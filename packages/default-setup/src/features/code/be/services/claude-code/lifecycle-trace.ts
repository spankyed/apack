import { randomUUID } from 'node:crypto'
import { createLogger } from '@apackdev/sdk/logger'

const logger = createLogger('claude-lifecycle')
type LifecycleEvent = 'launch' | 'ready' | 'cancel_requested' | 'exit' | 'turn_start' | 'turn_end' | 'reset' | 'control_start' | 'control_end' | 'handoff_start' | 'handoff_end' | 'reconciliation'
interface TraceFacts { outcome?: 'ok' | 'error' | 'timeout' | 'cancelled' | 'closed' | 'missing_suffix' | 'conflict'; pid?: number; code?: number; count?: number; discardedBytes?: number }

/** Opaque correlation and fixed fields only; callers cannot serialize conversation payloads. */
export function createClaudeLifecycleTrace(kind: 'print' | 'terminal' | 'conversation' | 'control' | 'handoff', sink = (facts: Record<string, unknown>) => logger.debug('lifecycle', facts), pid?: number) {
  const owner = randomUUID(), started = performance.now()
  let finished = false
  return (event: LifecycleEvent, facts: TraceFacts = {}) => {
    if (finished) return
    if (event === 'exit') finished = true
    const value: Record<string, unknown> = {kind, owner, event, ...(Number.isSafeInteger(pid) ? {pid} : {}), elapsedMs: Math.round(performance.now()-started)}
    if (facts.outcome && ['ok','error','timeout','cancelled','closed','missing_suffix','conflict'].includes(facts.outcome)) value.outcome = facts.outcome
    for (const key of ['pid','code','count','discardedBytes'] as const) if (Number.isSafeInteger(facts[key])) value[key] = facts[key]
    try {sink(value)} catch { /* logging never controls process lifetime */ }
  }
}
