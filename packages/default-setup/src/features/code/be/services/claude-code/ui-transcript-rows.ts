import type { ClaudeUiTranscriptRow } from './ui-presentation.ts'

/** Match the native AssistantMessage producer's display-only context filtering (2.1.302). */
export function claudeAssistantDisplayText(text: string): string {
  return text.replace(/<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs, '')
    .replace(/<\/?(?:cc-memory|cc_memory|ccmemory|CC-MEMORY|CC_MEMORY|CCMEMORY)(?=[\s/>])[^>]{0,1024}>/g, '')
    .replace(/^\n+/, '')
}

/** Only persisted rows belonging to this thread, session and mounted message set are eligible. */
export function selectClaudeTranscriptRows(messages: readonly { id?: string; sender?: string; text?: string; status?: string | null; context?: unknown }[], sessionId: string | undefined, selected: ReadonlySet<string>, userExpansion: ReadonlyMap<string, boolean> = new Map()): ClaudeUiTranscriptRow[] {
  if (!sessionId) return []
  const rows: ClaudeUiTranscriptRow[] = [], first = new Map<string, string>(), seen = new Set<string>(), duplicates = new Set<string>()
  for (const message of messages) {
    if (typeof message.id !== 'string' || typeof message.text !== 'string' || !message.context || typeof message.context !== 'object') continue
    const context = message.context as Record<string, unknown>
    if (message.sender === 'user' && (message.status === undefined || message.status === null)) {
      const value = context.claudeNativeUserMessage
      if (!value || typeof value !== 'object') continue
      const user = value as Record<string, unknown>
      if (user.sessionId !== sessionId || typeof user.uuid !== 'string' || !user.uuid || user.uuid.length > 256 || context.cliUuid !== user.uuid || user.text !== message.text || !message.text || !user.origin || typeof user.origin !== 'object' || (user.origin as Record<string, unknown>).kind !== 'unclassified') continue
      if (seen.has(user.uuid)) duplicates.add(user.uuid)
      seen.add(user.uuid)
      if (selected.has(message.id)) rows.push({ component: 'UserMessage', messageId: message.id, uuid: user.uuid, sessionId, text: message.text, start: 0, end: message.text.length, origin: { kind: 'unclassified' }, isExpanded: userExpansion.get(message.id) ?? true })
      continue
    }
    if (message.sender !== 'assistant' || !Array.isArray(context.claudeNativeMessages)) continue
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
