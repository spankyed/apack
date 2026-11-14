import type { ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'

/** Only explicitly hidden canonical native identities are omitted; history and unknown rows survive. */
export function selectClaudeFocusMessages<T extends { context?: unknown; compacted?: unknown }>(messages: readonly T[], owner?: ClaudeNativeTerminalState): T[] {
  const focus = owner?.focus
  const hidden = owner?.status === 'live' && owner.view?.kind === 'main' && focus?.active && focus.sessionId === owner.sessionId && focus.viewRevision === owner.view.revision ? new Set(focus.hidden) : undefined
  return messages.filter(message => {
    if (message.compacted) return false
    if (!hidden?.size || !message.context || typeof message.context !== 'object') return true
    const context = message.context as Record<string, unknown>, terminal = context.claudeTerminalMessage
    if (!terminal || typeof terminal !== 'object') return true
    const row = terminal as Record<string, unknown>
    return row.sessionId !== owner!.sessionId || typeof row.uuid !== 'string' || context.cliUuid !== row.uuid || !hidden.has(row.uuid)
  })
}
