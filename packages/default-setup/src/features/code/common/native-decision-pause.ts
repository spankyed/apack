/** Identity of the original pending decision, never an instruction to pause replacement work. */
export interface ClaudeDecisionPauseScope {
  ownerId: string
  sessionId: string
  messageId: string
  id: string
  revision: string
  requestId: string
  toolName: string
}

const scopeKeys = ['ownerId', 'sessionId', 'messageId', 'id', 'revision', 'requestId', 'toolName'] as const

/** Content actions share this validator without importing runtime package dependencies. */
export function parseClaudeDecisionPauseScope(value: unknown): ClaudeDecisionPauseScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const scope = value as Record<string, unknown>
  if (Object.keys(scope).length !== scopeKeys.length || scopeKeys.some(key =>
    typeof scope[key] !== 'string' || scope[key].length < 1 || scope[key].length > 512)) return
  return { ownerId: scope.ownerId as string, sessionId: scope.sessionId as string,
    messageId: scope.messageId as string, id: scope.id as string, revision: scope.revision as string,
    requestId: scope.requestId as string, toolName: scope.toolName as string }
}

export function readClaudeDecisionPauseScope(value: unknown): ClaudeDecisionPauseScope | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const pending = value as Record<string, unknown>, raw = pending.nativeTerminal
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const native = raw as Record<string, unknown>
  return parseClaudeDecisionPauseScope({ ownerId: native.ownerId, sessionId: native.sessionId,
    messageId: pending.approvalMessageId, id: native.dialogId, revision: native.revision, requestId: native.requestId, toolName: pending.toolName })
}
