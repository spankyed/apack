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
/** Read only complete idle reports with matching sender names from the native parent mailbox wrapper. */
function nativeTeammateReports(text: string): { title: string; body: string }[] | undefined {
  if (text.length > 65_536) return
  const prefix = /^Another Claude session sent a message(?: while you were working)?:\n/.exec(text)
  const trailer = /\n\nThis came from another Claude session — [^\r\n]+$/.exec(text)
  if (!prefix || !trailer) return
  const envelope = text.slice(prefix[0].length, trailer.index)
  const frames = /<teammate-message teammate_id="([a-zA-Z0-9][a-zA-Z0-9._@-]{0,127})"(?: color="[^"<>\r\n]{1,32}")?>\n([^\r\n]+)\n<\/teammate-message>(?:\n\n|$)/y
  const reports: { title: string; body: string }[] = []
  while (frames.lastIndex < envelope.length) {
    const frame = frames.exec(envelope)
    if (!frame || reports.length >= 32) return
    let value: unknown
    try { value = JSON.parse(frame[2]) } catch { return }
    const report = object(value)
    if (report?.type !== 'idle_notification' || report.from !== frame[1]
      || typeof report.timestamp !== 'string' || !Number.isFinite(Date.parse(report.timestamp))) return
    const reason = report.idleReason
    if (reason !== undefined && reason !== 'available' && reason !== 'interrupted' && reason !== 'failed') return
    if (report.result !== undefined && typeof report.result !== 'string'
      || report.failureReason !== undefined && typeof report.failureReason !== 'string') return
    const action = reason === 'failed' ? 'failed' : reason === 'interrupted' ? 'was interrupted' : 'finished'
    const detail = typeof report.failureReason === 'string' ? report.failureReason.trim().slice(0, 200) : ''
    const title = `Teammate @${frame[1]} ${action}${detail ? ': ' + detail : ''}`
    const body = typeof report.result === 'string' ? report.result.trim().slice(0, 4000) : ''
    reports.push({ title, body })
  }
  if (reports.length) return reports
}
/** Project persisted native rows; hidden context and agent conversations never become user bubbles. */
export function projectClaudeTerminalHistory(entry: ClaudeNativeJournalEntry): {
  uuid: string; sessionId: string; timestamp?: number; sender: 'user' | 'assistant' | 'system'; text: string; blocks: BlockConfig[]; references?: MessageReferences; context: Record<string, unknown>
} | undefined {
  const source = entry.row
  const attachment = object(source.attachment)
  if (source.type === 'attachment' && attachment?.type === 'goal_status') {
    if (source.sessionId !== entry.sessionId || source.isSidechain === true || source.agentId !== undefined
      || source.parent_tool_use_id || source.isMeta === true || (source.entrypoint !== 'cli' && source.entrypoint !== 'sdk-cli')
      || typeof source.uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(source.uuid)
      || (attachment.sentinel !== undefined && attachment.sentinel !== false)
      || typeof attachment.met !== 'boolean' || (attachment.failed !== undefined && typeof attachment.failed !== 'boolean')
      || (attachment.met && attachment.failed === true)
      || typeof attachment.condition !== 'string' || !attachment.condition.trim() || attachment.condition.length > 4000
      || (attachment.reason !== undefined && (typeof attachment.reason !== 'string' || attachment.reason.length > 32_768))) return
    const counters = [attachment.durationMs, attachment.iterations, attachment.tokens]
    if (counters.some(value => value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))) return
    const outcome = attachment.failed ? 'failed' : attachment.met ? 'achieved' : 'continuing'
    const text = outcome === 'failed' ? 'Goal could not be achieved' : outcome === 'achieved' ? 'Goal achieved' : 'Goal not yet met… continuing'
    const timestamp = typeof source.timestamp === 'string' ? Date.parse(source.timestamp) : Number.NaN
    return { uuid: source.uuid, sessionId: entry.sessionId, sender: 'system', text, blocks: [],
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      context: { cliUuid: source.uuid, claudeTerminalMessage: { uuid: source.uuid, sessionId: entry.sessionId },
        claudeNativeGoalVerdict: { outcome, condition: attachment.condition, reason: attachment.reason,
          durationMs: attachment.durationMs, iterations: attachment.iterations, tokens: attachment.tokens } } }
  }
  if (source.type === 'attachment' && attachment?.type === 'queued_command') {
    const origin = object(attachment.origin)
    const uuid = attachment.source_uuid ?? source.uuid
    if (source.sessionId !== entry.sessionId || source.isSidechain === true || source.agentId !== undefined || source.parent_tool_use_id
      || (source.entrypoint !== 'cli' && source.entrypoint !== 'sdk-cli')
      || source.isMeta === true || attachment.isMeta === true || attachment.commandMode !== 'prompt'
      || attachment.forwardedIntent !== undefined || attachment.taskDelivery !== undefined
      || (attachment.origin !== undefined && origin?.kind !== 'human')
      || typeof uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(uuid)) return
    // The native transcript displays text from the drained prompt, while replay retains the document.
    // Only the caption belongs in app history. Preserve the original human UUID used by replay.
    const prompt = attachment.prompt
    const text = typeof prompt === 'string' ? prompt : Array.isArray(prompt)
      ? prompt.map(object).flatMap(block => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
      : ''
    if (!text.trim()) return
    const nativeTime = typeof attachment.timestamp === 'string' ? Date.parse(attachment.timestamp) : Number.NaN
    const journalTime = typeof source.timestamp === 'string' ? Date.parse(source.timestamp) : Number.NaN
    const timestamp = Number.isFinite(nativeTime) ? nativeTime : journalTime
    return { uuid, sessionId: entry.sessionId, sender: 'user', text, blocks: [],
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      context: { cliUuid: uuid, claudeNativeQueuedPrompt: true,
        claudeTerminalMessage: { uuid, sessionId: entry.sessionId, ...(origin ? { origin } : {}) },
        claudeNativeUserMessage: { uuid, sessionId: entry.sessionId, text, origin: { kind: origin ? 'composer' : 'unclassified' } } } }
  }
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
  // Native transcript notices and warnings are system messages, outside model messages.
  if (source.type === 'system' && source.subtype === 'informational' && (source.level === 'notice' || source.level === 'warning')) {
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
  if (row.type === 'user' && row.entrypoint === 'cli' && row.origin === undefined && row.promptSource === undefined
    && row.turnOrigin === undefined && row.isVirtual !== true && typeof message.content === 'string') {
    const reports = nativeTeammateReports(message.content)
    if (reports) {
      const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
      return { uuid: row.uuid, sessionId: entry.sessionId, sender: 'system',
        text: reports.map(({ title, body }) => body ? title + '\n' + body : title).join('\n\n'), blocks: [],
        ...(Number.isFinite(timestamp) ? { timestamp } : {}),
        context: { cliUuid: row.uuid, claudeTerminalMessage: { uuid: row.uuid, sessionId: entry.sessionId },
          claudeNativeTeammateReports: reports } }
    }
  }
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
    const match = /^<task-notification>\n<task-id>[a-z0-9]{1,64}<\/task-id>\n<status>(stopped|completed|failed|cancelled)<\/status>\n<summary>(MCP task [^<>\r\n]{1,1024})<\/summary>\n<result>\n([\s\S]*)\n<\/result>\n<\/task-notification>$/.exec(text)
    if (!match) return
    const [, status, summary, result] = match
    if (!summary || result === undefined) return
    if (status === 'stopped') {
      if (!summary.endsWith(': outcome unknown.') || !result.startsWith('Task outcome unknown:')) return
    } else if (!summary.endsWith(` ${status}.`)) return
    if (status === 'failed' && !result.startsWith('Task failed: ')) return
    if (status === 'cancelled' && !result.startsWith('Task cancelled: ') && result !== 'Task was cancelled by the server.') return
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
