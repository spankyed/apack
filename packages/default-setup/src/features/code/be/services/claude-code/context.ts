import { query } from './query.ts'
import { ClaudeProtocolError } from './errors.ts'
import type { QueryOptions } from './types.ts'
import type { ClaudeContextUsage } from './host-controls.ts'

export interface ClaudeSessionContextOptions extends Pick<QueryOptions, 'env' | 'cliPath' | 'signal'> {
  sessionId: string
  cwd: string
}

/** Read persisted session context without sending a user turn or changing its transcript. */
export async function getSessionContextUsage(options: ClaudeSessionContextOptions): Promise<ClaudeContextUsage> {
  const allowed = new Set(['sessionId', 'cwd', 'env', 'cliPath', 'signal'])
  const unsupported = Object.keys(options).filter(key => !allowed.has(key))
  if (unsupported.length) throw new ClaudeProtocolError(`unsupported context options: ${unsupported.join(', ')}`)
  const { sessionId, cwd, env, cliPath, signal } = options
  if (!sessionId.trim()) throw new ClaudeProtocolError('sessionId is required for context usage')
  const handle = await query({ cwd, env, cliPath, signal, resume: sessionId,
    keepStdinOpen: true, noSessionPersistence: true })
  try {
    return await handle.getContextUsage()
  } finally {
    await handle.close()
  }
}
