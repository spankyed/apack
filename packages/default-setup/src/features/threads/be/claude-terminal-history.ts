import { isClaudeNativeInterruption } from '#features/code/common/native-interruption.ts'
import { presentClaudeCommandHistory } from '#features/code/be/services/claude-code/command-history.ts'
import type { ClaudeNativeJournalEntry } from '#features/code/be/services/claude-code/terminal-journal.ts'
import type { BlockConfig, MessageReferences } from './types.ts'
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
/** Strip the native model envelope from a source-stamped channel message. */
function nativeChannelBody(value: string, server: string): string | undefined {
  const wrapped = [`A message arrived from ${server}:\n`, `A message arrived from ${server} while you were working:\n`]
    .find(prefix => value.startsWith(prefix))
  const envelope = wrapped ? value.slice(wrapped.length) : value
  const open = /^<channel source="([^"]*)"(?: [a-zA-Z_][a-zA-Z0-9_]*="[^"]*")*>\n/.exec(envelope)
  const encodedServer = server.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
  if (!open || open[1] !== encodedServer) return
  const end = envelope.indexOf('\n</channel>', open[0].length - 1)
  if (end < 0) return
  const body = envelope.slice(open[0].length, end)
  return body.trim() ? body : undefined
}
/** Project persisted native rows; hidden context and agent conversations never become user bubbles. */
export function projectClaudeTerminalHistory(entry: ClaudeNativeJournalEntry): {
  uuid: string; sessionId: string; timestamp?: number; sender: 'user' | 'assistant' | 'system'; text: string; blocks: BlockConfig[]; references?: MessageReferences; context: Record<string, unknown>
} | undefined {
  const source = entry.row
  const compaction = source.type === 'system' && source.subtype === 'compact_boundary' ? 'boundary'
    : source.type === 'user' && source.isCompactSummary === true ? 'summary' : undefined
  if (compaction) {
    if (source.sessionId !== entry.sessionId || source.isSidechain === true || source.agentId !== undefined || source.parent_tool_use_id
      || typeof source.uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(source.uuid)) return
    const content = compaction === 'boundary' ? source.content : object(source.message)?.content
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.map(object).flatMap(block => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
      : ''
    if (!text.trim()) return
    const timestamp = typeof source.timestamp === 'string' ? Date.parse(source.timestamp) : Number.NaN
    return { uuid: source.uuid, sessionId: entry.sessionId, sender: 'system', text, blocks: [],
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      context: { cliUuid: source.uuid, claudeTerminalMessage: { uuid: source.uuid, sessionId: entry.sessionId },
        claudeNativeCompaction: compaction,
        ...(compaction === 'summary' && typeof source.parentUuid === 'string'
          ? { claudeNativeCompactionAnchor: source.parentUuid } : {}) } }
  }
  // Original ui.log persists a transcript-only informational notice, outside model messages.
  if (source.type === 'system' && source.subtype === 'informational' && source.level === 'notice') {
    if (source.sessionId !== entry.sessionId || source.entrypoint !== 'cli' || source.isSidechain === true
      || source.agentId !== undefined || source.parent_tool_use_id || source.isMeta === true
      || typeof source.content !== 'string' || !source.content || typeof source.uuid !== 'string'
      || !/^[a-f0-9-]{36}$/i.test(source.uuid)) return
    const timestamp = typeof source.timestamp === 'string' ? Date.parse(source.timestamp) : Number.NaN
    return { uuid: source.uuid, sessionId: entry.sessionId, sender: 'system', text: source.content, blocks: [],
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      context: { cliUuid: source.uuid, claudeTerminalMessage: { uuid: source.uuid, sessionId: entry.sessionId },
        claudeNativeNotice: { subtype: source.subtype, level: source.level } } }
  }
  // Native local and immediate JSX commands persist system rows, with the same command envelopes.
  const commandRow = source.type === 'system' && source.subtype === 'local_command' && typeof source.content === 'string'
    && presentClaudeCommandHistory(source, source.content)
  const row = commandRow ? { ...source, type: 'user', message: { content: source.content } } : source
  const message = object(row.message)
  if (!message || row.sessionId !== entry.sessionId || row.isSidechain === true || row.agentId !== undefined || row.parent_tool_use_id
    || (row.type !== 'user' && row.type !== 'assistant') || typeof row.uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.uuid)) return
  const origin = object(row.origin)
  if (row.type === 'user' && origin?.kind === 'channel') {
    if (row.entrypoint !== 'cli' || row.isVirtual === true || typeof origin.server !== 'string' || !origin.server.trim()) return
    const block = Array.isArray(message.content) && message.content.length === 1 ? object(message.content[0]) : undefined
    const envelope = typeof message.content === 'string' ? message.content : block?.type === 'text' ? block.text : undefined
    const body = typeof envelope === 'string' ? nativeChannelBody(envelope, origin.server) : undefined
    if (body === undefined) return
    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
    return { uuid: row.uuid, sessionId: entry.sessionId, sender: 'system', text: body, blocks: [],
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      context: { cliUuid: row.uuid, claudeTerminalMessage: { uuid: row.uuid, sessionId: entry.sessionId },
        claudeNativeChannel: { server: origin.server } } }
  }
  if (row.isMeta === true) return
  const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content.map(object).filter((block): block is Record<string, unknown> => !!block) : []
  const text = content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
  // Preserve native interruption events without assigning person/composer ownership.
  if (isClaudeNativeInterruption(row)) {
    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
    return { uuid: row.uuid, sessionId: entry.sessionId, sender: 'system', text, blocks: [],
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      context: { cliUuid: row.uuid, claudeTerminalMessage: { uuid: row.uuid, sessionId: entry.sessionId },
        claudeNativeInterruption: { uuid: row.uuid, sessionId: entry.sessionId, text } } }
  }
  const command = content.every(block => block.type === 'text') ? presentClaudeCommandHistory(row, text) : undefined
  if (command && !command.text) return
  const thinking = content.filter(block => block.type === 'thinking' && typeof block.thinking === 'string').map(block => block.thinking).join('\n')
  // An original MCP ending can contain model instructions and raw server text.
  // Show only the bounded native summary of an original journal event.
  if (row.type === 'user' && origin?.kind === 'task-notification' && origin.producer === 'session-task'
    && origin.taskKind === 'mcp-task' && row.entrypoint === 'cli' && row.promptSource === 'system'
    && row.turnOrigin === 'task_notification' && content.length === 1 && typeof message.content === 'string'
    && text.length <= 32_768) {
    const match = /^<task-notification>\n<task-id>[a-z0-9]{1,64}<\/task-id>\n<status>(stopped|completed)<\/status>\n<summary>(MCP task [^<>\r\n]{1,1024})<\/summary>\n<result>\n([\s\S]*)\n<\/result>\n<\/task-notification>$/.exec(text)
    if (!match) return
    const [, status, summary, result] = match
    if (!summary || (status === 'completed'
      ? !summary.endsWith(' completed.')
      : !summary.endsWith(': outcome unknown.') || !result?.startsWith('Task outcome unknown:'))) return
    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
    return { uuid: row.uuid, sessionId: entry.sessionId, sender: 'system', text: summary, blocks: [],
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      context: { cliUuid: row.uuid, claudeTerminalMessage: { uuid: row.uuid, sessionId: entry.sessionId } } }
  }
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
  const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
  const visibleText = command ? command.text : summary ? '' : text
  const sender = command?.kind === 'output' ? 'assistant' : row.type
  return { uuid: row.uuid, sessionId: entry.sessionId, ...(Number.isFinite(timestamp) ? {timestamp} : {}), sender, text: visibleText, blocks, ...(images.length ? { references: { images } } : {}),
    context: { cliUuid: row.uuid, ...(command ? { claudeNativeCommand: command } : {}), ...(planContinuation ? { claudePlanContinuation: true } : {}), ...(row.type === 'user' && !planContinuation && !command ? { claudeNativeUserMessage: { uuid: row.uuid, sessionId: entry.sessionId, text: visibleText, origin: { kind: origin?.kind === 'human' ? 'composer' : 'unclassified' } } } : {}), claudeTerminalMessage: { uuid: row.uuid, sessionId: entry.sessionId, ...(row.origin ? { origin: row.origin } : {}), ...(media.length ? { media } : {}) },
      ...(row.type === 'assistant' && visibleText && !command ? { claudeNativeMessages: [{ uuid: row.uuid, sessionId: entry.sessionId, text: visibleText, start: 0, end: visibleText.length, ...(typeof message.id === 'string' ? { apiMessageId: message.id } : {}) }] } : {}) } }
}
