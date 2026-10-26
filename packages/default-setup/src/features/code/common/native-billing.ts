import { z } from 'zod'

/** Native observations describe a completed request, never a promise about the next bill. */
export const ClaudeRateLimitInfoSchema = z.object({
  status: z.string().max(128).nullish(),
  rateLimitType: z.string().max(128).nullish(),
  resetsAt: z.number().finite().nonnegative().max(8640000000000).nullish(),
  isUsingOverage: z.boolean().nullish(),
  overageStatus: z.string().max(128).nullish(),
  overageDisabledReason: z.string().max(256).nullish(),
}).passthrough()
export type ClaudeRateLimitInfo = z.infer<typeof ClaudeRateLimitInfoSchema>
export interface ClaudeBillingObservation {
  sessionId: string
  observedAt: number
  info: Pick<ClaudeRateLimitInfo, 'status' | 'rateLimitType' | 'resetsAt' | 'isUsingOverage' | 'overageStatus' | 'overageDisabledReason'>
}

/** Keep a single sanitized observation; an owner never follows another session implicitly. */
export function createClaudeBillingState() {
  let minimumObservedAt = -1
  let sessionId: string | undefined, observation: ClaudeBillingObservation | undefined
  return {
    get value() { return observation },
    reset(id?: string, after = -1) { if (id !== sessionId) { sessionId = id; observation = undefined; minimumObservedAt = after } },
    observe(id: string, value: unknown, at = Date.now()) {
      const parsed = ClaudeRateLimitInfoSchema.safeParse(value)
      if (!sessionId || id !== sessionId || !parsed.success || !Number.isFinite(at) || at < 0 || at <= minimumObservedAt || observation && at < observation.observedAt) return false
      const { status, rateLimitType, resetsAt, isUsingOverage, overageStatus, overageDisabledReason } = parsed.data
      observation = {sessionId: id, observedAt: at, info: {status, rateLimitType, resetsAt, isUsingOverage, overageStatus, overageDisabledReason}}
      return true
    },
  }
}

export function claudeBillingText(value?: ClaudeBillingObservation): string {
  if (!value) return 'Billing status unknown · no native observation'
  const {info} = value
  const status = info.status === 'allowed' ? 'Usage allowed' : info.status === 'allowed_warning' ? 'Usage limit warning' : info.status === 'rejected' ? 'Usage limit reached' : 'Usage status unknown'
  const route = info.isUsingOverage === true ? 'Usage credits charged on the reported request' : info.isUsingOverage === false ? 'No usage-credit charge reported' : 'Billing route unknown'
  const reset = info.resetsAt == null ? '' : ` · Resets ${new Date(info.resetsAt * 1000).toISOString()}`
  return `${status} · ${route}${reset}`
}
