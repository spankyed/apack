import { query } from './query.ts'
import { ClaudeProtocolError } from './errors.ts'
import type { QueryOptions } from './types.ts'
import type { ClaudePlan } from './host-controls.ts'

export interface ClaudeSessionPlanOptions extends Pick<QueryOptions, 'env' | 'cliPath' | 'signal'> {
  sessionId: string
  cwd: string
}

/** Read the native saved plan without sending a prompt or persisting resumed history. */
export async function getSessionPlan(options: ClaudeSessionPlanOptions): Promise<ClaudePlan> {
  const allowed = new Set(['sessionId', 'cwd', 'env', 'cliPath', 'signal'])
  const unsupported = Object.keys(options).filter(key => !allowed.has(key))
  if (unsupported.length) throw new ClaudeProtocolError(`unsupported plan options: ${unsupported.join(', ')}`)
  if (!options.sessionId.trim()) throw new ClaudeProtocolError('sessionId is required for plan lookup')
  const { sessionId, cwd, env, cliPath, signal } = options
  const handle = await query({ cwd, env, cliPath, signal, resume: sessionId,
    keepStdinOpen: true, noSessionPersistence: true })
  try { return await handle.getPlan() }
  finally { await handle.close() }
}
