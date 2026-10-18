import type { ClaudeNativeJournalEntry } from '#features/code/be/services/claude-code/terminal-journal.ts'
import type { BlockConfig, MessageReferences } from './types.ts'
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
/** Project persisted native rows; hidden context and agent conversations never become user bubbles. */
export function projectClaudeTerminalHistory(entry: ClaudeNativeJournalEntry): {
  uuid: string; sessionId: string; sender: 'user' | 'assistant'; text: string; blocks: BlockConfig[]; references?: MessageReferences; context: Record<string, unknown>
} | undefined {
  const row = entry.row, message = object(row.message)
  if (!message || row.sessionId !== entry.sessionId || row.isSidechain === true || row.agentId !== undefined || row.parent_tool_use_id || row.isMeta === true
    || (row.type !== 'user' && row.type !== 'assistant') || typeof row.uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.uuid)) return
  const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content.map(object).filter((block): block is Record<string, unknown> => !!block) : []
  const text = content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
  const thinking = content.filter(block => block.type === 'thinking' && typeof block.thinking === 'string').map(block => block.thinking).join('\n')
  const origin = object(row.origin)
  const planContinuation = origin?.kind === 'auto-continuation' && typeof row.planContent === 'string' && row.queueSkipAttachments === true
  if (row.type === 'user' && !planContinuation && origin?.kind !== undefined && !['human', 'unclassified'].includes(String(origin.kind))) return
  if (row.type === 'user' && (content.some(block => block.type === 'tool_result') || row.isVisibleInTranscriptOnly === true)) return
  const images = content.flatMap(block => {
    const source = object(block.source)
    return block.type === 'image' && source?.type === 'base64' && typeof source.data === 'string' && typeof source.media_type === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(source.media_type)
      ? [{ name: 'Native image', url: `data:${source.media_type};base64,${source.data}` }] : []
  })
  const blocks: BlockConfig[] = []
  const summary = row.type === 'assistant' && row.isSummary === true
  const thinkingText = [thinking, ...(summary && text ? [text] : [])].filter(Boolean).join('\n')
  if (thinkingText) blocks.push({ type: 'thinking', props: { content: thinkingText, label: 'Thought', state: 'done', defaultOpen: false, nativeMessages: summary && text ? [{ uuid: row.uuid, sessionId: entry.sessionId, text, start: thinking ? thinking.length + 1 : 0, end: thinkingText.length, isSummary: true }] : [] } })
  const tools = content.filter(block => block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string')
  if (tools.length) blocks.push({ type: 'tool-activity', props: { entries: tools.map(block => ({ id: block.id as string, tool: block.name as string, summary: '', status: 'running' as const, details: { input: block.input } })), label: 'Native tools', state: 'done', defaultOpen: false } })
  const media = content.filter(block => !['text','thinking','tool_use','tool_result'].includes(String(block.type)))
  if (!text && !thinkingText && !tools.length && !media.length) return
  const visibleText = summary ? '' : text
  return { uuid: row.uuid, sessionId: entry.sessionId, sender: row.type, text: visibleText, blocks, ...(images.length ? { references: { images } } : {}),
    context: { cliUuid: row.uuid, ...(planContinuation ? { claudePlanContinuation: true } : {}), ...(row.type === 'user' && !planContinuation ? { claudeNativeUserMessage: { uuid: row.uuid, sessionId: entry.sessionId, text: visibleText, origin: { kind: origin?.kind === 'human' ? 'composer' : 'unclassified' } } } : {}), claudeTerminalMessage: { uuid: row.uuid, sessionId: entry.sessionId, ...(row.origin ? { origin: row.origin } : {}), ...(media.length ? { media } : {}) },
      ...(row.type === 'assistant' && visibleText ? { claudeNativeMessages: [{ uuid: row.uuid, sessionId: entry.sessionId, text: visibleText, start: 0, end: visibleText.length, ...(typeof message.id === 'string' ? { apiMessageId: message.id } : {}) }] } : {}) } }
}
