import { registerThreadHistoryValidator } from '#features/threads/be/history-operation.ts'
import { repository } from '#generated/repository.ts'
import { services } from '#generated/services.ts'
import type { EntityId } from '#generated/services.ts'

registerThreadHistoryValidator(async (request, signal) => {
  const thread = repository.threadQueries.byId(request.threadId as EntityId)
  const state = thread?.context?.claudeCode
  const messages = repository.chatQueries.threadData(request.threadId as EntityId)?.messages ?? []
  if (!state && !messages.some(message => message.context?.cliUuid || message.context?.agent === 'Claude Code')) return
  const pivot = messages.findIndex(message => message.id === request.messageId)
  if (pivot < 0) throw new Error('The selected history message is unavailable.')
  if (request.kind !== 'fork' && !messages.slice(pivot).some(message => message.context?.cliUuid || message.context?.agent === 'Claude Code')) return
  if (!state?.sessionId) {
    if (messages.some(message => message.context?.cliUuid)) throw new Error('The native session for this history is unavailable.')
    return
  }
  if (!await services.cli.claudeCode.closeIdleConversation(request.threadId)) throw new Error('Pause the current turn before changing history.')
  if (state.isRunning || services.cli.claudeCode.getHandle(request.threadId)) throw new Error('Pause the current turn before changing history.')
  if (request.restoreFiles) {
    if (!state.cwd) throw new Error('The native session project directory is unavailable.')
    const recordedId = messages[pivot].context?.cliUuid
    if (typeof recordedId === 'string' && request.userMessageId && recordedId !== request.userMessageId) throw new Error('The file checkpoint identity changed. Retry from the current message.')
    const userMessageId = recordedId ?? request.userMessageId
    if (typeof userMessageId !== 'string' || !userMessageId.trim()) throw new Error('No native file checkpoint identity is recorded for this message.')
    const preview = await services.cli.claudeCode.getFileRewindPreview({sessionId: state.sessionId, userMessageId, cwd: state.cwd, signal})
    if (!preview.canRewind) throw new Error(preview.error ?? 'The native file checkpoint is unavailable.')
  }
  const prefix = messages.slice(0, pivot + (request.kind === 'fork' ? 1 : 0))
  const assistant = [...prefix].reverse().find(message => message.sender === 'assistant' && typeof message.context?.cliUuid === 'string')
  if (!assistant) {
    if (request.kind === 'revert') return // No native assistant prefix: the next turn explicitly starts fresh.
    throw new Error('No native assistant checkpoint exists before this point.')
  }
  if (!state.cwd) throw new Error('The native session project directory is unavailable.')
  await services.cli.claudeCode.validateResumeTarget({sessionId: state.sessionId, messageUuid: assistant.context!.cliUuid as string, cwd: state.cwd, signal})
})
