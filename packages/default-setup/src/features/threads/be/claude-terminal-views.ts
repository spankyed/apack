import {claudeCreditRequest} from '#features/code/common/native-credit.ts'
import type {ClaudeBackgroundAttachment} from '#features/code/be/services/claude-code/background-attachment.ts'
import type {ClaudeBackgroundAttachmentSnapshot} from '#features/code/common/native-background.ts'
import type { ClaudeNativeContinuation } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeBackgroundSession, ClaudeBackgroundSessionRequest, ClaudeBackgroundReplyRequest, ClaudeBackgroundTurnInterruptRequest, ClaudeBackgroundUiTarget } from '#features/code/common/native-background.ts'
import { isClaudeNativeNoticeDecision } from '#features/code/common/native-notice.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CLAUDE_UI_TEXT_LIMIT_MESSAGE, CLAUDE_UI_TEXT_MAX_LENGTH } from '#features/code/be/services/claude-code/ui-text-limits.ts'
import type { MessageReferences } from './types.ts'
import type { ClaudeNativeImage } from '#features/code/be/services/claude-code/terminal-session.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import type { ClaudeNativeSubmissionReceipt } from '#features/code/be/services/claude-code/terminal-session.ts'
import { CLAUDE_STALE_DRAFT_MESSAGE, type ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'

const queuedDraftImage = z.object({
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(data => data.length % 4 === 0),
})

export type ClaudeQueuedPromptEdit = {
  threadId: string; mountId: string; ownerId: string; sessionId: string
  viewRevision: number; turnId: string; queueRevision: string; sequence: number; itemId: string
}

export type ClaudeTerminalViewRequest = { threadId: string; mountId: string } & (
  | { type: 'CLAUDE_TERMINAL_MOUNT'; queueComposer?: boolean }
  | { type: 'CLAUDE_TERMINAL_UNMOUNT' }
  | { type: 'CLAUDE_TERMINAL_OPEN' }
  | { type: 'CLAUDE_TERMINAL_CANCEL_OPEN'; openingId: string }
  | { type: 'CLAUDE_TERMINAL_SUBMIT'; ownerId: string; sessionId: string; revision: number; text: string; references?: MessageReferences; phase?: 'Plan' | 'Edit' }
  | { type: 'CLAUDE_TERMINAL_INPUT'; ownerId: string; text: string }
  | { type: 'CLAUDE_TERMINAL_RESIZE'; ownerId: string; columns: number; rows: number; cell?: {width:number;height:number} }
  | ({ type: 'CLAUDE_TERMINAL_TASK'; ownerId: string; sessionId: string; revision: number; taskId: string } & ({ operation: 'inspect' | 'stop' | 'foreground' | 'background' | 'pause_workflow' | 'resume_workflow' } | { operation: 'send' | 'input'; text: string } | { operation: 'skip_worker' | 'retry_worker'; worker: import('#features/code/common/native-terminal.ts').ClaudeNativeWorkflowWorkerTarget }))
  | ({ ownerId: string; sessionId: string; viewRevision: number; turnId: string; queueRevision: string; sequence: number } & (
      { type: 'CLAUDE_TERMINAL_QUEUE_SEND_NOW' } | { type: 'CLAUDE_TERMINAL_QUEUE_CANCEL'; itemId: string }
    ))
  | { type: 'CLAUDE_TERMINAL_QUEUE_EDIT_APPLIED'; ownerId: string; sessionId: string; itemId: string }
  | { type: 'CLAUDE_TERMINAL_POLICY_RECHECK'; ownerId: string; sessionId: string; viewRevision: number; taskId?: string }
  | { type: 'CLAUDE_TERMINAL_NOTICE'; ownerId: string; notice: import('#features/code/common/native-notice.ts').ClaudeNativeNoticeResponse }
  | { type: 'CLAUDE_TERMINAL_MCP_URL'; ownerId: string; sequence: number; request: import('#features/code/common/native-mcp-url.ts').ClaudeNativeMcpUrlRequest }
  | { type: 'CLAUDE_TERMINAL_MCP_FORM'; ownerId: string; sequence: number; request: import('#features/code/common/native-mcp-form.ts').ClaudeNativeMcpFormRequest }
  | ({ type: 'CLAUDE_TERMINAL_BACKGROUND'; sessionId: string; continuedInSessionId: string; revision: number } & (ClaudeBackgroundSessionRequest | ClaudeBackgroundReplyRequest | ClaudeBackgroundTurnInterruptRequest))
  | { type: 'CLAUDE_TEAMMATE_TERMINAL_OPEN'; ownerId: string; sessionId: string; taskId: string; revision: number; recoveryId?: string }
  | { type: 'CLAUDE_BACKGROUND_OPEN'; sessionId: string; continuedInSessionId: string; jobId: string; revision: number }
  | { type: 'CLAUDE_BACKGROUND_INPUT'; attachmentId: string; text: string }
  | { type: 'CLAUDE_BACKGROUND_RESIZE'; attachmentId: string; columns: number; rows: number; cell?: {width:number;height:number} }
  | { type: 'CLAUDE_BACKGROUND_CLOSE'; requestId: string }
  | { type: 'CLAUDE_TERMINAL_CLOSE'; ownerId: string }
)
export interface ClaudeTerminalTaskState {
  ownerId: string
  sessionId: string
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
export interface ClaudeTerminalStopState {
  ownerId: string
  revision: number
  status: 'pending' | 'done' | 'error'
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
export interface ClaudeBackgroundSessionState {
  sessionId: string
  continuedInSessionId: string
  revision: number
  operation: 'refresh' | 'stop' | 'reply' | 'interrupt'
  turn?: {id: string; cancelled: boolean}
  question?: {id: string; revision: string}
  approval?: {id: string; revision: string}
  desktop?: ClaudeBackgroundUiTarget
  status: 'pending' | 'done' | 'error'
  session?: ClaudeBackgroundSession
  problem?: string
}
export interface ClaudeBackgroundAttachmentView {
  requestId: string
  revision: number
  sessionId: string
  continuedInSessionId: string
  teammate?: { ownerId: string; taskId: string; recoveryId?: string }
  status: 'opening' | 'ready' | 'error'
  state?: ClaudeBackgroundAttachmentSnapshot
  problem?: string
}
export type ClaudeTeammateReconnect = {ownerId: string; sessionId: string; taskId: string; name: string; recoveryId?: string}
type TeammateReconnectAuthority = {
  target: ClaudeTeammateReconnect
  open(signal: AbortSignal): Promise<ClaudeBackgroundAttachment>
  available?(signal: AbortSignal): Promise<boolean>
}
type SurvivingTeammate = TeammateReconnectAuthority & {resumedOwnerId: string}
type ParkedTeammate = {
  owner: ClaudeNativeTerminalOwner
  reconnect: TeammateReconnectAuthority
  resumed?: SurvivingTeammate
  check?: AbortController
}
export type ClaudeTerminalViewSnapshot = {
  teammateReconnects?: ClaudeTeammateReconnect[]
  backgroundInfo?: import('#features/code/common/native-background.ts').ClaudeBackgroundStatus
  canReplyBackground?: boolean
  attachment?: ClaudeBackgroundAttachmentView
  background?: ClaudeBackgroundSessionState
  mcpOperation?: { sequence: number; status: 'pending' | 'done' | 'error'; problem?: string }
  queueOperation?: { sequence: number; sessionId: string; viewRevision: number; queueRevision: string; status: 'pending' | 'done' | 'error'; problem?: string }
  queueDraft?: { sessionId: string; id: string; text: string; images?: ClaudeNativeImage[]; automatic: boolean }
  policyRecheck?: { sessionId: string; viewRevision: number; status: 'pending' | 'done' | 'error'; problem?: string }
  noticeAnswer?: { id: string; revision: string; requestId?: string; status: 'pending' | 'done' | 'error'; problem?: string }
  task?: ClaudeTerminalTaskState
  stop?: ClaudeTerminalStopState
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
  queueComposer: boolean
  threadId: string
  mountId: string
  expires: number
  send(reply: ClaudeTerminalViewReply): void
  attachment?: ClaudeBackgroundAttachmentView
  attachmentRevision?: number
  teammateReconnects: Map<string, TeammateReconnectAuthority>
  survivingTeammates: Map<string, SurvivingTeammate>
  attachmentOwner?: ClaudeBackgroundAttachment
  attachmentAbort?: AbortController
  attachmentUnsubscribe?: () => void
  owner?: ClaudeNativeTerminalOwner
  backgroundUnsubscribe?: () => void
  unsubscribe?: () => void
  sequence: number
  opening: boolean
  launch?: {id: string; abort: AbortController}
  problem?: string
  queued?: boolean
  background?: ClaudeBackgroundSessionState
  desktopPreparation?: object
  desktopRetry?: boolean
  backgroundRegistration?: string
  mcpOperation?: ClaudeTerminalViewSnapshot['mcpOperation']
  queueOperation?: ClaudeTerminalViewSnapshot['queueOperation']
  policyRecheck?: ClaudeTerminalViewSnapshot['policyRecheck']
  noticeAnswer?: ClaudeTerminalViewSnapshot['noticeAnswer']
  task?: ClaudeTerminalTaskState
  stop?: ClaudeTerminalStopState
  submission?: ClaudeTerminalSubmissionState
  submissionRevision?: number
  draftSessionId?: string
}

/** Window leases own subscriptions; detaching a view never stops the native session. */
export function createClaudeTerminalViews(dependencies: {
  replyBackground?(continuation: ClaudeNativeContinuation, request: ClaudeBackgroundReplyRequest, threadId: string): Promise<ClaudeBackgroundSession | undefined>
  openAttachment?(continuation: ClaudeNativeContinuation, jobId: string, threadId: string, signal: AbortSignal): Promise<ClaudeBackgroundAttachment>
  continuation?(threadId: string): ClaudeNativeContinuation | undefined
  background?(continuation: ClaudeNativeContinuation, request: ClaudeBackgroundSessionRequest, threadId: string): Promise<ClaudeBackgroundSession | undefined>
  desktop?(continuation: ClaudeNativeContinuation, jobId: string, pid: number, threadId: string): Promise<ClaudeBackgroundUiTarget | undefined>
  backgroundApproval?(threadId: string, target: ClaudeBackgroundUiTarget): {id: string; revision: string} | undefined
  backgroundQuestion?(threadId: string, target: ClaudeBackgroundUiTarget): {id: string; revision: string} | undefined
  backgroundTurn?(threadId: string, target: ClaudeBackgroundUiTarget): {id: string; cancelled: boolean} | undefined
  interruptBackground?(threadId: string, request: ClaudeBackgroundTurnInterruptRequest): Promise<void>
  desktopCurrent?(threadId: string, target: ClaudeBackgroundUiTarget): boolean
  backgroundInfo?(threadId: string): import('#features/code/common/native-background.ts').ClaudeBackgroundStatus | undefined
  subscribeBackground?(threadId: string, changed: () => void): () => void
  restoreBackground?(threadId: string): Promise<void>
  savedSession?(threadId: string): string | undefined
  get(threadId: string): ClaudeNativeTerminalOwner | undefined
  open(threadId: string, signal: AbortSignal): Promise<ClaudeNativeTerminalOwner>
  accepted?(owner: ClaudeNativeTerminalOwner, receipt: ClaudeNativeSubmissionReceipt, references: MessageReferences): void
  beforeViewChange?(client: string, threadId: string): Promise<void | (() => void)>
  command?(client: string, threadId: string, mountId: string, revision: number, text: string, hasReferences: boolean): Promise<import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeParentCommandResult>
  prepareInput?(text: string, references?: MessageReferences): Promise<{ text: string; images: ClaudeNativeImage[] }>
}) {
  const views = new Map<string, View>()
  const parkedTeammates = new Map<string, Map<string, ParkedTeammate>>()
  let parkedSweep: ReturnType<typeof setInterval> | undefined
  function removeParkedTeammate(threadId: string, taskId: string) {
    const tasks = parkedTeammates.get(threadId)
    tasks?.get(taskId)?.check?.abort()
    tasks?.delete(taskId)
    if (!tasks?.size) parkedTeammates.delete(threadId)
    if (!parkedTeammates.size && parkedSweep) { clearInterval(parkedSweep); parkedSweep = undefined }
  }
  let sweepingParked = false
  async function sweepParkedTeammates() {
    if (sweepingParked) return
    sweepingParked = true
    try {
      for (const [threadId, tasks] of parkedTeammates) {
        for (const [taskId, parked] of tasks) {
          if (dependencies.savedSession && dependencies.savedSession(threadId) !== parked.reconnect.target.sessionId
            || parked.resumed && dependencies.get(threadId) !== parked.owner) {
            removeParkedTeammate(threadId, taskId)
            continue
          }
          const check = new AbortController()
          parked.check = check
          const available = await parked.reconnect.available?.(check.signal).catch(() => false)
          if (parkedTeammates.get(threadId)?.get(taskId) !== parked) continue
          parked.check = undefined
          if (!available) removeParkedTeammate(threadId, taskId)
        }
      }
    } finally { sweepingParked = false }
  }
  function parkTeammate(threadId: string, owner: ClaudeNativeTerminalOwner, reconnect: TeammateReconnectAuthority, resumed?: SurvivingTeammate) {
    // Closed windows release their PTYs. Keep only the capability to recheck and open a fresh one.
    if (!reconnect.available) return
    const taskId = reconnect.target.taskId
    const tasks = parkedTeammates.get(threadId) ?? new Map<string, ParkedTeammate>()
    tasks.get(taskId)?.check?.abort()
    tasks.set(taskId, {owner, reconnect, resumed})
    parkedTeammates.set(threadId, tasks)
    parkedSweep ??= setInterval(() => { void sweepParkedTeammates() }, 30000)
    parkedSweep.unref?.()
  }
  type QueueDraft = NonNullable<ClaudeTerminalViewSnapshot['queueDraft']>
  const queueDrafts = new WeakMap<ClaudeNativeTerminalOwner, {draft: QueueDraft; view?: View}>()
  const queueEditsInFlight = new WeakSet<ClaudeNativeTerminalOwner>()
  let timer: ReturnType<typeof setInterval> | undefined
  function retireAttachment(view: View) {
    view.attachmentAbort?.abort(); view.attachmentAbort = undefined
    view.attachmentUnsubscribe?.(); view.attachmentUnsubscribe = undefined
    void view.attachmentOwner?.close().catch(() => {})
    view.attachmentOwner = undefined; view.attachment = undefined
  }
  function teammateCrashCurrent(view: View, ownerId: string, sessionId: string) {
    const owner = view.owner, state = owner?.state, current = dependencies.get(view.threadId)
    return state?.ownerId === ownerId && state.sessionId === sessionId && state.status === 'error'
      && owner?.keepAttachedTeammatesAfterCrash === true && (!current || current === owner)
  }
  function teammateResumeMatches(view: View, target: ClaudeTeammateReconnect, replacement: ClaudeNativeTerminalOwner | undefined) {
    const state = view.owner?.state
    return replacement && replacement !== view.owner && replacement.state.sessionId === target.sessionId
      && state?.status === 'error' && view.owner?.keepAttachedTeammatesAfterCrash
      && state.ownerId === target.ownerId && state.sessionId === target.sessionId
  }
  function survivingTeammateCurrent(view: View, taskId: string) {
    const survivor = view.survivingTeammates.get(taskId)
    const state = view.owner?.state
    if (survivor && view.owner === dependencies.get(view.threadId) && state?.ownerId === survivor.resumedOwnerId
      && state.sessionId === survivor.target.sessionId && state.status === 'live') return survivor
  }
  function attachmentCurrent(view: View) {
    const target = view.attachment?.teammate
    if (target) {
      const owner = view.owner
      const state = owner?.state
      if (target.recoveryId) {
        const survivor = survivingTeammateCurrent(view, target.taskId)?.target
        if (survivor?.recoveryId !== target.recoveryId || survivor.taskId !== target.taskId) return false
        const client = view.attachmentOwner?.snapshot
        return view.attachment?.status !== 'ready' || client?.status === 'live' && client.inputBlocked !== true
          && client.jobId === survivor.taskId && client.sessionId === survivor.sessionId
      }
      if (state?.ownerId !== target.ownerId || state.sessionId !== view.attachment?.sessionId) return false
      const currentOwner = dependencies.get(view.threadId)
      if (state.status === 'live') {
        return owner === currentOwner && state.tasks.some(task => task.id === target.taskId && task.canStop)
      }
      if (!teammateCrashCurrent(view, target.ownerId, state.sessionId)) return false
      if (view.attachment?.status !== 'ready')
        return view.teammateReconnects.has(target.taskId)
      const client = view.attachmentOwner?.snapshot
      return client?.status === 'live' && client.inputBlocked !== true && client.jobId === target.taskId && client.sessionId === state.sessionId
    }
    const continuation = dependencies.continuation?.(view.threadId)
    return !!view.attachment && continuation?.sessionId === view.attachment.sessionId && continuation.continuedInSessionId === view.attachment.continuedInSessionId
  }
  function openAttachment<Client extends ClaudeBackgroundAttachment>(key: string, view: View, operation: ClaudeBackgroundAttachmentView,
    open: (signal: AbortSignal) => Promise<Client>, fallback: string,
    connected?: (client: Client) => void) {
    const abort = new AbortController()
    view.attachmentAbort = abort
    view.attachment = operation
    publish(key, view)
    const current = () => views.get(key) === view && view.attachment === operation && attachmentCurrent(view) && !abort.signal.aborted
    void Promise.resolve().then(() => current() ? open(abort.signal) : undefined).then(client => {
      if (!client) return
      if (!current()) { void client.close().catch(() => {}); return }
      view.attachmentOwner = client
      connected?.(client)
      operation.status = 'ready'
      view.attachmentUnsubscribe = client.subscribe(() => {
        if (views.get(key) === view && view.attachment === operation) publish(key, view)
      })
      publish(key, view)
    }, error => {
      if (!current()) return
      operation.status = 'error'
      operation.problem = error instanceof Error ? error.message : fallback
      publish(key, view)
    })
  }
  function drop(key: string, transferTeammate = true) {
    const view = views.get(key); if (view) retireAttachment(view)
    views.get(key)?.launch?.abort.abort()
    views.get(key)?.unsubscribe?.(); views.get(key)?.backgroundUnsubscribe?.(); views.delete(key)
    if (transferTeammate && view?.owner) {
      // Move verified crash reconnects together to another mount of the same owner.
      const continued = [...views].find(([, candidate]) => candidate.client !== view.client
        && candidate.threadId === view.threadId && candidate.owner === view.owner && candidate.expires > Date.now()
        && !candidate.queueComposer && !candidate.opening && !candidate.attachment)
      let moved = false
      for (const [taskId, reconnect] of view.teammateReconnects) {
        if (!teammateCrashCurrent(view, reconnect.target.ownerId, reconnect.target.sessionId)) continue
        if (continued) { continued[1].teammateReconnects.set(taskId, reconnect); moved = true }
        else parkTeammate(view.threadId, view.owner, reconnect)
      }
      if (continued && moved) publish(...continued)
      for (const taskId of view.survivingTeammates.keys()) {
        const survivor = survivingTeammateCurrent(view, taskId)
        if (survivor) parkTeammate(view.threadId, view.owner, survivor, survivor)
      }
    }
    const owner = view?.owner, recovered = owner && queueDrafts.get(owner)
    if (recovered && recovered.view === view) {
      recovered.view = undefined
      recovered.draft = {...recovered.draft, automatic: false}
      for (const [id, candidate] of views) if (candidate.owner === owner) publish(id, candidate)
    }
    if (!views.size && timer) { clearInterval(timer); timer = undefined }
  }
  function publish(key: string, view: View) {
    if (views.get(key) !== view) return
    const state = view.owner?.state
    const recovered = view.owner && queueDrafts.get(view.owner)
    let queueDraft: ClaudeTerminalViewSnapshot['queueDraft']
    if (view.queueComposer && recovered && recovered.draft.sessionId === state?.sessionId && state.view?.kind === 'main') {
      recovered.view ??= view
      if (recovered.view === view) queueDraft = recovered.draft
    }
    if (view.task && view.task.sessionId !== state?.sessionId) view.task = undefined
    if (view.submission?.status === 'pending' && view.draftSessionId && view.draftSessionId !== state?.sessionId) {
      view.submission = { ...view.submission, status: 'rejected', problem: CLAUDE_STALE_DRAFT_MESSAGE }
      view.draftSessionId = undefined
    }
    if (view.background?.desktop && !dependencies.desktopCurrent?.(view.threadId, view.background.desktop)) view.background.desktop = undefined
    if (view.background) {
      view.background.turn = view.background.desktop ? dependencies.backgroundTurn?.(view.threadId, view.background.desktop) : undefined
      const priorApproval = view.background.approval
      view.background.approval = view.background.desktop ? dependencies.backgroundApproval?.(view.threadId, view.background.desktop) : undefined
      const priorQuestion = view.background.question
      view.background.question = view.background.desktop ? dependencies.backgroundQuestion?.(view.threadId, view.background.desktop) : undefined
      if (priorQuestion && !view.background.question || priorApproval && !view.background.approval) refreshSettledControl(key, view)
    }
    const teammateReconnects: ClaudeTeammateReconnect[] = []
    for (const [taskId, {target}] of view.teammateReconnects) {
      if (teammateCrashCurrent(view, target.ownerId, target.sessionId)) teammateReconnects.push(target)
      else if (target.ownerId !== state?.ownerId || target.sessionId !== state.sessionId
        || (state.status === 'live' ? !state.tasks.some(task => task.id === taskId && task.canStop)
          : !teammateResumeMatches(view, target, dependencies.get(view.threadId)))) view.teammateReconnects.delete(taskId)
    }
    for (const [taskId, survivor] of view.survivingTeammates) {
      if (survivingTeammateCurrent(view, taskId)) teammateReconnects.push(survivor.target)
      else if (state?.status !== 'starting' || state.ownerId !== survivor.resumedOwnerId
        || state.sessionId !== survivor.target.sessionId) view.survivingTeammates.delete(taskId)
    }
    if (view.attachment && !attachmentCurrent(view)) retireAttachment(view)
    if (view.attachment && view.attachmentOwner) view.attachment.state = view.attachmentOwner.snapshot
    const output = view.owner?.output.filter(chunk => chunk.sequence > view.sequence) ?? []
    try {
      view.send({ type: 'CLAUDE_TERMINAL_STATE', backgroundInfo: dependencies.backgroundInfo?.(view.threadId), canReplyBackground: dependencies.get(view.threadId) ? dependencies.get(view.threadId)?.canReplyBackground === true : !!dependencies.replyBackground && !!dependencies.continuation?.(view.threadId), threadId: view.threadId, mountId: view.mountId,
        state, attachment: view.attachment ? {...view.attachment} : undefined, teammateReconnects: teammateReconnects.length ? teammateReconnects : undefined, background: view.background, mcpOperation: view.mcpOperation, queueOperation: view.queueOperation, queueDraft, policyRecheck: view.policyRecheck, noticeAnswer: view.noticeAnswer, task: view.task, stop: view.stop, submission: view.submission, opening: view.opening, openingId: view.launch?.id, cancelling: view.launch?.abort.signal.aborted, problem: view.problem, output: [...output] })
      if (output.length) view.sequence = output.at(-1)!.sequence
    } catch { drop(key) }
  }
  function refreshSettledControl(key: string, view: View) {
    const operation = view.background, desktop = operation?.desktop, session = operation?.session
    const continuation = dependencies.continuation?.(view.threadId)
    if (!operation || operation.status !== 'done' || !desktop || !session || !dependencies.background || !continuation
      || continuation.sessionId !== operation.sessionId || continuation.continuedInSessionId !== operation.continuedInSessionId) return
    void dependencies.background(continuation, {operation: 'refresh'}, view.threadId).then(fresh => {
      if (views.get(key) !== view || view.background !== operation || operation.desktop !== desktop || !dependencies.desktopCurrent?.(view.threadId, desktop)
        || !fresh || fresh.id !== session.id || fresh.sessionId !== desktop.jobSessionId || fresh.cwd !== session.cwd
        || fresh.pid !== desktop.pid && !['done', 'failed', 'stopped'].includes(fresh.state)) return
      operation.session = fresh
      if (!fresh.pid || !['working', 'blocked'].includes(fresh.state)) operation.desktop = undefined
      publish(key, view)
    }).catch(() => { /* Keep the last reported job; explicit Refresh remains available. */ })
  }
  function refreshRegisteredWorker(key: string, view: View) {
    const operation = view.background, session = operation?.session
    const info = dependencies.backgroundInfo?.(view.threadId)
    if (!operation || operation.status !== 'done' || !session || session.pid || !['working', 'blocked'].includes(session.state)
      || !info || info.sessionId !== operation.continuedInSessionId || info.jobId !== session.id || !dependencies.background) return
    const registration = JSON.stringify([operation.sessionId, info.sessionId, info.jobId, info.pid])
    if (view.backgroundRegistration === registration) return
    view.backgroundRegistration = registration
    const continuation = dependencies.continuation?.(view.threadId)
    if (!continuation || continuation.sessionId !== operation.sessionId || continuation.continuedInSessionId !== operation.continuedInSessionId) return
    const current = () => views.get(key) === view && view.background === operation
      && dependencies.continuation?.(view.threadId)?.sessionId === operation.sessionId
      && dependencies.continuation?.(view.threadId)?.continuedInSessionId === operation.continuedInSessionId
    void dependencies.background(continuation, {operation: 'refresh'}, view.threadId).then(fresh => {
      if (!current() || !fresh || fresh.id !== session.id || fresh.sessionId !== info.sessionId || fresh.pid !== info.pid || fresh.cwd !== session.cwd) return
      operation.session = fresh
      publish(key, view); prepareDesktop(key, view)
    }).catch(() => { /* Explicit Refresh remains available; do not retry each status tick. */ })
  }
  function prepareDesktop(key: string, view: View) {
    const operation = view.background, session = operation?.session
    const continuation = dependencies.continuation?.(view.threadId)
    if (views.get(key) !== view || !dependencies.desktop || !operation || operation.status !== 'done' || !session?.pid
      || !['working', 'blocked'].includes(session.state) || operation.desktop
      || continuation?.sessionId !== operation.sessionId || continuation.continuedInSessionId !== operation.continuedInSessionId) return
    if (view.desktopPreparation) { view.desktopRetry = true; return }
    const pending = {}; view.desktopPreparation = pending
    const current = () => views.get(key) === view && view.background === operation
      && dependencies.continuation?.(view.threadId)?.sessionId === continuation.sessionId
      && dependencies.continuation?.(view.threadId)?.continuedInSessionId === continuation.continuedInSessionId
    void Promise.resolve().then(() => current() ? dependencies.desktop!(continuation, session.id, session.pid!, view.threadId) : undefined).then(desktop => {
      if (current() && desktop) { operation.desktop = desktop; publish(key, view) }
    }).catch(() => { /* A later native registration can make this worker available. */ }).finally(() => {
      if (view.desktopPreparation !== pending) return
      view.desktopPreparation = undefined
      if (view.desktopRetry) { view.desktopRetry = false; prepareDesktop(key, view) }
    })
  }
  function attach(key: string, view: View, owner: ClaudeNativeTerminalOwner) {
    if (view.owner === owner) return
    // Recover the old terminal separately from the resumed owner's task registry. Mint a
    // new action for this mount so old task or terminal requests cannot cross the handoff.
    view.survivingTeammates.clear()
    if (!view.queueComposer) {
      for (const candidate of views.values()) {
        if (candidate.threadId !== view.threadId || candidate.expires <= Date.now()) continue
        for (const [taskId, reconnect] of candidate.teammateReconnects) {
          if (!teammateResumeMatches(candidate, reconnect.target, owner)) continue
          view.survivingTeammates.set(taskId, {
            ...reconnect, target: {...reconnect.target, recoveryId: randomUUID()}, resumedOwnerId:owner.state.ownerId,
          })
          candidate.teammateReconnects.delete(taskId)
        }
      }
    }
    view.teammateReconnects.clear()
    view.unsubscribe?.(); view.owner = owner; view.sequence = 0; view.submission = undefined; view.submissionRevision = 0; view.draftSessionId = undefined; view.task = undefined; view.noticeAnswer = undefined; view.mcpOperation = undefined; view.queueOperation = undefined; view.policyRecheck = undefined
    view.unsubscribe = owner.subscribe(() => {
      if (view.queued) return
      view.queued = true
      queueMicrotask(() => { view.queued = false; publish(key, view) })
    })
    // A reopened owner replaces the terminal authority for the entire thread.
    for (const [id, candidate] of views) {
      if (candidate !== view && candidate.threadId === view.threadId && candidate.owner !== owner && (candidate.attachment?.teammate || candidate.teammateReconnects.size || candidate.survivingTeammates.size)) publish(id, candidate)
    }
  }
  function restoreParkedTeammates(key: string, view: View, owner: ClaudeNativeTerminalOwner | undefined) {
    const parked = parkedTeammates.get(view.threadId)
    if (!parked || view.queueComposer) return
    for (const [taskId, entry] of parked) {
      const sessionId = entry.reconnect.target.sessionId
      if (dependencies.savedSession && dependencies.savedSession(view.threadId) !== sessionId
        || owner && owner.state.sessionId !== sessionId || entry.resumed && owner !== entry.owner) {
        removeParkedTeammate(view.threadId, taskId)
        continue
      }
      if (!view.owner) attach(key, view, owner ?? entry.owner)
      if (view.owner === entry.owner && !entry.resumed) {
        view.teammateReconnects.set(taskId, entry.reconnect)
      } else if (owner && (entry.resumed || entry.owner.state.status === 'error' && entry.owner.state.sessionId === sessionId
        && entry.owner.state.ownerId === entry.reconnect.target.ownerId && entry.owner.keepAttachedTeammatesAfterCrash)) {
        view.survivingTeammates.set(taskId, {
          ...entry.reconnect, target: {...entry.reconnect.target, recoveryId: randomUUID()}, resumedOwnerId:owner.state.ownerId,
        })
      } else continue
      removeParkedTeammate(view.threadId, taskId)
    }
  }
  return {
    handle(event: ClaudeTerminalViewRequest | (ClaudeQueuedPromptEdit & {type: 'EDIT_CLAUDE_QUEUED_PROMPT'}),
      client: string | undefined, send: ((reply: ClaudeTerminalViewReply) => void) | undefined, signal?: AbortSignal) {
      if (!client || !send || !/^[0-9a-f-]{36}$/i.test(event.mountId) || !event.threadId || event.threadId.length > 256) return
      const key = JSON.stringify([client, event.mountId])
      let view = views.get(key)
      if (view && view.threadId !== event.threadId) return
      if (view && view.expires <= Date.now()) { drop(key); view = undefined }
      if (event.type === 'CLAUDE_TERMINAL_UNMOUNT') { drop(key); return }
      if (event.type === 'CLAUDE_TERMINAL_MOUNT') {
        if (!view) {
          if (views.size >= 256 || [...views.values()].filter(value => value.client === client).length >= 16) return
          view = { client, queueComposer: event.queueComposer === true, threadId: event.threadId, mountId: event.mountId, expires: 0, send, sequence: 0, opening: false, teammateReconnects: new Map(), survivingTeammates: new Map() }
          views.set(key, view)
          const mounted = view
          view.backgroundUnsubscribe = dependencies.subscribeBackground?.(event.threadId, () => {
            publish(key, mounted)
            refreshRegisteredWorker(key, mounted)
            const info = dependencies.backgroundInfo?.(event.threadId), session = mounted.background?.session
            if (info && info.sessionId === mounted.background?.continuedInSessionId && info.jobId === session?.id && info.pid === session?.pid) prepareDesktop(key, mounted)
          })
          void dependencies.restoreBackground?.(event.threadId).then(()=>publish(key,mounted),error=>{if(views.get(key)===mounted){mounted.problem=error instanceof Error?error.message:'Background status recovery failed';publish(key,mounted)}})
        }
        view.send = send; view.expires = Date.now() + 30000
        const owner = dependencies.get(event.threadId)
        if (owner) attach(key, view, owner)
        restoreParkedTeammates(key, view, owner)
        publish(key, view)
        timer ??= setInterval(() => { for (const [id, entry] of views) if (entry.expires <= Date.now()) drop(id) }, 1000)
        timer.unref?.()
        return
      }
      if (!view) return
      const target = view
      if (event.type === 'CLAUDE_TEAMMATE_TERMINAL_OPEN' && event.recoveryId !== undefined) {
        const survivor = survivingTeammateCurrent(target, event.taskId)
        if (!survivor || survivor.target.recoveryId !== event.recoveryId || survivor.target.taskId !== event.taskId
          || survivor.target.ownerId !== event.ownerId || survivor.target.sessionId !== event.sessionId
          || target.attachment || target.opening || !Number.isSafeInteger(event.revision)
          || event.revision <= (target.attachmentRevision ?? 0)) return
        target.attachmentRevision = event.revision
        const operation: ClaudeBackgroundAttachmentView = {requestId:randomUUID(), revision:event.revision, status:'opening',
          sessionId:event.sessionId, continuedInSessionId:event.sessionId,
          teammate:{ownerId:event.ownerId, taskId:event.taskId, recoveryId:event.recoveryId}}
        openAttachment(key, target, operation, survivor.open, 'Surviving teammate terminal is unavailable')
        return
      }
      if (event.type === 'CLAUDE_TEAMMATE_TERMINAL_OPEN') {
        const owner = target.owner, state = owner?.state
        if (!state || state.ownerId !== event.ownerId || state.sessionId !== event.sessionId || target.attachment || target.opening
          || !Number.isSafeInteger(event.revision) || event.revision <= (target.attachmentRevision ?? 0)) return
        const task = state.status === 'live' && owner === dependencies.get(event.threadId)
          ? state.tasks.find(task => task.id === event.taskId && task.canStop) : undefined
        const reconnect = target.teammateReconnects.get(event.taskId)
        const resume = reconnect?.target.taskId === event.taskId && teammateCrashCurrent(target, event.ownerId, event.sessionId) ? reconnect : undefined
        const open = owner?.openTeammateTerminal?.bind(owner)
        if (!resume && (!task || !open)) return
        target.attachmentRevision = event.revision
        const operation: ClaudeBackgroundAttachmentView = { requestId:randomUUID(), revision:event.revision, status:'opening',
          sessionId:event.sessionId, continuedInSessionId:event.sessionId, teammate:{ownerId:event.ownerId, taskId:event.taskId} }
        if (resume) {
          openAttachment(key, target, operation, resume.open, 'Teammate terminal reconnect failed')
        } else if (open && task) {
          target.teammateReconnects.delete(event.taskId)
          openAttachment<Awaited<ReturnType<typeof open>>>(key, target, operation, signal => open(event.taskId, signal),
            'Teammate terminal attachment failed', client => {
              if (client.reconnect && client.snapshot.status === 'live') {
                target.teammateReconnects.set(event.taskId, {
                  target: {ownerId:event.ownerId, sessionId:event.sessionId, taskId:event.taskId, name:task.name},
                  open:client.reconnect, available:client.canReconnect,
                })
              }
            })
        }
        return
      }
      if (event.type === 'CLAUDE_BACKGROUND_OPEN') {
        const continuation = dependencies.continuation?.(event.threadId)
        if (!continuation || !dependencies.openAttachment || event.sessionId !== continuation.sessionId || event.continuedInSessionId !== continuation.continuedInSessionId
          || !Number.isSafeInteger(event.revision) || event.revision <= (target.attachmentRevision ?? 0) || target.attachment?.status === 'opening'
          || target.background?.session?.id !== event.jobId || target.background.sessionId !== continuation.sessionId || target.background.continuedInSessionId !== continuation.continuedInSessionId) return
        target.attachmentRevision = event.revision
        if (target.attachmentOwner?.snapshot.jobId === event.jobId && target.attachmentOwner.snapshot.status === 'live') {publish(key,target);return}
        retireAttachment(target)
        const operation: ClaudeBackgroundAttachmentView = {...continuation, requestId:randomUUID(), revision:event.revision, status:'opening'}
        openAttachment(key, target, operation, signal => dependencies.openAttachment!(continuation, event.jobId, event.threadId, signal), 'Background attachment failed')
        return
      }
      if (event.type === 'CLAUDE_BACKGROUND_CLOSE') {
        if (target.attachment?.requestId === event.requestId) {retireAttachment(target);publish(key,target)}
        return
      }
      if (event.type === 'CLAUDE_BACKGROUND_INPUT' || event.type === 'CLAUDE_BACKGROUND_RESIZE') {
        if (!attachmentCurrent(target) || target.attachmentOwner?.snapshot.id !== event.attachmentId) return
        if (event.type === 'CLAUDE_BACKGROUND_INPUT') target.attachmentOwner.input(event.attachmentId,event.text)
        else target.attachmentOwner.resize(event.attachmentId,event.columns,event.rows,event.cell)
        return
      }
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
      if (event.type === 'CLAUDE_TERMINAL_BACKGROUND') {
        const continuation = dependencies.continuation?.(event.threadId)
        if (!continuation || (event.operation === 'reply' ? !dependencies.replyBackground : !dependencies.background) || continuation.sessionId !== event.sessionId || continuation.continuedInSessionId !== event.continuedInSessionId
          || !Number.isSafeInteger(event.revision) || event.revision <= (target.background?.revision ?? 0) || target.background?.sessionId === continuation.sessionId && target.background.continuedInSessionId === continuation.continuedInSessionId && target.background.status === 'pending') return
        const previous = target.background?.continuedInSessionId === continuation.continuedInSessionId ? target.background.session : undefined
        if (event.operation === 'interrupt' && (!dependencies.interruptBackground || !target.background?.desktop || JSON.stringify(target.background.desktop) !== JSON.stringify(event.target) || target.background.turn?.id !== event.turnId || target.background.turn.cancelled)) return
        if (event.operation === 'reply' && (previous?.id !== event.id || previous.pid !== event.pid || !['working','blocked'].includes(previous.state))) return
        const operation: ClaudeBackgroundSessionState = { ...continuation, revision: event.revision, operation: event.operation, status: 'pending', session: previous, desktop: target.background?.desktop }
        target.background = operation; publish(key, target)
        const current = () => views.get(key) === target && target.background === operation
          && dependencies.continuation?.(event.threadId)?.sessionId === continuation.sessionId
          && dependencies.continuation?.(event.threadId)?.continuedInSessionId === continuation.continuedInSessionId
        void Promise.resolve().then(async () => {
          if (!current()) return
          if (event.operation === 'interrupt') {
            await dependencies.interruptBackground!(event.threadId, event)
            if (current()) return dependencies.background!(continuation, {operation: 'refresh'}, event.threadId)
            return
          }
          return event.operation === 'reply' ? dependencies.replyBackground!(continuation, event, event.threadId) : dependencies.background!(continuation, event, event.threadId)
        }).then(session => {
          if (!current()) return
          operation.session = session; operation.status = 'done'
          if (!session?.pid || !['working', 'blocked'].includes(session.state) || session.id !== operation.desktop?.jobId || session.pid !== operation.desktop?.pid) operation.desktop = undefined
          publish(key, target)
          refreshRegisteredWorker(key, target)
          prepareDesktop(key, target)
        }, error => { if (current()) { operation.status = 'error'; operation.problem = error instanceof Error ? error.message : 'Background session operation failed'; publish(key, target) } })
        return
      }
      const owner = dependencies.get(event.threadId)
      if (!owner || owner !== target.owner || event.ownerId !== owner.state.ownerId) return
      if (event.type === 'CLAUDE_TERMINAL_MCP_FORM' || event.type === 'CLAUDE_TERMINAL_MCP_URL') {
        if (!Number.isSafeInteger(event.sequence) || event.sequence <= (target.mcpOperation?.sequence ?? 0) || target.mcpOperation?.status === 'pending') return
        const operation: NonNullable<ClaudeTerminalViewSnapshot['mcpOperation']> = { sequence: event.sequence, status: 'pending' }
        target.mcpOperation = operation; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.mcpOperation === operation
        void Promise.resolve().then(() => { if (current()) return event.type === 'CLAUDE_TERMINAL_MCP_URL' ? owner.operateMcpUrl(event.request) : owner.operateMcpForm(event.request) }).then(() => {
          if (current()) { target.mcpOperation = { ...operation, status: 'done' }; publish(key, target) }
        }).catch(error => {
          if (current()) { target.mcpOperation = { ...operation, status: 'error', problem: error instanceof Error ? error.message : 'Native MCP form action failed' }; publish(key, target) }
        })
        return
      }
      if (event.type === 'CLAUDE_TERMINAL_QUEUE_EDIT_APPLIED') {
        const recovered = queueDrafts.get(owner)
        if (!recovered || recovered.view !== target || recovered.draft.sessionId !== event.sessionId || owner.state.sessionId !== event.sessionId
          || recovered.draft.id !== event.itemId) return
        queueDrafts.delete(owner)
        publish(key, target)
        return
      }
      if (event.type === 'CLAUDE_TERMINAL_QUEUE_SEND_NOW' || event.type === 'EDIT_CLAUDE_QUEUED_PROMPT' || event.type === 'CLAUDE_TERMINAL_QUEUE_CANCEL') {
        const editing = event.type === 'EDIT_CLAUDE_QUEUED_PROMPT'
        const cancelling = event.type === 'CLAUDE_TERMINAL_QUEUE_CANCEL'
        const itemId = 'itemId' in event ? event.itemId : undefined
        const subtype = editing ? 'apack_main_queue_edit' : cancelling ? 'apack_main_queue_cancel' : 'apack_main_queue_send_now'
        const refusal = editing ? 'Claude could not return the queued prompt'
          : cancelling ? 'Claude could not cancel the queued prompt' : 'Claude could not send the waiting prompts now'
        const {sessionId, viewRevision, turnId, queueRevision, sequence} = event
        const previous = target.queueOperation
        const scopeCurrent = () => {
          const state = owner.state
          return state.status === 'live' && !state.inputBlocked && state.sessionId === sessionId
            && state.view?.kind === 'main' && state.view.revision === viewRevision && state.activeTurnId === turnId
            && !state.endingTurnId && state.promptQueue?.revision === queueRevision
            && (!editing || queueDrafts.get(owner)?.draft.sessionId !== sessionId)
            && (!itemId || state.promptQueue.items.some(row => row.id === itemId && (editing ? row.editable : row.cancellable)))
        }
        if (typeof queueRevision !== 'string' || !/^[a-f0-9]{64}$/.test(queueRevision) || typeof turnId !== 'string' || !turnId
          || (editing || cancelling) && (typeof itemId !== 'string' || !itemId)
          || editing && (!target.queueComposer || signal?.aborted || queueEditsInFlight.has(owner)) || !scopeCurrent() || !Number.isSafeInteger(sequence) || sequence <= (previous?.sequence ?? 0) || previous?.status === 'pending') return
        const operation: NonNullable<ClaudeTerminalViewSnapshot['queueOperation']> = {sequence, sessionId, viewRevision, queueRevision, status: 'pending'}
        if (editing) queueEditsInFlight.add(owner)
        target.queueOperation = operation; publish(key, target)
        const current = () => !signal?.aborted && views.get(key) === target && dependencies.get(event.threadId) === owner
          && target.owner === owner && target.queueOperation === operation
        const pending = Promise.resolve().then(async () => {
          if (!current() || !scopeCurrent()) throw new Error('The Claude queue changed before the request')
          const result = await owner.uiTransport.request({
            subtype,
            session_id: sessionId, view_revision: viewRevision, turn_id: turnId, queue_revision: queueRevision,
            ...(itemId ? {item_id: itemId} : {}),
          }) as {handled?: unknown; cancelled?: unknown; restored?: {id?: unknown; text?: unknown; images?: unknown}}
          if (result.handled !== true || cancelling && result.cancelled !== itemId) throw new Error(refusal)
          if (!editing) return
          if (!itemId || result.restored?.id !== itemId || typeof result.restored.text !== 'string'
            || result.restored.text.length > CLAUDE_UI_TEXT_MAX_LENGTH) throw new Error('Claude did not return the selected draft')
          const images = z.array(queuedDraftImage).optional().safeParse(result.restored.images)
          if (!images.success || !result.restored.text && !images.data?.length) throw new Error('Claude did not return a usable draft')
          return {id: itemId, text: result.restored.text, ...(images.data?.length ? {images: images.data} : {})}
        }).then(restored => {
          const sameView = current()
          // The CLI already removed this row. A closed requester must not retain the only copy.
          if (editing && signal?.aborted && views.get(key) === target) drop(key)
          if (restored && dependencies.get(event.threadId) === owner && owner.state.sessionId === sessionId) {
            queueDrafts.set(owner, {draft: {...restored, sessionId, automatic: sameView}, view: sameView ? target : undefined})
          }
          if (sameView) { target.queueOperation = {...operation, status: 'done'}; publish(key, target) }
          else if (restored) for (const [id, candidate] of views) if (candidate.owner === owner) publish(id, candidate)
        }, error => {
          if (current()) { target.queueOperation = {...operation, status: 'error', problem: error instanceof Error ? error.message : refusal}; publish(key, target) }
        }).finally(() => { if (editing) queueEditsInFlight.delete(owner) })
        return editing ? pending : undefined
      }
      if (event.type === 'CLAUDE_TERMINAL_POLICY_RECHECK') {
        const {sessionId, viewRevision, taskId} = event
        const sameScope = () => {
          const state = owner.state, view = state.view
          const sameView = taskId === undefined ? view?.kind === 'main' : view?.kind === 'agent' && view.taskId === taskId
          return state.status === 'live' && state.sessionId === sessionId && sameView
            && view?.revision === viewRevision && !state.inputBlocked
        }
        const pending = target.policyRecheck
        if (!sameScope() || pending?.status === 'pending' && pending.sessionId === sessionId && pending.viewRevision === viewRevision) return
        const operation: NonNullable<ClaudeTerminalViewSnapshot['policyRecheck']> = {sessionId, viewRevision, status: 'pending'}
        target.policyRecheck = operation; publish(key, target)
        const current = () => views.get(key) === target && dependencies.get(event.threadId) === owner
          && target.owner === owner && target.policyRecheck === operation
        void Promise.resolve().then(async () => {
          if (!current() || !sameScope()) throw new Error('Claude settings owner changed')
          const result = await owner.uiTransport.request({subtype:'apack_managed_settings_recheck', session_id:sessionId, view_revision:viewRevision, ...(taskId === undefined ? {} : {task_id:taskId})}) as {rechecked?: unknown}
          if (result.rechecked !== true) throw new Error('Claude did not acknowledge the settings recheck')
        }).then(() => {
          if (current()) { target.policyRecheck = {...operation, status:'done'}; publish(key, target) }
        }, error => {
          if (current()) {
            target.policyRecheck = {...operation, status:'error', problem: error instanceof Error ? error.message : 'Claude could not recheck managed settings'}
            publish(key, target)
          }
        })
        return
      }
      if (event.type === 'CLAUDE_TERMINAL_NOTICE') {
        const notice = owner.state.notice, response = event.notice
        if (!notice || !response || notice.id !== response.id || notice.revision !== response.revision || notice.sessionId !== response.sessionId || !isClaudeNativeNoticeDecision(notice, response.decision) || target.noticeAnswer?.status === 'pending') return
        if(response.decision==='credit'&&!claudeCreditRequest.safeParse(response.credit).success)return
        const answer: NonNullable<ClaudeTerminalViewSnapshot['noticeAnswer']> = { id: response.id, revision: response.revision, status: 'pending',...(response.decision==='credit'?{requestId:response.credit.requestId}:{}) }
        target.noticeAnswer = answer; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.noticeAnswer === answer
        void (async () => {
          const resume = response.decision === 'fullscreen_accept' ? await dependencies.beforeViewChange?.(target.client, event.threadId) : undefined
          try {
            if (current()) await owner.answerNotice(response)
          } finally { resume?.() }
        })().then(() => { if (current()) { target.noticeAnswer = { ...answer, status: 'done' }; publish(key, target) } }).catch(error => { if (current()) { target.noticeAnswer = { ...answer, status: 'error', problem: error instanceof Error ? error.message : 'Native notice decision failed' }; publish(key, target) } })
        return
      }
      if (event.type === 'CLAUDE_TERMINAL_TASK') {
        if (event.sessionId !== owner.state.sessionId) return
        const previous = target.task?.sessionId === event.sessionId ? target.task : undefined
        if (typeof event.taskId !== 'string' || !event.taskId || event.taskId.length > 256 || !['inspect', 'stop', 'send', 'input', 'foreground', 'background', 'skip_worker', 'retry_worker', 'pause_workflow', 'resume_workflow'].includes(event.operation) || !Number.isSafeInteger(event.revision) || event.revision <= (previous?.revision ?? 0) || previous?.status === 'pending' || event.operation !== 'background' && !owner.state.tasks.some(task => task.id === event.taskId)) return
        if ((event.operation === 'send' || event.operation === 'input') && (typeof event.text !== 'string' || !event.text.trim() || event.text.length > 16384)) return
        if ((event.operation === 'skip_worker' || event.operation === 'retry_worker') && (typeof event.worker?.agentId !== 'string' || !event.worker.agentId || event.worker.agentId.length > 256 || typeof event.worker.token !== 'string' || !/^[a-f0-9]{64}$/.test(event.worker.token))) return
        const task: ClaudeTerminalTaskState = { ownerId: event.ownerId, sessionId: event.sessionId, taskId: event.taskId, revision: event.revision, operation: event.operation, status: 'pending', ...(previous?.taskId === event.taskId ? { details: previous.details } : {}) }
        target.task = task; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner
          && owner.state.sessionId === task.sessionId && target.task === task
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
          || target.submission?.status === 'pending' || typeof event.text !== 'string' || !event.text.trim() && !Object.values(event.references ?? {}).some(value => value?.length)) return
        const sessionId = event.sessionId
        target.submissionRevision = event.revision
        target.draftSessionId = undefined
        if (sessionId !== owner.state.sessionId || event.text.length > CLAUDE_UI_TEXT_MAX_LENGTH) {
          const problem = sessionId !== owner.state.sessionId ? CLAUDE_STALE_DRAFT_MESSAGE : CLAUDE_UI_TEXT_LIMIT_MESSAGE
          target.submission = { ownerId: event.ownerId, revision: event.revision, status: 'rejected', problem }
          publish(key, target)
          return
        }
        const references = event.references ? structuredClone(event.references) : undefined
        const submission: ClaudeTerminalSubmissionState = { ownerId: event.ownerId, revision: event.revision, status: 'pending' }
        target.submission = submission; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && dependencies.get(event.threadId) === owner && target.submission === submission
        const requireSession = () => {
          if (owner.state.sessionId !== sessionId) throw new Error(CLAUDE_STALE_DRAFT_MESSAGE)
        }
        void Promise.resolve().then(async () => {
          if (!current()) return undefined
          requireSession()
          const command = event.text.trim() ? await dependencies.command?.(target.client, target.threadId, target.mountId, event.revision, event.text, !!references && Object.values(references).some(value => value?.length)) : undefined
          if (command && command.kind !== 'not_command') return { command }
          if (!current()) return undefined
          requireSession()
          target.draftSessionId = sessionId
          if (!dependencies.prepareInput && event.references && Object.values(event.references).some(value => value?.length)) throw new Error('Native references could not be prepared')
          const input = dependencies.prepareInput ? await dependencies.prepareInput(event.text, references) : { text: event.text, images: [] }
          if (!current()) return undefined
          requireSession()
          if (event.phase !== undefined) return owner.submit(input.text, input.images.length ? input.images : undefined, event.phase)
          return input.images.length ? owner.submit(input.text, input.images) : owner.submit(input.text)
        }).then(result => {
          if (result && 'command' in result) {
            if (!current()) return
            // An acknowledged native reset can itself move this owner to a new session.
            const command = result.command
            if (command.kind !== 'command_complete' || !command.conversationId || command.sessionId !== owner.state.sessionId) requireSession()
            target.submission = { ...submission, status: result.command.kind === 'blocked' ? 'rejected' : 'accepted', command: result.command, ...(result.command.kind === 'blocked' ? { problem: result.command.message } : {}) }; publish(key, target)
            return
          }
          const receipt = result
          if (!receipt || dependencies.get(event.threadId) !== owner) return
          requireSession()
          if (receipt.sessionId !== sessionId) throw new Error('Native prompt receipt belongs to another session')
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
      else if (event.type === 'CLAUDE_TERMINAL_RESIZE') owner.resize(event.ownerId, event.columns, event.rows,event.cell)
      else if (event.type === 'CLAUDE_TERMINAL_CLOSE') {
        if (target.stop?.ownerId === event.ownerId && target.stop.status === 'pending') return
        const stop: ClaudeTerminalStopState = { ownerId: event.ownerId, revision: (target.stop?.revision ?? 0) + 1, status: 'pending' }
        target.stop = stop; target.problem = undefined; publish(key, target)
        const current = () => views.get(key) === target && target.owner === owner && target.stop === stop
        void Promise.resolve().then(() => owner.close()).then(() => {
          if (current()) { target.stop = { ...stop, status: 'done' }; publish(key, target) }
        }).catch(error => {
          if (!current()) return
          const problem = error instanceof Error ? error.message : 'Native session could not stop'
          target.stop = { ...stop, status: 'error', problem }; target.problem = problem; publish(key, target)
        })
      }
    },
    disconnect(client: string) {
      for (const [key, view] of views) if (view.client === client) drop(key)
    },
    clear(threadId?: string) {
      for (const [key, view] of views) if (threadId === undefined || view.threadId === threadId) drop(key, false)
      for (const [key, tasks] of parkedTeammates) {
        if (threadId === undefined || key === threadId) for (const taskId of tasks.keys()) removeParkedTeammate(key, taskId)
      }
    },
  }
}
