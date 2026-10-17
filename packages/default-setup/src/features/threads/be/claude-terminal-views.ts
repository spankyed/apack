import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import type { ClaudeNativeSubmissionReceipt } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'

export type ClaudeTerminalViewRequest = { threadId: string; mountId: string } & (
  | { type: 'CLAUDE_TERMINAL_MOUNT' }
  | { type: 'CLAUDE_TERMINAL_UNMOUNT' }
  | { type: 'CLAUDE_TERMINAL_OPEN' }
  | { type: 'CLAUDE_TERMINAL_SUBMIT'; ownerId: string; revision: number; text: string }
  | { type: 'CLAUDE_TERMINAL_INPUT'; ownerId: string; text: string }
  | { type: 'CLAUDE_TERMINAL_RESIZE'; ownerId: string; columns: number; rows: number }
  | { type: 'CLAUDE_TERMINAL_CLOSE'; ownerId: string }
)
export interface ClaudeTerminalSubmissionState {
  ownerId: string
  revision: number
  status: 'pending' | 'accepted' | 'rejected'
  receipt?: ClaudeNativeSubmissionReceipt
  problem?: string
}
export type ClaudeTerminalViewSnapshot = {
  submission?: ClaudeTerminalSubmissionState
  state?: ClaudeNativeTerminalState
  opening: boolean
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
  problem?: string
  queued?: boolean
  submission?: ClaudeTerminalSubmissionState
  submissionRevision?: number
}

/** Window leases own subscriptions; detaching a view never stops the native session. */
export function createClaudeTerminalViews(dependencies: {
  get(threadId: string): ClaudeNativeTerminalOwner | undefined
  open(threadId: string): Promise<ClaudeNativeTerminalOwner>
}) {
  const views = new Map<string, View>()
  let timer: ReturnType<typeof setInterval> | undefined
  function drop(key: string) {
    views.get(key)?.unsubscribe?.(); views.delete(key)
    if (!views.size && timer) { clearInterval(timer); timer = undefined }
  }
  function publish(key: string, view: View) {
    if (views.get(key) !== view) return
    const output = view.owner?.output.filter(chunk => chunk.sequence > view.sequence) ?? []
    try {
      view.send({ type: 'CLAUDE_TERMINAL_STATE', threadId: view.threadId, mountId: view.mountId,
        state: view.owner?.state, submission: view.submission, opening: view.opening, problem: view.problem, output: [...output] })
      if (output.length) view.sequence = output.at(-1)!.sequence
    } catch { drop(key) }
  }
  function attach(key: string, view: View, owner: ClaudeNativeTerminalOwner) {
    if (view.owner === owner) return
    view.unsubscribe?.(); view.owner = owner; view.sequence = 0; view.submission = undefined; view.submissionRevision = 0
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
        target.opening = true; target.problem = undefined; publish(key, target)
        void dependencies.open(event.threadId).then(owner => {
          if (views.get(key) === target) attach(key, target, owner)
        }).catch(error => { target.problem = error instanceof Error ? error.message : 'Native interface could not start' })
          .finally(() => { target.opening = false; publish(key, target) })
        return
      }
      const owner = dependencies.get(event.threadId)
      if (!owner || owner !== target.owner || event.ownerId !== owner.state.ownerId) return
      if (event.type === 'CLAUDE_TERMINAL_SUBMIT') {
        if (!Number.isSafeInteger(event.revision) || event.revision <= (target.submissionRevision ?? 0)
          || target.submission?.status === 'pending' || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 32768) return
        target.submissionRevision = event.revision
        const submission: ClaudeTerminalSubmissionState = { ownerId: event.ownerId, revision: event.revision, status: 'pending' }
        target.submission = submission; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.submission === submission
        void Promise.resolve().then(() => {
          if (!current()) return undefined
          return owner.submit(event.text)
        }).then(receipt => {
          if (!current() || !receipt) return
          if (receipt.sessionId !== owner.state.sessionId) throw new Error('Native prompt receipt belongs to another session')
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
