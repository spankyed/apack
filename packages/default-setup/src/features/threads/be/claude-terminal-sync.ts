import type { ClaudeNativeLaunch } from '#features/code/common/native-launch.ts'
import type { EntityId } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { broadcastToPlugin } from '#generated/events.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import type { ClaudeNativeJournalEntry } from '#features/code/be/services/claude-code/terminal-journal.ts'
import { projectClaudeTerminalHistory } from './claude-terminal-history.ts'
import { sendBlockMessage, updateMessageState } from './services/chat.ts'
import { updateChatState } from './services/threads.ts'
import type { ClaudeNativeSubmissionReceipt } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { MessageReferences, ToolActivityEntry } from './types.ts'
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Mirror the process, independent of mounted windows; UUIDs make repeated journal rows idempotent. */
export function syncClaudeTerminalThread(threadId: EntityId, owner: ClaudeNativeTerminalOwner, current: () => boolean, readLaunch: () => Promise<ClaudeNativeLaunch | undefined>) {
  const nativeMessages = new Map<string, { id: EntityId; terminal: boolean }>()
  const acceptedReferences = new Map<string, MessageReferences>()
  const pendingTools = new Map<string, ClaudeNativeJournalEntry>()
  const results = new Map<string, { text: string; error: boolean; uuid?: string; agentId?: string; assistantUuid?: string }>()
  const agentRows = new Map<string, ClaudeNativeJournalEntry>()
  let lastTaskSnapshot = ''
  let stopped = false, journalPending = false, inFlight: Promise<void> | undefined, lastMetadata = '', problem: string | undefined
  const initial = repository.chatQueries.threadData(threadId)
  const toolIds = new Set<string>(), toolCounts = new Map<string, number>()
  if (initial?.context?.claudeCode?.sessionId) toolCounts.set(initial.context.claudeCode.sessionId, initial.context.claudeCode.toolCallCount ?? 0)
  let lastTurnAt = initial?.context?.claudeCode?.lastTurnAt as number | undefined
  for (const message of initial?.messages ?? []) {
    if (!message.id) continue
    const context = object(message.context), terminal = object(context?.claudeTerminalMessage)
    const sessionId = typeof terminal?.sessionId === 'string' ? terminal.sessionId : initial?.context?.claudeCode?.sessionId
    for (const block of message.blocks ?? []) {
      if (block.type !== 'tool-activity' || !sessionId) continue
      const entries = object(block.props)?.entries
      if (Array.isArray(entries)) for (const value of entries) {
        const tool = object(value)
        if (typeof tool?.id === 'string') toolIds.add(JSON.stringify([sessionId, tool.id]))
      }
    }
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
        if (item.tool === 'Agent') { agentRows.set(key, entry); const input = object(item.details?.input); if (typeof input?.description === 'string') item.summary = input.description }
        const result = results.get(JSON.stringify([row.sessionId, item.id]))
        if (item.tool === 'Agent' && result?.agentId && result.assistantUuid === row.uuid && owner.state.sessionId === row.sessionId) {
          const agent = owner.state.tasks.find(agent => agent.id === result.agentId)
          if (agent) item.nativeAgent = { ...agent, ownerId: owner.state.ownerId, sessionId: owner.state.sessionId }
        }
        if (result?.uuid) item.nativeResult = { uuid: result.uuid, sessionId: row.sessionId }
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
        // Journal reads advance their cursor. Persist rows before fallible dialog RPCs.
        for (const entry of batch.entries) {
          const message = object(entry.row.message)
          if (entry.row.isSidechain === true || entry.row.agentId !== undefined || entry.row.parent_tool_use_id) continue
          if (entry.row.type === 'user' && Array.isArray(message?.content)) {
            for (const value of message.content) {
              const block = object(value)
              if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
              const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map(object).filter(value => value?.type === 'text').map(value => value?.text).join('\n') : ''
              const nativeResult = object(entry.row.toolUseResult)
              const singleResult = message.content.filter(value => object(value)?.type === 'tool_result').length === 1
              const agentId = singleResult && typeof nativeResult?.agentId === 'string' && nativeResult.agentId.length > 0 && nativeResult.agentId.length <= 256 ? nativeResult.agentId : undefined
              results.set(JSON.stringify([entry.sessionId, block.tool_use_id]), { text, error: block.is_error === true, ...(typeof entry.row.uuid === 'string' ? { uuid: entry.row.uuid } : {}),
                ...(agentId && typeof entry.row.sourceToolAssistantUUID === 'string' ? { agentId, assistantUuid: entry.row.sourceToolAssistantUUID } : {}) })
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
        const taskSnapshot = JSON.stringify([owner.state.sessionId, owner.state.tasks])
        if (taskSnapshot !== lastTaskSnapshot) {
          lastTaskSnapshot = taskSnapshot
          for (const entry of agentRows.values()) upsert(entry)
        }
        await owner.refreshNotice()
        const workflows = await owner.getWorkflowDialogs()
        const reads = await owner.getFileDialogs()
        const bashes = await owner.getBashDialogs()
        const questions = await owner.getQuestionDialogs()
        const plans = await owner.getPlanDialogs()
        if (!current() || !repository.threadQueries.byId(threadId)) return
        const dialogThread = repository.threadQueries.byId(threadId)!
        const priorControl = object(dialogThread.context?.claudeCode?.pendingControlRequest)
        const dialog = workflows.at(0) ?? reads.at(0) ?? bashes.at(0) ?? questions.at(0) ?? plans.at(0)
        const nativeControl = object(priorControl?.nativeTerminal)
        const sameDialog = nativeControl && dialog && nativeControl.ownerId === owner.state.ownerId && nativeControl.sessionId === dialog.sessionId && nativeControl.dialogId === dialog.id && nativeControl.revision === dialog.revision
        if (nativeControl && !sameDialog && typeof priorControl?.approvalMessageId === 'string') {
          updateMessageState(priorControl.approvalMessageId as EntityId, { responseTimestamp: Date.now(), blockResponse: { cancelled: true } })
        }
        if (!priorControl || nativeControl && !sameDialog) {
          let pendingControlRequest = nativeControl ? undefined : priorControl
          if (dialog && dialog.sessionId === owner.state.sessionId) {
            const isWorkflow = dialog.toolName === 'Workflow'
            const isPlan = dialog.toolName === 'EnterPlanMode' || dialog.toolName === 'ExitPlanMode'
            const isFile = dialog.toolName === 'Read' || dialog.toolName === 'Write' || dialog.toolName === 'Edit'
            const isToolApproval = dialog.toolName !== 'AskUserQuestion'
            const question = isWorkflow ? 'Run this dynamic workflow?' : isPlan ? dialog.toolName === 'EnterPlanMode' ? 'Enter plan mode?' : 'Review this plan before continuing' : isToolApproval ? isFile ? dialog.question : 'Run this shell command?' : undefined
            const input = isToolApproval ? dialog.input : dialog.shownInput
            const title = isWorkflow ? 'Review workflow' : isPlan ? dialog.toolName === 'EnterPlanMode' ? 'Enter plan mode' : 'Review plan' : isToolApproval ? 'title' in dialog ? dialog.title : 'description' in dialog ? dialog.description ?? 'Run shell command' : 'Claude Code needs a decision' : typeof input.title === 'string' ? input.title : 'Claude Code has questions'
            const message = isToolApproval ? sendBlockMessage({ threadId, text: title, blocks: [
              { type: 'prompt', props: { content: question } },
              { type: 'tool-input', props: { toolName: dialog.toolName, input } },
              { type: 'approval', props: { requireReason: false, allowReason: true, autoAcceptOption: false } },
            ], forkable: false, autoHide: true, asUser: true }) : sendBlockMessage({ threadId, text: title,
              blocks: [{ type: 'prompt', props: { content: Array.isArray(input.questions) ? input.questions.map(value => object(value)?.question).filter(value => typeof value === 'string').join('\n\n') : title } }], forkable: false })
            if (!isToolApproval) updateMessageState(message.messageId, { context: { claudeNativeQuestion: { sessionId: dialog.sessionId, dialogId: dialog.id, ownerId: owner.state.ownerId } } })
            pendingControlRequest = { requestId: dialog.revision, approvalMessageId: message.messageId, toolName: dialog.toolName, originalInput: input,
              nativeTerminal: { ownerId: owner.state.ownerId, sessionId: dialog.sessionId, dialogId: dialog.id, revision: dialog.revision, requestId: dialog.requestId,
                title, ...(isWorkflow ? { workflow: dialog.presentation } : {}), ...(isToolApproval ? { question, reason: dialog.reason, ...(isFile ? { ...(dialog.review ? { review: dialog.review } : {}), file: dialog.approval } : {}), ...(isPlan ? { plan: dialog.presentation } : {}), ...(dialog.toolName === 'Bash' ? { cwd: dialog.cwd, ...(dialog.choices && dialog.choiceToken ? { bash: { choices: dialog.choices, token: dialog.choiceToken } } : {}) } : {}) } : { presentation: dialog.presentation }) } }
          }
          if (pendingControlRequest !== priorControl) {
            const context = { ...dialogThread.context, claudeCode: { ...dialogThread.context?.claudeCode, pendingControlRequest } }
            repository.threadCommands.update(threadId, { context })
            broadcastToPlugin('threads', { type: 'THREAD_UPDATED', threadId, updates: { context } })
          }
        }
        if (sameDialog && dialog?.toolName === 'Bash' && nativeControl && priorControl && object(nativeControl.bash)?.token !== dialog.choiceToken) {
          const context = { ...dialogThread.context, claudeCode: { ...dialogThread.context?.claudeCode,
            pendingControlRequest: { ...priorControl, nativeTerminal: { ...nativeControl, bash: dialog.choices && dialog.choiceToken ? { choices: dialog.choices, token: dialog.choiceToken } : undefined } } } }
          repository.threadCommands.update(threadId, { context })
          broadcastToPlugin('threads', { type: 'THREAD_UPDATED', threadId, updates: { context } })
        }
        if (sameDialog && dialog && ['Read', 'Write', 'Edit'].includes(dialog.toolName) && nativeControl && priorControl && 'approval' in dialog && object(nativeControl.file)?.token !== dialog.approval?.token) {
          const context = { ...dialogThread.context, claudeCode: { ...dialogThread.context?.claudeCode,
            pendingControlRequest: { ...priorControl, nativeTerminal: { ...nativeControl, file: dialog.approval } } } }
          repository.threadCommands.update(threadId, { context })
          broadcastToPlugin('threads', { type: 'THREAD_UPDATED', threadId, updates: { context } })
        }
        if (sameDialog && dialog?.toolName === 'Workflow' && nativeControl && priorControl && object(nativeControl.workflow)?.token !== dialog.presentation.token) {
          const context = { ...dialogThread.context, claudeCode: { ...dialogThread.context?.claudeCode, pendingControlRequest: { ...priorControl, nativeTerminal: { ...nativeControl, workflow: dialog.presentation } } } }
          repository.threadCommands.update(threadId, { context })
          broadcastToPlugin('threads', { type: 'THREAD_UPDATED', threadId, updates: { context } })
        }
        const state = owner.state, metadata = state.session
        const working = owner.busy || state.status === 'live' && !!state.activity && (state.activity.pendingAgents > 0 || state.activity.pendingWorkflows > 0)
        const snapshot = JSON.stringify([state.sessionId, metadata, working, state.status, state.lastTurn, problem, lastTurnAt, toolCounts.get(state.sessionId), object(repository.threadQueries.byId(threadId)?.context?.claudeCode?.pendingControlRequest)?.requestId])
        if (snapshot === lastMetadata) return
        lastMetadata = snapshot
        const nativeLaunch = await readLaunch()
        if (!current()) return
        const thread = repository.threadQueries.byId(threadId)
        if (!thread) return
        const prior = thread.context?.claudeCode ?? {}
        const previous = Array.isArray(prior.previousSessionIds) ? prior.previousSessionIds : []
        const nativeError = state.lastTurn?.reason === 'error' ? 'Native Claude turn failed; details remain in the native interface' : state.lastTurn?.reason === 'refusal' ? 'Native Claude refused the turn' : undefined
        const chatState = problem || nativeError || state.status === 'error' ? 'error' : object(prior.pendingControlRequest)?.nativeTerminal ? 'paused' : working ? 'working' : state.status === 'exited' || state.lastTurn?.reason === 'aborted' ? 'paused' : 'success'
        const context = { ...thread.context, claudeCode: { ...prior, sessionId: state.sessionId, ...(nativeLaunch?.sessionId === state.sessionId ? {nativeLaunch} : {}),
          ...(prior.sessionId && prior.sessionId !== state.sessionId ? { previousSessionIds: [...new Set([...previous, prior.sessionId])] } : {}),
          ...(metadata ? { model: metadata.model, modelOverride: owner.modelSelection ?? prior.modelOverride, cwd: metadata.cwd, ...(metadata.permissionMode ? { permissionMode: metadata.permissionMode } : {}), turns: metadata.turns, startedAt: metadata.startedAt, ...(metadata.totalCostUsd !== undefined ? { totalCostUsd: metadata.totalCostUsd } : {}) } : {}),
          toolCallCount: toolCounts.get(state.sessionId) ?? 0, ...(lastTurnAt !== undefined ? { lastTurnAt } : {}), chatState, sessionError: problem ?? nativeError } }
        repository.threadCommands.update(threadId, { context })
        broadcastToPlugin('threads', { type: 'THREAD_UPDATED', threadId, updates: { context } })
        if (state.status === 'live' && metadata?.permissionMode && metadata.permissionMode !== prior.permissionMode
          && (metadata.permissionMode === 'plan' || prior.permissionMode === 'plan')) {
          broadcastToPlugin('threads', { type: 'SET_PHASE', threadId, phase: metadata.permissionMode === 'plan' ? 'Plan' : 'Edit' })
        }
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
