import type { ClaudeNativeTaskDetails } from '../../../common/native-terminal.ts'
import type { ClaudeUiTranscriptRow } from './ui-presentation.ts'

/** Only exact native text rows enter text hooks; mixed tool/thinking previews keep their explicit scope. */
export function selectClaudeAgentTranscriptRows(details: ClaudeNativeTaskDetails | undefined, sessionId: string): ClaudeUiTranscriptRow[] {
  const rows: ClaudeUiTranscriptRow[] = [], replies = new Set<string>()
  for (const message of details?.messages ?? []) {
    if (message.renderText === undefined) continue
    const source = { messageId: message.uuid, uuid: message.uuid, sessionId, text: message.renderText, start: 0, end: message.renderText.length }
    if (message.role === 'user') rows.push({ ...source, component: 'UserMessage', origin: message.origin ?? { kind: 'unclassified' }, isExpanded: true })
    else {
      const isFirstOfReply = !message.apiMessageId || !replies.has(message.apiMessageId)
      if (message.apiMessageId) replies.add(message.apiMessageId)
      rows.push({ ...source, component: 'AssistantMessage', isFirstOfReply })
    }
  }
  return rows
}
