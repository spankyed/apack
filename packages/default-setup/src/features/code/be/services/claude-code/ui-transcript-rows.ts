import type { ClaudeUiTranscriptRow } from './ui-presentation.ts'

/** Only persisted rows belonging to this thread, session and mounted message set are eligible. */
export function selectClaudeTranscriptRows(messages: readonly { id?: string; sender?: string; text?: string; status?: string | null; context?: unknown; blocks?: readonly unknown[] }[], sessionId: string | undefined, selected: ReadonlySet<string>, userExpansion: ReadonlyMap<string, boolean> = new Map(), thinkingExpansion: ReadonlyMap<string, ReadonlySet<number>> = new Map()): ClaudeUiTranscriptRow[] {
  if (!sessionId) return []
  const rows: ClaudeUiTranscriptRow[] = [], first = new Map<string, string>(), seen = new Set<string>(), duplicates = new Set<string>()
  for (const message of messages) {
    if (typeof message.id !== 'string' || typeof message.text !== 'string') continue
    const context = message.context && typeof message.context === 'object' ? message.context as Record<string, unknown> : {}
    if (message.sender === 'user' && (message.status === undefined || message.status === null)) {
      const value = context.claudeNativeUserMessage
      if (!value || typeof value !== 'object') continue
      const user = value as Record<string, unknown>
      if (user.sessionId !== sessionId || typeof user.uuid !== 'string' || !user.uuid || user.uuid.length > 256 || context.cliUuid !== user.uuid || user.text !== message.text || !message.text || !user.origin || typeof user.origin !== 'object' || !['unclassified', 'composer'].includes(String((user.origin as Record<string, unknown>).kind))) continue
      if ((user.origin as Record<string, unknown>).kind === 'composer') {
        const terminal = context.claudeTerminalMessage && typeof context.claudeTerminalMessage === 'object' ? context.claudeTerminalMessage as Record<string, unknown> : undefined
        const origin = terminal?.origin && typeof terminal.origin === 'object' ? terminal.origin as Record<string, unknown> : undefined
        if (terminal?.uuid !== user.uuid || terminal.sessionId !== sessionId || origin?.kind !== 'human') continue
      }
      if (seen.has(user.uuid)) duplicates.add(user.uuid)
      seen.add(user.uuid)
      if (selected.has(message.id)) rows.push({ component: 'UserMessage', messageId: message.id, uuid: user.uuid, sessionId, text: message.text, start: 0, end: message.text.length, origin: { kind: (user.origin as { kind: 'unclassified' | 'composer' }).kind }, isExpanded: userExpansion.get(message.id) ?? true })
      continue
    }
    if (message.sender !== 'assistant') continue
    const command = context.claudeNativeCommand && typeof context.claudeNativeCommand === 'object' ? context.claudeNativeCommand as Record<string, unknown> : undefined
    if (command?.kind === 'output') {
      const terminal = context.claudeTerminalMessage && typeof context.claudeTerminalMessage === 'object' ? context.claudeTerminalMessage as Record<string, unknown> : undefined
      if (terminal?.sessionId !== sessionId || typeof terminal.uuid !== 'string' || !terminal.uuid || terminal.uuid.length > 256 || context.cliUuid !== terminal.uuid || command.text !== message.text || !message.text || !['stdout', 'stderr'].includes(String(command.stream))) continue
      if (seen.has(terminal.uuid)) duplicates.add(terminal.uuid)
      seen.add(terminal.uuid)
      if (selected.has(message.id)) rows.push({ component: 'CommandOutput', messageId: message.id, uuid: terminal.uuid, sessionId, text: message.text, start: 0, end: message.text.length, isErrored: command.stream === 'stderr' })
      continue
    }
    for (const [blockIndex, value] of (message.blocks ?? []).entries()) {
      if (!value || typeof value !== 'object') continue
      const block = value as Record<string, unknown>
      if (block.type !== 'thinking' || !block.props || typeof block.props !== 'object') continue
      const props = block.props as Record<string, unknown>
      if (typeof props.content !== 'string' || !Array.isArray(props.nativeMessages)) continue
      let through = 0
      for (const value of props.nativeMessages) {
        if (!value || typeof value !== 'object') continue
        const row = value as Record<string, unknown>
        if (row.sessionId !== sessionId || typeof row.uuid !== 'string' || !row.uuid || row.uuid.length > 256 || typeof row.text !== 'string'
          || typeof row.start !== 'number' || typeof row.end !== 'number' || !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end)
          || row.start < through || row.end <= row.start || row.end > props.content.length || props.content.slice(row.start, row.end) !== row.text) continue
        through = row.end
        if (seen.has(row.uuid)) duplicates.add(row.uuid)
        seen.add(row.uuid)
        if (row.isSummary === true && row.text.trim() && selected.has(message.id) && thinkingExpansion.get(message.id)?.has(blockIndex)) {
          // Native main narration rows are standalone summary producers, independent of text-row grouping.
          rows.push({ component: 'AssistantMessage', isSummary: true, blockIndex, isFirstOfReply: true, messageId: message.id, uuid: row.uuid, sessionId, text: row.text, start: row.start, end: row.end })
        }
      }
    }
    if (!Array.isArray(context.claudeNativeMessages)) continue
    let through = 0
    for (const value of context.claudeNativeMessages) {
      if (!value || typeof value !== 'object') continue
      const row = value as Record<string, unknown>
      if (row.sessionId !== sessionId || typeof row.uuid !== 'string' || !row.uuid || row.uuid.length > 256 || typeof row.text !== 'string'
        || typeof row.start !== 'number' || typeof row.end !== 'number' || !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end)
        || row.start < through || row.end <= row.start || row.end > message.text.length || message.text.slice(row.start, row.end) !== row.text) continue
      through = row.end
      if (seen.has(row.uuid)) duplicates.add(row.uuid)
      seen.add(row.uuid)
      const apiId = typeof row.apiMessageId === 'string' && row.apiMessageId ? row.apiMessageId : undefined
      if (apiId && !first.has(apiId)) first.set(apiId, row.uuid)
      if (selected.has(message.id)) rows.push({ component: 'AssistantMessage', messageId: message.id, uuid: row.uuid, sessionId, text: row.text, start: row.start, end: row.end, isFirstOfReply: !apiId || first.get(apiId) === row.uuid })
    }
  }
  return rows.filter(row => !duplicates.has(row.uuid))
}
