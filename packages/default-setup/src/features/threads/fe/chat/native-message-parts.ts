import { claudeAssistantDisplayText } from '#features/code/common/claude-message-display.ts'
import type { ThinkingBlockProps } from '#features/threads/be/types.ts'
import type { ClaudeUiTranscriptFrame } from '#features/code/be/services/claude-code/ui-presentation.ts'
export type ClaudeNativeMessagePart = { kind: 'host'; text: string; start: number } | { kind: 'native'; frame: ClaudeUiTranscriptFrame }

/** Preserve unconfirmed streamed tails and reject frames whose original text no longer matches. */
export function claudeNativeMessageParts(messageId: string, text: string, frames: readonly ClaudeUiTranscriptFrame[] = [], blockIndex?: number): ClaudeNativeMessagePart[] {
  const selected = frames.filter(frame => frame.component !== 'ToolResult' && frame.component !== 'ToolUse' && frame.component !== 'ToolProgress' && frame.messageId === messageId && (blockIndex === undefined ? frame.component !== 'AssistantMessage' || !frame.isSummary : frame.component === 'AssistantMessage' && frame.isSummary && frame.blockIndex === blockIndex) && Number.isSafeInteger(frame.start) && Number.isSafeInteger(frame.end)
    && frame.start >= 0 && frame.end > frame.start && frame.end <= text.length && text.slice(frame.start, frame.end) === frame.text).sort((a, b) => a.start - b.start)
  const parts: ClaudeNativeMessagePart[] = []
  let through = 0
  for (const frame of selected) {
    if (frame.start < through) continue
    if (frame.start > through) parts.push({ kind: 'host', text: text.slice(through, frame.start), start: through })
    parts.push({ kind: 'native', frame }); through = frame.end
  }
  if (through < text.length) parts.push({ kind: 'host', text: text.slice(through), start: through })
  return parts
}

/** Normalize only confirmed narration while its hook is pending; raw thinking stays literal. */
export function claudeThinkingMessageParts(messageId: string, blockIndex: number, block: ThinkingBlockProps, frames: readonly ClaudeUiTranscriptFrame[] = []): ClaudeNativeMessagePart[] {
  const parts = claudeNativeMessageParts(messageId, block.content, frames, blockIndex)
  return parts.flatMap(part => {
    if (part.kind === 'native') return [part]
    const result: ClaudeNativeMessagePart[] = []
    let through = part.start
    const end = part.start + part.text.length
    for (const row of Array.isArray(block.nativeMessages) ? block.nativeMessages : []) {
      if (!row || row.isSummary !== true || typeof row.text !== 'string' || !row.text.trim() || !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end) || row.start < through || row.end <= row.start || row.end > end || block.content.slice(row.start, row.end) !== row.text) continue
      if (row.start > through) result.push({ kind: 'host', text: block.content.slice(through, row.start), start: through })
      result.push({ kind: 'host', text: claudeAssistantDisplayText(row.text.trim()), start: row.start })
      through = row.end
    }
    if (through < end) result.push({ kind: 'host', text: block.content.slice(through, end), start: through })
    return result
  })
}
