import { createClaudeTerminalStatus } from './terminal-status.ts'

interface ClaudeBackgroundHelperScope {
  sessionId: string
  pid: number
  generation: string
  policyKey: string
  command: string | null
  agents: unknown[]
}

/** Child helper results decorate only tasks admitted by the current original worker. */
export function createClaudeBackgroundHelperProjection() {
  let scope: ClaudeBackgroundHelperScope | undefined
  let projection: ReturnType<typeof createClaudeTerminalStatus> | undefined
  let latestStartedAt: bigint | undefined
  return {
    configure(next: ClaudeBackgroundHelperScope) {
      const changed = !scope || [next.sessionId, next.pid, next.generation, next.policyKey, next.command]
        .some((value, index) => value !== [scope!.sessionId, scope!.pid, scope!.generation, scope!.policyKey, scope!.command][index])
      if (changed) {
        projection = createClaudeTerminalStatus(next.sessionId)
        latestStartedAt = undefined
      }
      scope = { ...next, agents: [...next.agents] }
      if (!projection!.updateSession(next.sessionId, next.agents)) {
        scope = undefined
        projection = undefined
        return false
      }
      return true
    },
    accept(value: unknown) {
      if (!scope || !projection || !scope.command || !value || typeof value !== 'object' || Array.isArray(value)) return false
      const event = value as Record<string, unknown>
      if (event.kind !== 'subagent' || event.sessionId !== scope.sessionId || event.parentPid !== scope.pid
        || event.generation !== scope.generation || event.policyKey !== scope.policyKey || event.command !== scope.command
        || typeof event.startedAt !== 'string' || !/^[0-9]{1,30}$/.test(event.startedAt)) return false
      const startedAt = BigInt(event.startedAt)
      if (latestStartedAt !== undefined && startedAt <= latestStartedAt) return false
      if (!projection.accept(event)) return false
      latestStartedAt = startedAt
      return true
    },
    get tasks() { return projection?.tasks ?? [] },
    clear() { scope = undefined; projection = undefined; latestStartedAt = undefined },
  }
}
