import type { ClaudeUiTranscriptFrame } from '#features/code/be/services/claude-code/ui-presentation.ts'
export type ClaudeNativeMessagePart = { kind: 'host'; text: string; start: number } | { kind: 'native'; frame: ClaudeUiTranscriptFrame }

/** Preserve unconfirmed streamed tails and reject frames whose original text no longer matches. */
export function claudeNativeMessageParts(messageId: string, text: string, frames: readonly ClaudeUiTranscriptFrame[] = []): ClaudeNativeMessagePart[] {
  const selected = frames.filter(frame => frame.messageId === messageId && Number.isSafeInteger(frame.start) && Number.isSafeInteger(frame.end)
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
