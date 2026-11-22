import type { UntypedAskOutcome } from '@apackdev/sdk/events'

/** What an ask was answered with; a refusal is thrown, saying of what kind it was and why */
export function answered<T>(outcome: UntypedAskOutcome): T {
  if (!outcome.ok) throw new Error(`Refused (${outcome.failure.kind}): ${outcome.failure.message}`)
  return outcome.value as T
}
