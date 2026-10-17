export interface ClaudeNativeUserMessage {
  uuid: string
  sessionId: string
  text: string
  /** The SDK replay omits stored origin; native Jgr(undefined) is unclassified, not composer/sdk. */
  origin: { kind: 'unclassified' }
}
interface ClaudeInputReplayProjection {
  text?: string
  claudeSubmittedText?: string
  claudeNativeUserMessage?: ClaudeNativeUserMessage
}

/** Native replay is the accepted user text; synthetic bootstrap/reference prefixes stay out of the chat row. */
export function projectClaudeInputReplay(content: unknown, visibleText: string, submittedPrompt?: string, identity?: { uuid?: unknown; sessionId?: unknown }): ClaudeInputReplayProjection {
  const blocks = Array.isArray(content) ? content.filter((block): block is { type: 'text'; text: string } => typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string').map(block => block.text) : []
  const accepted = typeof content === 'string' ? content : blocks.length ? blocks.join('\n') : undefined
  if (accepted === undefined || submittedPrompt === undefined) return {}
  const finish = (projection: ClaudeInputReplayProjection): ClaudeInputReplayProjection => {
    if (typeof identity?.uuid !== 'string' || !identity.uuid || identity.uuid.length > 256 || typeof identity.sessionId !== 'string' || !identity.sessionId || identity.sessionId.length > 256) return projection
    return { ...projection, claudeNativeUserMessage: { uuid: identity.uuid, sessionId: identity.sessionId, text: projection.text ?? visibleText, origin: { kind: 'unclassified' } } }
  }
  if (accepted === submittedPrompt) return finish({})
  if (submittedPrompt === visibleText) return finish({ text: accepted })
  if (submittedPrompt.endsWith(visibleText)) {
    const prefix = submittedPrompt.slice(0, submittedPrompt.length - visibleText.length)
    if (accepted.startsWith(prefix)) return finish({ text: accepted.slice(prefix.length) })
  }
  // A hook also rewrote hidden context. Keep the visible row rather than misidentifying a transcript as user text.
  return { claudeSubmittedText: accepted }
}
