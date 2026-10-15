import { query } from './query.ts'
import { ClaudeProtocolError } from './errors.ts'
import type { QueryOptions } from './types.ts'

export interface ClaudeSessionRenameOptions extends Pick<QueryOptions, 'env' | 'cliPath' | 'signal'> {
  sessionId: string
  title: string
  cwd: string
}

/** Let the CLI own title persistence; never append guessed metadata to a transcript. */
export async function renameSession(options: ClaudeSessionRenameOptions): Promise<void> {
  const allowed = new Set(['sessionId', 'title', 'cwd', 'env', 'cliPath', 'signal'])
  if (Object.keys(options).some(key => !allowed.has(key))) throw new ClaudeProtocolError('unsupported rename options')
  const { sessionId, title, cwd, env, cliPath, signal } = options
  if (!sessionId.trim() || !title.trim()) throw new ClaudeProtocolError('sessionId and title are required')
  const handle = await query({ cwd, env, cliPath, signal, resume: sessionId, keepStdinOpen: true })
  try { await handle.renameSession(title, sessionId) }
  finally { await handle.close() }
}

export interface ClaudeSessionResumeTargetOptions extends Pick<QueryOptions, 'env' | 'cliPath' | 'signal'> {
  sessionId: string
  messageUuid: string
  cwd: string
}

/** Validate native active history without a user turn or a persisted fork. */
export async function validateSessionResumeTarget(options: ClaudeSessionResumeTargetOptions): Promise<void> {
  const allowed = new Set(['sessionId', 'messageUuid', 'cwd', 'env', 'cliPath', 'signal'])
  if (Object.keys(options).some(key => !allowed.has(key))) throw new ClaudeProtocolError('unsupported resume target options')
  const { sessionId, messageUuid, cwd, env, cliPath, signal } = options
  if (!sessionId.trim() || !messageUuid.trim()) throw new ClaudeProtocolError('sessionId and messageUuid are required')
  const handle = await query({ cwd, env, cliPath, signal, resume: sessionId, forkSession: true,
    resumeSessionAt: messageUuid, noSessionPersistence: true, keepStdinOpen: true })
  try { await handle.initialized }
  finally { await handle.close() }
}
