import type { ClaudeNativeTerminalTask } from '../../../common/native-terminal.ts'

type NativeRecord = Record<string, unknown>
const record = (value: unknown): NativeRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as NativeRecord : undefined
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256

/** Project native output only after session and task ownership are established by the native plugin. */
export function createClaudeTerminalStatus(sessionId: string) {
  let currentSession = sessionId
  let mainStatus: string | undefined
  let agents: ClaudeNativeTerminalTask[] = []
  const decorations = new Map<string, { status: string; text: string }>()
  const epochs = new Map<string, bigint>()
  return {
    get sessionId() { return currentSession },
    get mainStatus() { return mainStatus },
    get tasks(): ClaudeNativeTerminalTask[] { return agents.map(agent => ({ ...agent, ...(decorations.get(agent.id)?.status === agent.status ? { statusText: decorations.get(agent.id)!.text } : {}) })) },
    updateSession(id: string, values: unknown): boolean {
      if (!/^[0-9a-f-]{36}$/i.test(id) || !Array.isArray(values)) return false
      if (id !== currentSession) { currentSession = id; mainStatus = undefined; decorations.clear(); epochs.clear() }
      const next: ClaudeNativeTerminalTask[] = []
      const seen = new Set<string>()
      for (const value of values.slice(0, 256)) {
        const agent = record(value)
        if (!agent || !validId(agent.id) || seen.has(agent.id) || typeof agent.status !== 'string') continue
        seen.add(agent.id)
        next.push({ id: agent.id, name: typeof agent.type === 'string' ? agent.type.slice(0, 256) : agent.id, status: agent.status.slice(0, 64) })
      }
      agents = next
      for (const [id, value] of decorations) if (!agents.some(agent => agent.id === id && agent.status === value.status)) decorations.delete(id)
      return true
    },
    accept(value: unknown): boolean {
      const event = record(value)
      if (!event || event.sessionId !== currentSession || (event.kind !== 'main' && event.kind !== 'subagent') || typeof event.stdout !== 'string' || event.stdout.length > 32768 || typeof event.truncated !== 'boolean' || typeof event.startedAt !== 'string' || !/^[0-9]{1,30}$/.test(event.startedAt) || (event.code !== null && !Number.isInteger(event.code))) return false
      if (BigInt(event.startedAt) < (epochs.get(event.kind) ?? 0n)) return false
      epochs.set(event.kind, BigInt(event.startedAt))
      if (event.kind === 'main') {
        mainStatus = event.code === 0 && !event.truncated && !event.signal ? event.stdout.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n') || undefined : undefined
        return true
      }
      decorations.clear()
      if (event.code !== 0 || event.truncated || event.signal || !Array.isArray(event.tasks)) return true
      const eligible = new Map<string, string>()
      for (const value of event.tasks.slice(0, 256)) {
        const task = record(value)
        if (task && validId(task.id) && typeof task.status === 'string' && agents.some(agent => agent.id === task.id && agent.status === task.status)) eligible.set(task.id, task.status)
      }
      for (const line of event.stdout.split('\n')) {
        let value: unknown
        try { value = JSON.parse(line) } catch { continue }
        const row = record(value)
        if (!row || !validId(row.id) || typeof row.content !== 'string' || !eligible.has(row.id)) continue
        decorations.set(row.id, { status: eligible.get(row.id)!, text: row.content })
      }
      return true
    },
    clearOutput() { mainStatus = undefined; decorations.clear() },
    clearMain() { mainStatus = undefined },
    clear() { mainStatus = undefined; agents = []; decorations.clear(); epochs.clear() },
  }
}
