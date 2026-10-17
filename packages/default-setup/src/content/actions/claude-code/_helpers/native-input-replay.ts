/** Native replay is the accepted user text; synthetic bootstrap/reference prefixes stay out of the chat row. */
export function projectClaudeInputReplay(content: unknown, visibleText: string, submittedPrompt?: string): { text?: string; claudeSubmittedText?: string } {
  const blocks = Array.isArray(content) ? content.filter((block): block is { type: 'text'; text: string } => typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string').map(block => block.text) : []
  const accepted = typeof content === 'string' ? content : blocks.length ? blocks.join('\n') : undefined
  if (accepted === undefined || submittedPrompt === undefined || accepted === submittedPrompt) return {}
  if (submittedPrompt === visibleText) return { text: accepted }
  if (submittedPrompt.endsWith(visibleText)) {
    const prefix = submittedPrompt.slice(0, submittedPrompt.length - visibleText.length)
    if (accepted.startsWith(prefix)) return { text: accepted.slice(prefix.length) }
  }
  // A hook also rewrote hidden context. Keep the visible row rather than misidentifying a transcript as user text.
  return { claudeSubmittedText: accepted }
}
