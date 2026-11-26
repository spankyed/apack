import { ClaudeProtocolError } from './errors.ts'
import type { StreamLine } from './types.ts'

export interface ClaudeNestedAccounting {
  toolCallCount: number
  mutatedPaths: string[]
  hadErrors: boolean
}
export interface ClaudeNestedActivity {
  /** Bind an observed root tool to its existing app activity, for this process lifetime. */
  register(rootToolId: string, receive: (event: StreamLine) => void): void
  /** Drain facts once, at the next native result; output bindings remain registered. */
  takeAccounting(): ClaudeNestedAccounting
}

const LIMIT = 4096
const MUTATIONS = new Set(['Write', 'Edit', 'NotebookEdit'])
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Process-owned routing. Nested frames never establish a parent transcript turn. */
export function createClaudeNestedActivity() {
  const roots = new Map<string, (event: StreamLine) => void>()
  const descendants = new Map<string, string>()
  const messages = new Set<string>()
  const taskKey = (line: Record<string, unknown>) => JSON.stringify([line.session_id, line.task_id, line.run_id ?? null])
  const tasks = new Map<string, { parent: string; session: string; run?: string; reported: boolean }>()
  let waiting: Array<{ event: StreamLine; bytes: number }> = []
  let waitingBytes = 0
  let closed = false
  let toolCallCount = 0
  const paths = new Set<string>()
  let hadErrors = false

  function bounded(size: number): void {
    if (size >= LIMIT) throw new ClaudeProtocolError('nested Claude activity exceeded its identity limit')
  }
  function deliver(event: StreamLine): boolean {
    const line = event as Record<string, unknown>
    const task = line.type === 'system' && line.subtype === 'task_notification' && typeof line.task_id === 'string' ? tasks.get(taskKey(line)) : undefined
    if (task?.reported) return true
    const parent = task?.parent ?? String(line.parent_tool_use_id)
    const root = descendants.get(parent) ?? parent
    const receive = roots.get(root)
    if (!receive) return false
    const uuid = typeof line.uuid === 'string' ? line.uuid : undefined
    if (uuid && messages.has(uuid)) return true
    if (uuid) { bounded(messages.size); messages.add(uuid) }
    const content = record(line.message)?.content
    if (Array.isArray(content)) for (const value of content) {
      const block = record(value)
      if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        if (!descendants.has(block.id)) {
          bounded(descendants.size)
          descendants.set(block.id, root)
          toolCallCount++
        }
        const input = record(block.input)
        const path = input?.file_path ?? input?.path
        if (MUTATIONS.has(block.name) && typeof path === 'string' && !paths.has(path)) {
          bounded(paths.size); paths.add(path)
        }
      } else if (block?.type === 'tool_result' && block.is_error === true) hadErrors = true
    }
    receive(event)
    if (task) task.reported = true
    return true
  }
  function replay(): void {
    // A descendant can arrive before its parent's completed assistant frame.
    let progressed = true
    while (progressed) {
      progressed = false
      const retained: typeof waiting = []
      for (const entry of waiting) {
        if (deliver(entry.event)) { waitingBytes -= entry.bytes; progressed = true }
        else retained.push(entry)
      }
      waiting = retained
    }
  }
  return {
    register(rootToolId: string, receive: (event: StreamLine) => void): void {
      if (closed || !rootToolId || roots.has(rootToolId)) return
      bounded(roots.size)
      roots.set(rootToolId, receive)
      replay()
    },
    /** Returns true for nested transcript frames, including partial or unknown-root frames. */
    receive(event: StreamLine): boolean {
      const line = event as Record<string, unknown>
      if (line.type === 'system' && line.subtype === 'task_started') {
        if (!closed && line.task_type === 'local_agent' && typeof line.task_id === 'string' && line.task_id.length > 0 && line.task_id.length <= 256
          && typeof line.tool_use_id === 'string' && line.tool_use_id.length > 0 && line.tool_use_id.length <= 256
          && typeof line.session_id === 'string' && line.session_id.length > 0 && line.session_id.length <= 256
          && (line.run_id === undefined || typeof line.run_id === 'string' && line.run_id.length > 0 && line.run_id.length <= 256)) {
          const prior = tasks.get(taskKey(line))
          if (!prior) { bounded(tasks.size); tasks.set(taskKey(line), { parent: line.tool_use_id, session: line.session_id, ...(typeof line.run_id === 'string' ? { run: line.run_id } : {}), reported: false }) }
        }
        return false
      }
      const task = line.type === 'system' && line.subtype === 'task_notification' && typeof line.task_id === 'string' ? tasks.get(taskKey(line)) : undefined
      if (task) {
        const report = record(line.handback_report)
        if (line.status !== 'completed' || !['send', 'flagged'].includes(line.handback as string) || line.session_id !== task.session || line.run_id !== task.run
          || line.tool_use_id !== undefined && line.tool_use_id !== task.parent || typeof report?.text !== 'string'
          || report.warning !== undefined && typeof report.warning !== 'string' || line.handback === 'flagged' && (typeof report.warning !== 'string' || !report.warning.trim())) return false
        if (closed || task.reported) return true
        if (!deliver(event)) {
          const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
          if (waiting.length >= 256 || waitingBytes + bytes > 2097152) throw new ClaudeProtocolError('unbound nested Claude activity exceeded its buffer limit')
          waiting.push({ event, bytes }); waitingBytes += bytes
        }
        return true
      }
      if (typeof line.parent_tool_use_id !== 'string' || !line.parent_tool_use_id
        || !['assistant', 'user', 'stream_event'].includes(line.type as string)) return false
      if (closed || line.type === 'stream_event') return true
      if (deliver(event)) replay()
      else {
        const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
        if (waiting.length >= 256 || waitingBytes + bytes > 2097152) {
          throw new ClaudeProtocolError('unbound nested Claude activity exceeded its buffer limit')
        }
        waiting.push({ event, bytes }); waitingBytes += bytes
      }
      return true
    },
    takeAccounting(): ClaudeNestedAccounting {
      const result = { toolCallCount, mutatedPaths: [...paths], hadErrors }
      toolCallCount = 0; paths.clear(); hadErrors = false
      return result
    },
    close(): void {
      closed = true
      roots.clear(); descendants.clear(); messages.clear(); tasks.clear(); waiting = []; waitingBytes = 0
      toolCallCount = 0; paths.clear(); hadErrors = false
    },
  }
}
