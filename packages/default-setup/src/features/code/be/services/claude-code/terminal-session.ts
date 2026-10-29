import { PermissionModeSchema, type PermissionMode } from './types.ts'
export interface ClaudeNativeSessionMetadata {
  cwd: string
  model: string
  modelSelection?: string
  turns: number
  startedAt: number
  totalCostUsd?: number
  permissionMode?: PermissionMode
  prePlanMode?: PermissionMode
}
export interface ClaudeNativeTerminalRecord {
  sessionId: string
  uuid: string
  door: string
  origin: Record<string, unknown>
  message: { type: 'user' | 'assistant' | 'system' | 'attachment'; role?: 'user' | 'assistant'; isMeta?: true; content: { type: string; [key: string]: unknown }[] }
}
export interface ClaudeNativeImage { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string }
export interface ClaudeNativeSubmissionReceipt { sessionId: string; uuid: string; text: string }
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
export function parseClaudeTerminalMetadata(value: unknown): ClaudeNativeSessionMetadata | undefined {
  const entry = object(value)
  if (!entry || typeof entry.cwd !== 'string' || !entry.cwd || entry.cwd.length > 16384 || typeof entry.model !== 'string' || entry.model.length > 256
        || (entry.modelSelection !== undefined && (typeof entry.modelSelection !== 'string' || !entry.modelSelection || entry.modelSelection.length > 256))
        || !Number.isSafeInteger(entry.turns) || (entry.turns as number) < 0 || typeof entry.startedAt !== 'number' || !Number.isFinite(entry.startedAt) || entry.startedAt < 0
        || (entry.totalCostUsd !== undefined && (typeof entry.totalCostUsd !== 'number' || !Number.isFinite(entry.totalCostUsd) || entry.totalCostUsd < 0))) return
  return { cwd: entry.cwd, model: entry.model, ...(typeof entry.modelSelection === 'string' ? { modelSelection: entry.modelSelection } : {}), turns: entry.turns as number, startedAt: entry.startedAt, ...(entry.totalCostUsd !== undefined ? { totalCostUsd: entry.totalCostUsd as number } : {}), ...(PermissionModeSchema.safeParse(entry.permissionMode).success ? { permissionMode: entry.permissionMode as PermissionMode } : {}), ...(entry.permissionMode === 'plan' && entry.prePlanMode !== 'plan' && PermissionModeSchema.safeParse(entry.prePlanMode).success ? { prePlanMode: entry.prePlanMode as PermissionMode } : {}) }
}
/** Native append ids are durable row identities, not turn ids or app message ids. */
export function createClaudeTerminalSession(sessionId: string) {
  let current = sessionId, metadata: ClaudeNativeSessionMetadata | undefined, sequence = 0, bytes = 0
  const records: { sequence: number; record: ClaudeNativeTerminalRecord; bytes: number }[] = []
  return {
    get metadata() { return metadata },
    get records(): readonly { sequence: number; record: ClaudeNativeTerminalRecord }[] { return records },
    reset(id: string) { if (id !== current) { current = id; metadata = undefined; records.length = 0; bytes = 0 } },
    update(value: unknown): boolean {
      const next = parseClaudeTerminalMetadata(value)
      if (!next) return false
      metadata = { ...next, ...(next.permissionMode === undefined && metadata?.permissionMode ? { permissionMode: metadata.permissionMode, prePlanMode: metadata.prePlanMode } : {}) }
      return true
    },
    append(value: unknown): ClaudeNativeTerminalRecord | undefined {
      const entry = object(value), message = object(entry?.message), origin = object(entry?.origin)
      if (!entry || entry.sessionId !== current || entry.agentId !== undefined || typeof entry.uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(entry.uuid)
        || typeof entry.door !== 'string' || entry.door.length > 64 || !origin || typeof origin.kind !== 'string' || !message
        || !['user','assistant','system','attachment'].includes(String(message.type)) || !Array.isArray(message.content)
        || !message.content.every(block => object(block) && typeof block.type === 'string')) return
      const record: ClaudeNativeTerminalRecord = { sessionId: current, uuid: entry.uuid, door: entry.door, origin,
        message: { type: message.type as ClaudeNativeTerminalRecord['message']['type'], ...(message.role === 'user' || message.role === 'assistant' ? { role: message.role } : {}), ...(message.isMeta === true ? { isMeta: true } : {}), content: message.content } }
      const size = Buffer.byteLength(JSON.stringify(record))
      if (size > 8 * 1024 * 1024) return
      const previous = records.findIndex(row => row.record.uuid === record.uuid)
      if (previous !== -1) { bytes -= records[previous]!.bytes; records.splice(previous, 1) }
      records.push({ sequence: ++sequence, record, bytes: size }); bytes += size
      while (records.length > 1 && (records.length > 256 || bytes > 8 * 1024 * 1024)) bytes -= records.shift()!.bytes
      return record
    },
  }
}

export interface ClaudeNativeContinuation {
  sessionId: string
  continuedInSessionId: string
  timestamp: string
}

/** A native journal link identifies a new session without retargeting the original owner. */
export function parseClaudeNativeContinuation(value: unknown, sessionId: string): ClaudeNativeContinuation | undefined {
  const entry = object(value)
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu
  if (!uuid.test(sessionId) || entry?.type !== 'continued-in' || entry.sessionId !== sessionId
    || typeof entry.continuedInSessionId !== 'string' || !uuid.test(entry.continuedInSessionId)
    || entry.continuedInSessionId.toLowerCase() === sessionId.toLowerCase()
    || typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) return
  return { sessionId, continuedInSessionId: entry.continuedInSessionId, timestamp: entry.timestamp }
}
