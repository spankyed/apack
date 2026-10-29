import { setTimeout as delay } from 'node:timers/promises'
import * as agents from './agents.ts'
import { parseClaudeNativeContinuation, type ClaudeNativeContinuation } from './terminal-session.ts'
import type { SubcommandOptions } from './subcommand.ts'
import type { ClaudeBackgroundSession, ClaudeBackgroundSessionRequest } from '../../../common/native-background.ts'

/** Read only the child linked by the original parent's durable journal. */
export async function backgroundSession(
  continuation: ClaudeNativeContinuation,
  request: ClaudeBackgroundSessionRequest,
  options: SubcommandOptions = {},
): Promise<ClaudeBackgroundSession | undefined> {
  if (!parseClaudeNativeContinuation({ ...continuation, type: 'continued-in' }, continuation.sessionId)) throw new Error('Native continuation identity is invalid')
  const read = async (): Promise<ClaudeBackgroundSession | undefined> => {
    const rows = await agents.list({ ...options, all: true })
    const matches = rows.filter(row => row.kind === 'background' && row.sessionId === continuation.continuedInSessionId && row.id !== undefined)
    if (matches.length > 1) throw new Error('Native background identity is ambiguous')
    const row = matches[0]
    if (!row || row.kind !== 'background' || row.id === undefined || row.state === undefined) return
    return { id: row.id, sessionId: continuation.continuedInSessionId, cwd: row.cwd, state: row.state,
      ...(row.pid !== undefined ? { pid: row.pid } : {}), ...(row.name ? { name: row.name } : {}),
      ...(row.status ? { status: row.status } : {}), ...(row.waitingFor ? { waitingFor: row.waitingFor } : {}) }
  }
  let current = await read()
  // Native persists the fork before its worker registers; bound that observed startup gap.
  if (request.operation === 'refresh') {
    for (let attempt = 0; attempt < 3 && current?.state === 'working' && current.pid === undefined; attempt++) {
      await delay(250, undefined, options.signal ? { signal: options.signal } : undefined)
      current = await read()
    }
    return current
  }
  if (!current || current.id !== request.id || !Number.isSafeInteger(request.pid) || request.pid <= 1 || current.pid !== request.pid
    || !['working', 'blocked'].includes(current.state)) throw new Error('Background session changed; refresh before stopping it')
  await agents.stop(current.id, options)
  const stopped = await read()
  if (stopped?.state !== 'stopped') throw new Error('Native background Stop has not been confirmed; refresh its status')
  return stopped
}
