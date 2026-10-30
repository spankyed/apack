import { randomUUID } from 'node:crypto'
import type { ClaudeBackgroundStatus } from '../../../common/native-background.ts'
export interface ClaudeBackgroundStatusIdentity { jobId: string; sessionId: string; pid: number; start: string; hostPid: number; hostStart: string; cwd: string }
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
/** One child lease per parent; every write revalidates the original process incarnation. */
export function createClaudeBackgroundStatus(options: {
  identify(sessionId: string, pid: number): Promise<ClaudeBackgroundStatusIdentity>
  changed(): void
  now?(): number
}) {
  const now = options.now ?? Date.now
  let closed = false, generation = 0
  let lease: { token: string; identity: ClaudeBackgroundStatusIdentity; sequence: number; info?: ClaudeBackgroundStatus } | undefined
  return {
    async register(sessionId: string, pid: number) {
      if (closed || !Number.isSafeInteger(pid) || pid <= 1) throw new Error('Background status owner unavailable')
      const epoch = generation, identity = await options.identify(sessionId, pid)
      if (closed || generation !== epoch || identity.sessionId !== sessionId || identity.pid !== pid) throw new Error('Background status registration expired')
      // Repeated registration cannot retire an in-flight lease for the same original process.
      if (lease && JSON.stringify(lease.identity) === JSON.stringify(identity)) return { token: lease.token }
      lease = { token: randomUUID(), identity, sequence: 0 }; generation++; options.changed()
      return { token: lease.token }
    },
    async accept(value: Record<string, unknown>) {
      const current = lease
      if (closed || !current || value.sessionId !== current.identity.sessionId || value.pid !== current.identity.pid || value.token !== current.token || !count(value.sequence) || value.sequence <= current.sequence) throw new Error('Background status lease expired')
      const metadata = object(value.metadata), usage = object(value.usage), context = object(usage?.context), cost = object(usage?.cost)
      if (!metadata || typeof metadata.model !== 'string' || !metadata.model || metadata.model.length > 256 || !count(metadata.turns) || !usage || !amount(usage.startedAt)
        || usage.context !== undefined && (!context || !count(context.tokens) || !count(context.window) || !amount(context.percent))
        || usage.cost !== undefined && (!cost || !amount(cost.usd))) throw new Error('Invalid original background status')
      const identity = await options.identify(current.identity.sessionId, current.identity.pid)
      if (closed || lease !== current || value.sequence <= current.sequence || JSON.stringify(identity) !== JSON.stringify(current.identity)) throw new Error('Background status worker replaced')
      current.sequence = value.sequence
      current.info = { jobId: identity.jobId, sessionId: identity.sessionId, pid: identity.pid, observedAt: now(), model: metadata.model, turns: metadata.turns, startedAt: usage.startedAt,
        ...(context ? { context: { tokens: context.tokens as number, window: context.window as number, percent: context.percent as number } } : {}), ...(cost ? { totalCostUsd: cost.usd as number } : {}) }
      options.changed()
    },
    get value(): ClaudeBackgroundStatus | undefined { const info = lease?.info; return !closed && info && now() - info.observedAt <= 5000 ? info : undefined },
    close() { closed = true; generation++; lease = undefined },
  }
}
