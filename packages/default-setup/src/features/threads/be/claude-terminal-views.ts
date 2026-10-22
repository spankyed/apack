import { randomUUID } from 'node:crypto'
import type { MessageReferences } from './types.ts'
import type { ClaudeNativeImage } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import type { ClaudeNativeSubmissionReceipt } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'

export type ClaudeTerminalViewRequest = { threadId: string; mountId: string } & (
  | { type: 'CLAUDE_TERMINAL_MOUNT' }
  | { type: 'CLAUDE_TERMINAL_UNMOUNT' }
  | { type: 'CLAUDE_TERMINAL_OPEN' }
  | { type: 'CLAUDE_TERMINAL_CANCEL_OPEN'; openingId: string }
  | { type: 'CLAUDE_TERMINAL_SUBMIT'; ownerId: string; revision: number; text: string; references?: MessageReferences; phase?: 'Plan' | 'Edit' }
  | { type: 'CLAUDE_TERMINAL_INPUT'; ownerId: string; text: string }
  | { type: 'CLAUDE_TERMINAL_RESIZE'; ownerId: string; columns: number; rows: number }
  | ({ type: 'CLAUDE_TERMINAL_TASK'; ownerId: string; revision: number; taskId: string } & ({ operation: 'inspect' | 'stop' | 'foreground' | 'background' | 'pause_workflow' | 'resume_workflow' } | { operation: 'send' | 'input'; text: string } | { operation: 'skip_worker' | 'retry_worker'; worker: import('#features/code/common/native-terminal.ts').ClaudeNativeWorkflowWorkerTarget }))
  | { type: 'CLAUDE_TERMINAL_NOTICE'; ownerId: string; notice: import('#features/code/common/native-notice.ts').ClaudeNativeNoticeResponse }
  | { type: 'CLAUDE_TERMINAL_MCP_FORM'; ownerId: string; sequence: number; request: import('#features/code/common/native-mcp-form.ts').ClaudeNativeMcpFormRequest }
  | { type: 'CLAUDE_TERMINAL_CLOSE'; ownerId: string }
)
export interface ClaudeTerminalTaskState {
  ownerId: string
  taskId: string
  revision: number
  operation: 'inspect' | 'stop' | 'send' | 'input' | 'foreground' | 'background' | 'skip_worker' | 'retry_worker' | 'pause_workflow' | 'resume_workflow'
  status: 'pending' | 'done' | 'error'
  view?: { taskId: string | null }
  paused?: boolean
  resume?: { taskId: string; runId: string; requested: true }
  worker?: import('#features/code/common/native-terminal.ts').ClaudeNativeWorkflowWorkerReceipt
  input?: import('#features/code/common/native-terminal.ts').ClaudeNativeTaskInputReceipt
  sent?: boolean
  details?: import('#features/code/common/native-terminal.ts').ClaudeNativeTaskDetails
  problem?: string
}
export interface ClaudeTerminalSubmissionState {
  ownerId: string
  revision: number
  status: 'pending' | 'accepted' | 'rejected'
  receipt?: ClaudeNativeSubmissionReceipt
  command?: import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeParentCommandResult
  problem?: string
}
export type ClaudeTerminalViewSnapshot = {
  mcpOperation?: { sequence: number; status: 'pending' | 'done' | 'error'; problem?: string }
  noticeAnswer?: { id: string; revision: string; status: 'pending' | 'done' | 'error'; problem?: string }
  task?: ClaudeTerminalTaskState
  submission?: ClaudeTerminalSubmissionState
  state?: ClaudeNativeTerminalState
  opening: boolean
  openingId?: string
  cancelling?: boolean
  problem?: string
  output: { sequence: number; text: string }[]
}
export type ClaudeTerminalViewReply = ClaudeTerminalViewSnapshot & {
  type: 'CLAUDE_TERMINAL_STATE'
  threadId: string
  mountId: string
}
interface View {
  client: string
  threadId: string
  mountId: string
  expires: number
  send(reply: ClaudeTerminalViewReply): void
  owner?: ClaudeNativeTerminalOwner
  unsubscribe?: () => void
  sequence: number
  opening: boolean
  launch?: {id: string; abort: AbortController}
  problem?: string
  queued?: boolean
  mcpOperation?: ClaudeTerminalViewSnapshot['mcpOperation']
  noticeAnswer?: ClaudeTerminalViewSnapshot['noticeAnswer']
  task?: ClaudeTerminalTaskState
  submission?: ClaudeTerminalSubmissionState
  submissionRevision?: number
}

/** Window leases own subscriptions; detaching a view never stops the native session. */
export function createClaudeTerminalViews(dependencies: {
  get(threadId: string): ClaudeNativeTerminalOwner | undefined
  open(threadId: string, signal: AbortSignal): Promise<ClaudeNativeTerminalOwner>
  accepted?(owner: ClaudeNativeTerminalOwner, receipt: ClaudeNativeSubmissionReceipt, references: MessageReferences): void
  beforeViewChange?(client: string, threadId: string): Promise<void | (() => void)>
  command?(client: string, threadId: string, mountId: string, revision: number, text: string, hasReferences: boolean): Promise<import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeParentCommandResult>
  prepareInput?(text: string, references?: MessageReferences): Promise<{ text: string; images: ClaudeNativeImage[] }>
}) {
  const views = new Map<string, View>()
  let timer: ReturnType<typeof setInterval> | undefined
  function drop(key: string) {
    views.get(key)?.launch?.abort.abort()
    views.get(key)?.unsubscribe?.(); views.delete(key)
    if (!views.size && timer) { clearInterval(timer); timer = undefined }
  }
  function publish(key: string, view: View) {
    if (views.get(key) !== view) return
    const output = view.owner?.output.filter(chunk => chunk.sequence > view.sequence) ?? []
    try {
      view.send({ type: 'CLAUDE_TERMINAL_STATE', threadId: view.threadId, mountId: view.mountId,
        state: view.owner?.state, mcpOperation: view.mcpOperation, noticeAnswer: view.noticeAnswer, task: view.task, submission: view.submission, opening: view.opening, openingId: view.launch?.id, cancelling: view.launch?.abort.signal.aborted, problem: view.problem, output: [...output] })
      if (output.length) view.sequence = output.at(-1)!.sequence
    } catch { drop(key) }
  }
  function attach(key: string, view: View, owner: ClaudeNativeTerminalOwner) {
    if (view.owner === owner) return
    view.unsubscribe?.(); view.owner = owner; view.sequence = 0; view.submission = undefined; view.submissionRevision = 0; view.task = undefined; view.noticeAnswer = undefined; view.mcpOperation = undefined
    view.unsubscribe = owner.subscribe(() => {
      if (view.queued) return
      view.queued = true
      queueMicrotask(() => { view.queued = false; publish(key, view) })
    })
  }
  return {
    handle(event: ClaudeTerminalViewRequest, client: string | undefined, send: ((reply: ClaudeTerminalViewReply) => void) | undefined) {
      if (!client || !send || !/^[0-9a-f-]{36}$/i.test(event.mountId) || !event.threadId || event.threadId.length > 256) return
      const key = JSON.stringify([client, event.mountId])
      let view = views.get(key)
      if (view && view.threadId !== event.threadId) return
      if (view && view.expires <= Date.now()) { drop(key); view = undefined }
      if (event.type === 'CLAUDE_TERMINAL_UNMOUNT') { drop(key); return }
      if (event.type === 'CLAUDE_TERMINAL_MOUNT') {
        if (!view) {
          if (views.size >= 256 || [...views.values()].filter(value => value.client === client).length >= 16) return
          view = { client, threadId: event.threadId, mountId: event.mountId, expires: 0, send, sequence: 0, opening: false }
          views.set(key, view)
        }
        view.send = send; view.expires = Date.now() + 30000
        const owner = dependencies.get(event.threadId)
        if (owner) attach(key, view, owner)
        publish(key, view)
        timer ??= setInterval(() => { for (const [id, entry] of views) if (entry.expires <= Date.now()) drop(id) }, 1000)
        timer.unref?.()
        return
      }
      if (!view) return
      const target = view
      if (event.type === 'CLAUDE_TERMINAL_OPEN') {
        if (target.opening) return
        const existing = dependencies.get(event.threadId)
        if (existing) { attach(key, target, existing); publish(key, target); return }
        const launch = {id: randomUUID(), abort: new AbortController()}
        target.launch = launch; target.opening = true; target.problem = undefined; publish(key, target)
        void dependencies.open(event.threadId, launch.abort.signal).then(async owner => {
          if (launch.abort.signal.aborted) {
            if (dependencies.get(event.threadId) === owner) { await owner.close(); await owner.done }
            return
          }
          if (views.get(key) === target && target.launch === launch) attach(key, target, owner)
        }).catch(error => { target.problem = launch.abort.signal.aborted ? 'Native startup cancelled' : error instanceof Error ? error.message : 'Native interface could not start' })
          .finally(() => { if (target.launch === launch) { target.launch = undefined; target.opening = false; publish(key, target) } })
        return
      }
      if (event.type === 'CLAUDE_TERMINAL_CANCEL_OPEN') {
        if (target.opening && target.launch?.id === event.openingId) { target.launch.abort.abort(); publish(key, target) }
        return
      }
      const owner = dependencies.get(event.threadId)
      if (!owner || owner !== target.owner || event.ownerId !== owner.state.ownerId) return
      if (event.type === 'CLAUDE_TERMINAL_MCP_FORM') {
        if (!Number.isSafeInteger(event.sequence) || event.sequence <= (target.mcpOperation?.sequence ?? 0) || target.mcpOperation?.status === 'pending') return
        const operation: NonNullable<ClaudeTerminalViewSnapshot['mcpOperation']> = { sequence: event.sequence, status: 'pending' }
        target.mcpOperation = operation; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.mcpOperation === operation
        void Promise.resolve().then(() => { if (current()) return owner.operateMcpForm(event.request) }).then(() => {
          if (current()) { target.mcpOperation = { ...operation, status: 'done' }; publish(key, target) }
        }).catch(error => {
          if (current()) { target.mcpOperation = { ...operation, status: 'error', problem: error instanceof Error ? error.message : 'Native MCP form action failed' }; publish(key, target) }
        })
        return
      }
      if (event.type === 'CLAUDE_TERMINAL_NOTICE') {
        const notice = owner.state.notice, response = event.notice
        if (!notice || !response || notice.id !== response.id || notice.revision !== response.revision || notice.sessionId !== response.sessionId || !['continue', 'interrupt'].includes(response.decision) || target.noticeAnswer?.status === 'pending') return
        const answer: NonNullable<ClaudeTerminalViewSnapshot['noticeAnswer']> = { id: response.id, revision: response.revision, status: 'pending' }
        target.noticeAnswer = answer; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.noticeAnswer === answer
        void owner.answerNotice(response).then(() => { if (current()) { target.noticeAnswer = { ...answer, status: 'done' }; publish(key, target) } }).catch(error => { if (current()) { target.noticeAnswer = { ...answer, status: 'error', problem: error instanceof Error ? error.message : 'Native notice decision failed' }; publish(key, target) } })
        return
      }
      if (event.type === 'CLAUDE_TERMINAL_TASK') {
        if (typeof event.taskId !== 'string' || !event.taskId || event.taskId.length > 256 || !['inspect', 'stop', 'send', 'input', 'foreground', 'background', 'skip_worker', 'retry_worker', 'pause_workflow', 'resume_workflow'].includes(event.operation) || !Number.isSafeInteger(event.revision) || event.revision <= (target.task?.revision ?? 0) || target.task?.status === 'pending' || event.operation !== 'background' && !owner.state.tasks.some(task => task.id === event.taskId)) return
        if ((event.operation === 'send' || event.operation === 'input') && (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 16384)) return
        if ((event.operation === 'skip_worker' || event.operation === 'retry_worker') && (typeof event.worker?.agentId !== 'string' || !event.worker.agentId || event.worker.agentId.length > 256 || typeof event.worker.token !== 'string' || !/^[a-f0-9]{64}$/.test(event.worker.token))) return
        const task: ClaudeTerminalTaskState = { ownerId: event.ownerId, taskId: event.taskId, revision: event.revision, operation: event.operation, status: 'pending', ...(target.task?.taskId === event.taskId ? { details: target.task.details } : {}) }
        target.task = task; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.task === task
        void Promise.resolve().then(async () => {
          const resume = event.operation === 'foreground' || event.operation === 'background' ? await dependencies.beforeViewChange?.(target.client, event.threadId) : undefined
          try {
            if (!current()) return undefined
            if (event.operation === 'skip_worker' || event.operation === 'retry_worker') return await owner.operateTask(event.taskId, event.operation, undefined, event.worker)
            return await ((event.operation === 'send' || event.operation === 'input') ? owner.operateTask(event.taskId, event.operation, event.text) : owner.operateTask(event.taskId, event.operation))
          } finally { resume?.() }
        }).then(result => {
          if (!result) return
          if (!current()) return
          if (event.operation === 'foreground' && result.view?.taskId !== event.taskId || event.operation === 'background' && result.view?.taskId !== null || event.operation === 'input' && !result.input || event.operation === 'send' && result.sent !== true || event.operation === 'stop' && result.stopped !== true || event.operation === 'inspect' && result.details?.taskId !== event.taskId) throw new Error('Native task response did not match')
          if ((event.operation === 'skip_worker' || event.operation === 'retry_worker') && (result.worker?.accepted !== true || result.worker.agentId !== event.worker.agentId || result.worker.operation !== event.operation)) throw new Error('Native worker response did not match')
          if (event.operation === 'pause_workflow' && result.paused !== true || event.operation === 'resume_workflow' && (result.resume?.requested !== true || result.resume.taskId !== event.taskId)) throw new Error('Native Workflow response did not match')
          target.task = { ...task, status: 'done', paused:result.paused,resume:result.resume, worker: result.worker, sent: result.sent, view: result.view, input: result.input, details: result.details ?? task.details }; publish(key, target)
        }).catch(error => {
          if (!current()) return
          target.task = { ...task, status: 'error', problem: error instanceof Error ? error.message : 'Native task operation failed' }; publish(key, target)
        })
      }
      else if (event.type === 'CLAUDE_TERMINAL_SUBMIT') {
        if (!Number.isSafeInteger(event.revision) || event.revision <= (target.submissionRevision ?? 0)
          || event.phase !== undefined && event.phase !== 'Plan' && event.phase !== 'Edit'
          || target.submission?.status === 'pending' || typeof event.text !== 'string' || !event.text.trim() && !Object.values(event.references ?? {}).some(value => value?.length) || event.text.length > 32768) return
        const references = event.references ? structuredClone(event.references) : undefined
        target.submissionRevision = event.revision
        const submission: ClaudeTerminalSubmissionState = { ownerId: event.ownerId, revision: event.revision, status: 'pending' }
        target.submission = submission; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.submission === submission
        void Promise.resolve().then(async () => {
          if (!current()) return undefined
          const command = event.text.trim() ? await dependencies.command?.(target.client, target.threadId, target.mountId, event.revision, event.text, !!references && Object.values(references).some(value => value?.length)) : undefined
          if (command && command.kind !== 'not_command') return { command }
          if (!current()) return undefined
          if (!dependencies.prepareInput && event.references && Object.values(event.references).some(value => value?.length)) throw new Error('Native references could not be prepared')
          const input = dependencies.prepareInput ? await dependencies.prepareInput(event.text, references) : { text: event.text, images: [] }
          if (!current()) return undefined
          if (event.phase !== undefined) return owner.submit(input.text, input.images.length ? input.images : undefined, event.phase)
          return input.images.length ? owner.submit(input.text, input.images) : owner.submit(input.text)
        }).then(result => {
          if (result && 'command' in result) {
            if (!current()) return
            target.submission = { ...submission, status: result.command.kind === 'blocked' ? 'rejected' : 'accepted', command: result.command, ...(result.command.kind === 'blocked' ? { problem: result.command.message } : {}) }; publish(key, target)
            return
          }
          const receipt = result
          if (!receipt || dependencies.get(event.threadId) !== owner) return
          if (receipt.sessionId !== owner.state.sessionId) throw new Error('Native prompt receipt belongs to another session')
          // Persistence follows the accepted owner, even if the submitting window detached.
          if (references) dependencies.accepted?.(owner, receipt, references)
          if (!current()) return
          target.submission = { ...submission, status: 'accepted', receipt }; publish(key, target)
        }).catch(error => {
          if (!current()) return
          target.submission = { ...submission, status: 'rejected', problem: error instanceof Error ? error.message : 'Native prompt could not be submitted' }; publish(key, target)
        })
      }
      else if (event.type === 'CLAUDE_TERMINAL_INPUT') owner.input(event.ownerId, event.text)
      else if (event.type === 'CLAUDE_TERMINAL_RESIZE') owner.resize(event.ownerId, event.columns, event.rows)
      else if (event.type === 'CLAUDE_TERMINAL_CLOSE') void owner.close().catch(error => {
        target.problem = error instanceof Error ? error.message : 'Native session could not stop'; publish(key, target)
      })
    },
    clear(threadId?: string) { for (const [key, view] of views) if (threadId === undefined || view.threadId === threadId) drop(key) },
  }
}
