import type { EntityId } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { broadcastToPlugin } from '#generated/events.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import type { ClaudeNativeJournalEntry } from '#features/code/be/services/claude-code/terminal-journal.ts'
import { projectClaudeTerminalHistory } from './claude-terminal-history.ts'
import { updateMessageState } from './services/chat.ts'
import { updateChatState } from './services/threads.ts'
import type { ClaudeNativeSubmissionReceipt } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { MessageReferences, ToolActivityEntry } from './types.ts'
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Mirror the process, independent of mounted windows; UUIDs make repeated journal rows idempotent. */
export function syncClaudeTerminalThread(threadId: EntityId, owner: ClaudeNativeTerminalOwner, current: () => boolean) {
  const nativeMessages = new Map<string, { id: EntityId; terminal: boolean }>()
  const acceptedReferences = new Map<string, MessageReferences>()
  const pendingTools = new Map<string, ClaudeNativeJournalEntry>()
  const results = new Map<string, { text: string; error: boolean }>()
  let stopped = false, journalPending = false, inFlight: Promise<void> | undefined, lastMetadata = '', problem: string | undefined
  const initial = repository.chatQueries.threadData(threadId)
  const toolIds = new Set<string>(), toolCounts = new Map<string, number>()
  if (initial?.context?.claudeCode?.sessionId) toolCounts.set(initial.context.claudeCode.sessionId, initial.context.claudeCode.toolCallCount ?? 0)
  let lastTurnAt = initial?.context?.claudeCode?.lastTurnAt as number | undefined
  for (const message of initial?.messages ?? []) {
    if (!message.id) continue
    const context = object(message.context), terminal = object(context?.claudeTerminalMessage)
    const sessionId = typeof terminal?.sessionId === 'string' ? terminal.sessionId : initial?.context?.claudeCode?.sessionId
    const ids = [context?.cliUuid, object(context?.claudeNativeUserMessage)?.uuid,
      ...(Array.isArray(context?.claudeNativeMessages) ? context.claudeNativeMessages.map(value => object(value)?.uuid) : []),
      ...(message.blocks ?? []).flatMap(block => { const rows = object(block.props)?.nativeMessages; return Array.isArray(rows) ? rows.map(value => object(value)?.uuid) : [] })]
    for (const id of ids) if (typeof id === 'string' && sessionId) nativeMessages.set(JSON.stringify([sessionId, id]), { id: message.id, terminal: !!terminal })
  }
  function upsert(entry: ClaudeNativeJournalEntry) {
    const row = projectClaudeTerminalHistory(entry)
    if (!row) return
    const key = JSON.stringify([row.sessionId, row.uuid]), existing = nativeMessages.get(key)
    const references = row.sender === 'user' ? acceptedReferences.get(key) ?? row.references : row.references
    if (existing && !existing.terminal) return
    for (const block of row.blocks) {
      if (block.type !== 'tool-activity') continue
      const entries = block.props.entries as ToolActivityEntry[]
      for (const item of entries) {
        const result = results.get(JSON.stringify([row.sessionId, item.id]))
        if (result) { item.status = result.error ? 'error' : 'ok'; item.outputSummary = result.text.slice(0, 200); item.details = { ...item.details, output: result.text } }
        else if (['exited', 'error'].includes(owner.state.status)) { item.status = 'error'; item.details = { ...item.details, error: 'Native session ended before a result was recorded' } }
        else pendingTools.set(key, entry)
      }
      block.props.state = entries.some(item => item.status === 'running') ? 'streaming' : entries.some(item => item.status === 'error') ? 'error' : 'done'
    }
    if (existing) updateMessageState(existing.id, { text: row.text, blocks: row.blocks, context: row.context, ...(references ? { references } : {}) })
    else {
      const result = repository.chatCommands.addMessage({ threadId, sender: row.sender, text: row.text, blocks: row.blocks, context: row.context, references })
      // addMessage trims the human entry path; a native row's exact text is already accepted.
      if (result.text !== row.text) repository.chatCommands.updateMessageState({ messageId: result.id, updates: { text: row.text } })
      nativeMessages.set(key, { id: result.id, terminal: true })
      const message = repository.chatQueries.messageById(result.id)
      if (message) broadcastToPlugin('threads', { type: 'MESSAGE_ADDED', threadId, message })
    }
  }
  async function flush() {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const batch = await owner.readJournal()
        journalPending = batch.pending
        problem = batch.problems.length ? batch.problems.join('; ') : undefined
        if (!current() || !repository.threadQueries.byId(threadId)) return
        for (const entry of batch.entries) {
          const message = object(entry.row.message)
          if (entry.row.isSidechain === true || entry.row.agentId !== undefined || entry.row.parent_tool_use_id) continue
          if (entry.row.type === 'user' && Array.isArray(message?.content)) {
            for (const value of message.content) {
              const block = object(value)
              if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
              const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(object).filter(value => value?.type === 'text').map(value => value?.text).join('\n') : ''
              results.set(JSON.stringify([entry.sessionId, block.tool_use_id]), { text, error: block.is_error === true })
            }
          }
          if (entry.row.type === 'assistant' && Array.isArray(message?.content)) {
            const existing = nativeMessages.get(JSON.stringify([entry.sessionId, entry.row.uuid]))
            for (const value of message.content) {
              const block = object(value), key = JSON.stringify([entry.sessionId, block?.id])
              if (block?.type === 'tool_use' && typeof block.id === 'string' && !toolIds.has(key) && (!existing || existing.terminal)) {
                toolIds.add(key); toolCounts.set(entry.sessionId, (toolCounts.get(entry.sessionId) ?? 0) + 1)
              }
            }
          }
          const projected = projectClaudeTerminalHistory(entry)
          if (projected?.sender === 'user' && typeof entry.row.timestamp === 'string') { const time = Date.parse(entry.row.timestamp); if (Number.isFinite(time)) lastTurnAt = Math.max(lastTurnAt ?? 0, time) }
          upsert(entry)
        }
        for (const [key, entry] of pendingTools) {
          const message = object(entry.row.message), blocks = Array.isArray(message?.content) ? message.content.map(object) : []
          if (['exited', 'error'].includes(owner.state.status) || blocks.filter(block => block?.type === 'tool_use').every(block => results.has(JSON.stringify([entry.sessionId, block?.id])))) { pendingTools.delete(key); upsert(entry) }
        }
        const state = owner.state, metadata = state.session
        const snapshot = JSON.stringify([state.sessionId, metadata, owner.busy, state.status, state.lastTurn, problem, lastTurnAt, toolCounts.get(state.sessionId)])
        if (snapshot === lastMetadata) return
        lastMetadata = snapshot
        const thread = repository.threadQueries.byId(threadId)
        if (!thread) return
        const prior = thread.context?.claudeCode ?? {}
        const previous = Array.isArray(prior.previousSessionIds) ? prior.previousSessionIds : []
        const nativeError = state.lastTurn?.reason === 'error' ? 'Native Claude turn failed; details remain in the native interface' : state.lastTurn?.reason === 'refusal' ? 'Native Claude refused the turn' : undefined
        const chatState = problem || nativeError || state.status === 'error' ? 'error' : owner.busy ? 'working' : state.status === 'exited' || state.lastTurn?.reason === 'aborted' ? 'paused' : 'success'
        const context = { ...thread.context, claudeCode: { ...prior, sessionId: state.sessionId,
          ...(prior.sessionId && prior.sessionId !== state.sessionId ? { previousSessionIds: [...new Set([...previous, prior.sessionId])] } : {}),
          ...(metadata ? { model: metadata.model, modelOverride: metadata.model, cwd: metadata.cwd, ...(metadata.permissionMode ? { permissionMode: metadata.permissionMode } : {}), turns: metadata.turns, startedAt: metadata.startedAt, ...(metadata.totalCostUsd !== undefined ? { totalCostUsd: metadata.totalCostUsd } : {}) } : {}),
          toolCallCount: toolCounts.get(state.sessionId) ?? 0, ...(lastTurnAt !== undefined ? { lastTurnAt } : {}), chatState, sessionError: problem ?? nativeError } }
        repository.threadCommands.update(threadId, { context })
        broadcastToPlugin('threads', { type: 'THREAD_UPDATED', threadId, updates: { context } })
        updateChatState(threadId, chatState)
      } catch (error) {
        journalPending = false
        problem = error instanceof Error ? error.message : 'Native conversation history could not be synchronized'
        const thread = current() ? repository.threadQueries.byId(threadId) : undefined
        if (thread && thread.context?.claudeCode?.sessionError !== problem) {
          const context = { ...thread.context, claudeCode: { ...thread.context?.claudeCode, sessionError: problem, chatState: 'error' } }
          repository.threadCommands.update(threadId, { context }); broadcastToPlugin('threads', { type: 'THREAD_UPDATED', threadId, updates: { context } }); updateChatState(threadId, 'error')
        }
      }
    })().finally(() => { inFlight = undefined })
    return inFlight
  }
  const timer = setInterval(() => { if (!stopped) void flush() }, 250); timer.unref?.()
  void flush()
  owner.beforeRelease(async () => { stopped = true; clearInterval(timer); await inFlight; do { await flush() } while (journalPending && current()) })
  return {
    acceptSubmission(receipt: ClaudeNativeSubmissionReceipt, references: MessageReferences) {
      if (!current() || receipt.sessionId !== owner.state.sessionId) return
      const key = JSON.stringify([receipt.sessionId, receipt.uuid]), retained = structuredClone(references)
      acceptedReferences.set(key, retained)
      const existing = nativeMessages.get(key)
      if (existing?.terminal) updateMessageState(existing.id, { references: retained })
    },
  }
}
