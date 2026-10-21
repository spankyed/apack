import { createLogger } from '@apackdev/sdk/logger'
import { createClaudeSelectionReply } from '#features/code/be/services/claude-code/ui-selection-reply.ts'
import type { EntityId } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { selectClaudeTranscriptRows } from '#features/code/be/services/claude-code/ui-transcript-rows.ts'
import { randomUUID } from 'node:crypto'
import type { ClaudePromptHostRequest, ClaudePromptHostResponse } from '#generated/types.ts'
import type { ClaudePromptHost } from '#features/code/be/services/claude-code/ui-prompt-host.ts'
import { getClaudeUiOwner } from '#features/code/be/services/claude-code/ui-owner.ts'
import { mountClaudeUi } from '#features/code/be/services/claude-code/ui-mount.ts'
import type { ClaudeUiMountState } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeUiOwner } from '#features/code/be/services/claude-code/ui-mount.ts'
import type { ClaudeUiViewRequest, OutgoingThreadsEvents } from './types.ts'
import type { Reply } from '@apackdev/sdk/events'
import { registerThreadTeardown } from './thread-teardown.ts'

type ClaudePromptHostOperation = { [Kind in ClaudePromptHostRequest['kind']]: Omit<Extract<ClaudePromptHostRequest, { kind: Kind }>, 'requestId' | 'revision' | 'expiresAt'> }[ClaudePromptHostRequest['kind']]

interface ClaudeUiView {
  promptFocused: boolean
  client: string
  resumeKey: string
  attachmentId?: string
  threadId: string
  mountId: string
  nativeView?: import('#features/code/common/native-terminal.ts').ClaudeNativeAgentUiTarget
  expires: number
  messageIds: Set<string>
  userExpansion: Map<string, boolean>
  blockExpansion: Map<string, ReadonlySet<number>>
  reply: Reply<OutgoingThreadsEvents>
  state: ClaudeUiMountState
  pendingPrompt?: { requestId: string; kind: ClaudePromptHostRequest['kind']; finish(answer?: ClaudePromptHostResponse): void }
  owner?: ClaudeUiOwner
  mount?: ReturnType<typeof mountClaudeUi>
}
const logger = createLogger('claude-ui')
const views = new Map<string, ClaudeUiView>()
const retiredMounts = new Map<string, { threadId: string; expires: number }>()
const retiring = new Set<{ client: string; threadId: string; done: Promise<void> }>()
function retire(view: ClaudeUiView): void {
  if (!view.mount) return
  const entry = { client: view.client, threadId: view.threadId, done: view.mount.dispose() }
  retiring.add(entry)
  void entry.done.finally(() => retiring.delete(entry)).catch(() => {})
}
/** Release only this window's hosts, including detachments already started by unmount. */
export async function releaseClaudeUiViews(client: string, threadId: string): Promise<void> {
  for (const [key, view] of views) if (view.client === client && view.threadId === threadId) drop(key, view)
  await Promise.all([...retiring].filter(view => view.client === client && view.threadId === threadId).map(view => view.done))
}
const viewTransitions = new Map<string, number>()
/** Native Agent selection is shared by the session, so every window must release its old host. */
export async function suspendClaudeUiThreadViews(threadId: string): Promise<() => void> {
  viewTransitions.set(threadId, (viewTransitions.get(threadId) ?? 0) + 1)
  let released = false
  const resume = () => {
    if (released) return
    released = true
    const remaining = (viewTransitions.get(threadId) ?? 1) - 1
    if (remaining) viewTransitions.set(threadId, remaining)
    else {
      viewTransitions.delete(threadId)
      for (const view of views.values()) if (view.threadId === threadId) bind(view)
    }
  }
  for (const view of views.values()) if (view.threadId === threadId) {
    view.pendingPrompt?.finish()
    retire(view)
    view.mount = undefined; view.owner = undefined; view.attachmentId = undefined
    publish(view, { status: 'disconnected' })
  }
  try { await Promise.all([...retiring].filter(view => view.threadId === threadId).map(view => view.done)) }
  catch (error) { resume(); throw error }
  return resume
}
let timer: ReturnType<typeof setInterval> | undefined
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id)
const keyOf = (client: string, mountId: string) => JSON.stringify([client, mountId])
const viewCurrent = (view: ClaudeUiView) => views.get(keyOf(view.client, view.mountId)) === view
const sameNativeView = (first: ClaudeUiView['nativeView'], second: ClaudeUiView['nativeView']) => first?.ownerId === second?.ownerId && first?.sessionId === second?.sessionId && first?.revision === second?.revision && first?.taskId === second?.taskId

function publish(view: ClaudeUiView, state: ClaudeUiMountState): void {
  view.state = state
  view.reply({ type: 'CLAUDE_UI_STATE', threadId: view.threadId, mountId: view.mountId, resumeKey: view.resumeKey, attachmentId: view.attachmentId, state })
}
function drop(key: string, view: ClaudeUiView, retired = false): void {
  if (retired) retiredMounts.set(key, { threadId: view.threadId, expires: Date.now() + 30000 })
  views.delete(key)
  view.pendingPrompt?.finish()
  // A stopped thread can remain visible; explicitly retire the frontend drawing as well.
  try { publish(view, { status: 'disconnected' }) } catch { /* window already closed */ }
  retire(view)
  if (!views.size && timer) { clearInterval(timer); timer = undefined }
}
function bind(view: ClaudeUiView): void {
  if (viewTransitions.has(view.threadId)) return
  const owner = getClaudeUiOwner(view.threadId, view.nativeView)
  if (owner === view.owner) { view.mount?.refreshTranscript(); return }
  view.pendingPrompt?.finish()
  retire(view)
  view.mount = undefined
  view.owner = owner
  view.attachmentId = owner ? randomUUID() : undefined
  if (!owner) { publish(view, { status: 'disconnected' }); return }
  let promptQueue: Promise<unknown> = Promise.resolve()
  function ask(request: ClaudePromptHostOperation, signal: AbortSignal, expiresAt: number): Promise<ClaudePromptHostResponse | undefined> {
    const result = promptQueue.then(() => dispatch(request, signal, expiresAt))
    promptQueue = result.then(() => undefined, () => undefined)
    return result
  }
  function dispatch(request: ClaudePromptHostOperation, signal: AbortSignal, expiresAt: number): Promise<ClaudePromptHostResponse | undefined> {
    if (signal.aborted || Date.now() >= expiresAt || !viewCurrent(view) || view.owner !== owner || getClaudeUiOwner(view.threadId, view.nativeView) !== owner) return Promise.resolve(undefined)
    // Queue each view's requests so Vue cannot collapse two host operations into one state update.
    if (view.pendingPrompt) return Promise.resolve(undefined)
    return new Promise(resolve => {
      const requestId = randomUUID()
      const finish = (answer?: ClaudePromptHostResponse) => {
        signal.removeEventListener('abort', aborted)
        if (view.pendingPrompt?.requestId === requestId) view.pendingPrompt = undefined
        resolve(answer)
      }
      const aborted = () => finish()
      view.pendingPrompt = { requestId, kind: request.kind, finish }
      signal.addEventListener('abort', aborted, { once: true })
      try { view.reply({ type: 'CLAUDE_PROMPT_HOST_REQUEST', threadId: view.threadId, mountId: view.mountId, request: { ...request, requestId, expiresAt, revision: view.mount?.promptRevision ?? 0 } }) } catch { finish() }
    })
  }
  const promptHost: ClaudePromptHost = {
    available: () => viewCurrent(view) && view.owner === owner && view.promptFocused,
    async read(signal, expiresAt) { const answer = await ask({ kind: 'read' }, signal, expiresAt); return answer?.kind === 'read' ? answer.box : undefined },
    async fill(input, signal, expiresAt) { const answer = await ask({ kind: 'fill', input }, signal, expiresAt); return answer?.kind === 'fill' && answer.filled },
    async selection(signal, expiresAt) {
      const reply = await createClaudeSelectionReply(signal, expiresAt, () => viewCurrent(view) && view.owner === owner)
      if (!reply.url) return undefined
      try {
        const [selection, acknowledgement] = await Promise.all([reply.result, ask({ kind: 'selection', replyUrl: reply.url }, signal, expiresAt)])
        return acknowledgement?.kind === 'selection' && acknowledgement.submitted && !signal.aborted && viewCurrent(view) && view.owner === owner ? selection : undefined
      } finally { reply.close() }
    },
    async copy(text, signal, expiresAt) { const answer = await ask({ kind: 'copy', text }, signal, expiresAt); return answer?.kind === 'copy' && answer.copied },
    async suggest(text, signal, expiresAt) { const answer = await ask({ kind: 'suggest', text }, signal, expiresAt); return answer?.kind === 'suggest' && answer.shown },
  }
  view.mount = mountClaudeUi({ owner, promptHost, nativeView: owner.nativeView,
    question: () => {
      const raw = repository.threadQueries.byId(view.threadId as EntityId)?.context?.claudeCode?.pendingControlRequest
      if (!raw || typeof raw !== 'object') return undefined
      const pending = raw as { toolName?: unknown; approvalMessageId?: unknown; nativeTerminal?: Record<string, unknown> }
      const native = pending.nativeTerminal
      if (pending.toolName !== 'AskUserQuestion' || !native || native.ownerId !== owner.question?.ownerId || native.sessionId !== owner.sessionId) return undefined
      if (![pending.approvalMessageId, native.dialogId, native.revision, native.sessionId, native.requestId].every(value => typeof value === 'string')) return undefined
      return { messageId: pending.approvalMessageId as string, id: native.dialogId as string, revision: native.revision as string, sessionId: native.sessionId as string, requestId: native.requestId as string }
    },
    messages: groups => !view.nativeView && view.messageIds.size && owner.sessionId ? selectClaudeTranscriptRows(repository.chatQueries.threadData(view.threadId as EntityId)?.messages ?? [], owner.sessionId, view.messageIds, view.userExpansion, view.blockExpansion, groups) : [],
    isCurrent: () => viewCurrent(view) && getClaudeUiOwner(view.threadId, view.nativeView) === owner,
    requestFocus: (focusId, revision, paneId) => {
      if (viewCurrent(view) && view.owner === owner) view.reply({ type: 'CLAUDE_UI_FOCUS_STATE', threadId: view.threadId, mountId: view.mountId, result: { revision, moved: true, focusId, ...(paneId ? { paneId } : {}) } })
    },
    publish: state => { if (viewCurrent(view) && view.owner === owner) publish(view, state) },
  })
}

/** Route only through the submitting window's existing native UI attachment. */
export async function submitClaudeParentCommand(client: string, threadId: string, mountId: string, revision: number, text: string, hasReferences: boolean) {
  const key = keyOf(client, mountId), view = views.get(key)
  if (!view || view.threadId !== threadId || view.nativeView || view.expires <= Date.now()) throw new Error('Claude composer is not attached')
  bind(view)
  if (!view.mount) throw new Error('Claude composer is not attached')
  return view.mount.submitParentCommand(revision, text, hasReferences)
}

/** Delivery identity owns each mount. A heartbeat renews its lease without launching a process. */
export function handleClaudeUiView(event: ClaudeUiViewRequest, client?: string, reply?: Reply<OutgoingThreadsEvents>): void {
  if (event.type === 'CLAUDE_UI_KEY') logger.debug('Native action key received', { mountId: event.mountId, sequence: event.sequence, client: !!client, reply: !!reply })
  if (!client || !validId(event.mountId) || !event.threadId || event.threadId.length > 256) return
  // A replaced frontend actor cannot receive replies. Its view can still retire its own
  // attachment using the credential issued before replacement, without claiming a new host.
  if (!reply) {
    if (event.type !== 'CLAUDE_UI_UNMOUNT' || !event.resumeKey || !validId(event.resumeKey)) return
    const previous = [...views.entries()].find(([, candidate]) => candidate.resumeKey === event.resumeKey)
    if (previous && previous[1].threadId === event.threadId && previous[1].mountId === event.mountId) drop(previous[0], previous[1], true)
    return
  }
  if (event.type === 'CLAUDE_UI_MOUNT' && typeof event.promptFocused !== 'boolean') return
  if ((event.type === 'CLAUDE_UI_MOUNT' || event.type === 'CLAUDE_UI_UNMOUNT') && event.resumeKey !== undefined && !validId(event.resumeKey)) return
  if (event.type === 'CLAUDE_UI_MOUNT' && event.messageIds !== undefined && (!Array.isArray(event.messageIds) || !event.messageIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256))) return
  if (event.type === 'CLAUDE_UI_MOUNT' && event.userExpansion !== undefined && (!event.userExpansion || typeof event.userExpansion !== 'object' || Array.isArray(event.userExpansion) || !Object.entries(event.userExpansion).every(([id, value]) => id.length > 0 && id.length <= 256 && typeof value === 'boolean'))) return
  if (event.type === 'CLAUDE_UI_MOUNT' && event.blockExpansion !== undefined && (!event.blockExpansion || typeof event.blockExpansion !== 'object' || Array.isArray(event.blockExpansion) || !Object.entries(event.blockExpansion).every(([id, indices]) => id.length > 0 && id.length <= 256 && Array.isArray(indices) && indices.every(index => Number.isSafeInteger(index) && index >= 0)))) return
  if (event.type === 'CLAUDE_UI_MOUNT' && event.nativeView !== undefined) {
    const target = event.nativeView
    if (!target || typeof target !== 'object' || ![target.ownerId, target.sessionId, target.taskId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256) || !Number.isSafeInteger(target.revision) || target.revision < 1) return
  }
  const key = keyOf(client, event.mountId)
  // A queued heartbeat must never recreate a view after its explicit unmount.
  for (const [id, retired] of retiredMounts) if (retired.expires <= Date.now()) retiredMounts.delete(id)
  if (event.type === 'CLAUDE_UI_MOUNT' && retiredMounts.has(key)) return
  let view = views.get(key)
  if (!view && (event.type === 'CLAUDE_UI_MOUNT' || event.type === 'CLAUDE_UI_UNMOUNT') && event.resumeKey) {
    const previous = [...views.entries()].find(([, candidate]) => candidate.resumeKey === event.resumeKey)
    if (!previous || previous[1].expires <= Date.now()) {
      if (previous) drop(previous[0], previous[1])
      if (event.type === 'CLAUDE_UI_MOUNT') reply({ type: 'CLAUDE_UI_LEASE_EXPIRED', threadId: event.threadId, mountId: event.mountId, resumeKey: event.resumeKey })
      return
    }
    const [oldKey, candidate] = previous
    if (candidate.mountId !== event.mountId || candidate.threadId !== event.threadId || event.type === 'CLAUDE_UI_MOUNT' && !sameNativeView(candidate.nativeView, event.nativeView)) return
    if (event.type === 'CLAUDE_UI_UNMOUNT') { drop(oldKey, candidate, true); return }
    // Resume the same physical window; another connection needs its server-issued credential.
    views.delete(oldKey); candidate.pendingPrompt?.finish()
    candidate.client = client; candidate.reply = reply; candidate.resumeKey = randomUUID()
    views.set(key, candidate); view = candidate
  }
  if (view && view.threadId !== event.threadId) return
  if (view && event.type === 'CLAUDE_UI_MOUNT' && !sameNativeView(view.nativeView, event.nativeView)) return
  if (view && view.expires <= Date.now()) { drop(key, view); view = undefined }
  if (event.type === 'CLAUDE_PROMPT_HOST_RESPONSE') {
    if (!view) return
    bind(view)
    if (view.pendingPrompt?.requestId === event.requestId && view.pendingPrompt.kind === event.kind) view.pendingPrompt.finish(event)
    return
  }
  if (event.type === 'CLAUDE_UI_COMMAND_PANEL') {
    if (!view || !validId(event.panelId) || event.text !== undefined && (typeof event.text !== 'string' || !event.text.length || event.text.length > 4096)) return
    bind(view); void view.mount?.agentPanel(event.revision, event.panelId, event.text)
    return
  }
  if (event.type === 'CLAUDE_UI_COMMAND_DECISION') {
    if (!view || !validId(event.commandId) || !['confirm', 'cancel'].includes(event.decision)) return
    bind(view); void view.mount?.answerAgentCommand(event.revision, event.commandId, event.decision)
    return
  }
  if (event.type === 'CLAUDE_UI_AGENT_INPUT') {
    if (!view?.nativeView || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 16384) return
    bind(view)
    void view.mount?.submitAgent(event.revision, event.text)
    return
  }
  if (event.type === 'CLAUDE_UI_NOTICE') {
    if (!view) return
    bind(view)
    view.mount?.notice(event)
    return
  }
  if (event.type === 'CLAUDE_UI_SCROLL') {
    if (!view) return
    bind(view)
    view.mount?.scroll(event)
    return
  }
  if (event.type === 'CLAUDE_UI_PANE') {
    if (!view) return
    bind(view)
    void view.mount?.pane(event)?.catch(() => { /* A failed operation retains the native roster. */ })
    return
  }
  if (event.type === 'CLAUDE_UI_FOCUS') {
    if (!view) return
    bind(view)
    const target = view, mount = target.mount
    if (!mount) return
    void mount.focus(event).then(result => {
      if (result && viewCurrent(target) && target.mount === mount && getClaudeUiOwner(target.threadId, target.nativeView) === target.owner) target.reply({ type: 'CLAUDE_UI_FOCUS_STATE', threadId: target.threadId, mountId: target.mountId, result })
    }).catch(() => { /* focus failure must not replace or disable the live drawing */ })
    return
  }
  if (event.type === 'CLAUDE_PROMPT_AUTOCOMPLETE') {
    if (!view) return
    bind(view)
    const target = view, mount = target.mount
    if (!mount) return
    const { type: _, threadId: __, mountId: ___, ...box } = event
    void mount.autocompletePrompt(box).then(result => {
      if (result && viewCurrent(target) && target.mount === mount && getClaudeUiOwner(target.threadId, target.nativeView) === target.owner) {
        target.reply({ type: 'CLAUDE_PROMPT_COMPLETIONS', threadId: target.threadId, mountId: target.mountId, result })
      }
    }).catch(() => { /* delivery connection closed */ })
    return
  }
  if (event.type === 'CLAUDE_PROMPT_EDIT') {
    if (!view) return
    bind(view)
    const target = view, mount = target.mount
    if (!mount) return
    const { type: _, threadId: __, mountId: ___, ...box } = event
    void mount.editPrompt(box).then(result => {
      if (result && viewCurrent(target) && target.mount === mount && getClaudeUiOwner(target.threadId, target.nativeView) === target.owner) {
        target.reply({ type: 'CLAUDE_PROMPT_STATE', threadId: target.threadId, mountId: target.mountId, result })
      }
    }).catch(() => { /* delivery connection closed */ })
    return
  }
  if (event.type === 'CLAUDE_UI_UNMOUNT') {
    if (view) drop(key, view, true)
    else retiredMounts.set(key, { threadId: event.threadId, expires: Date.now() + 30000 })
    return
  }
  if(event.type==='CLAUDE_UI_CLIENT'){
    if(!view||!validId(event.id))return
    bind(view)
    void view.mount?.clientEvent({id:event.id,sequence:event.sequence,event:event.event}).catch(()=>{})
    return
  }
  if (event.type === 'CLAUDE_UI_KEY') {
    if (!view || !Number.isSafeInteger(event.sequence) || event.sequence < 1) return
    bind(view)
    const target = view, mount = target.mount
    // Trace acknowledgement lifetime without recording the key, prompt or callback authority.
    const identity = { mountId: target.mountId, sequence: event.sequence }
    logger.debug('Native action key routing', { ...identity, attached: !!mount })
    if (mount) void mount.key({ revision: event.revision, event: event.event }).then(result => {
      const currentView = viewCurrent(target), currentMount = target.mount === mount
      const currentOwner = currentView && currentMount && getClaudeUiOwner(target.threadId, target.nativeView) === target.owner
      logger.debug('Native action key completion', { ...identity, handled: result.handled, currentView, currentMount, currentOwner })
      if (currentView && currentMount && currentOwner) {
        target.reply({ type: 'CLAUDE_UI_KEY_RESULT', threadId: target.threadId, mountId: target.mountId, sequence: event.sequence, handled: result.handled, actionKeys: target.state.actionKeys })
      }
    }).catch(() => { logger.debug('Native action key acknowledgement unavailable', identity) })
    return
  }
  if (event.type === 'CLAUDE_UI_PRESS' || event.type === 'CLAUDE_UI_FIELD') {
    if (!view || !validId(event.actionId)) return
    bind(view)
    const target = view
    const mount = target.mount
    const operation = event.type === 'CLAUDE_UI_PRESS' ? mount?.press(event.actionId, event.href) : mount?.field(event)
    void operation?.catch(error => {
      if (viewCurrent(target) && target.mount === mount && getClaudeUiOwner(target.threadId, target.nativeView) === target.owner) publish(target, { status: 'error', message: error instanceof Error ? error.message : 'Native UI action failed' })
    })
    return
  }
  if (!view) {
    if (views.size >= 256 || [...views.values()].filter(item => item.client === client).length >= 16) return
    view = { client, promptFocused: event.promptFocused, resumeKey: randomUUID(), threadId: event.threadId, mountId: event.mountId, nativeView: event.nativeView ? { ...event.nativeView } : undefined, expires: 0, messageIds: new Set(), userExpansion: new Map(), blockExpansion: new Map(), reply, state: { status: 'disconnected' } }
    views.set(key, view)
  }
  if (event.messageIds !== undefined) {
    view.messageIds = new Set(event.messageIds)
  }
  if (event.userExpansion !== undefined) view.userExpansion = new Map(Object.entries(event.userExpansion))
  if (event.blockExpansion !== undefined) view.blockExpansion = new Map(Object.entries(event.blockExpansion).map(([id, indices]) => [id, new Set(indices)]))
  const promptFocusChanged = view.promptFocused !== event.promptFocused
  view.promptFocused = event.promptFocused
  view.reply = reply
  view.expires = Date.now() + 30000
  publish(view, view.state)
  bind(view)
  if (promptFocusChanged) void view.mount?.refreshPromptHost().catch(() => { /* A retired/unavailable owner cannot advertise a new host. */ })
  timer ??= setInterval(() => {
    for (const [entryKey, entry] of views) {
      if (entry.expires <= Date.now()) drop(entryKey, entry)
      else bind(entry)
    }
  }, 1000)
  timer.unref?.()
}

export function clearClaudeUiViews(threadId?: string): void {
  for (const [key, retired] of retiredMounts) if (threadId === undefined || retired.threadId === threadId) retiredMounts.delete(key)
  for (const [key, view] of views) if (threadId === undefined || view.threadId === threadId) drop(key, view)
}
registerThreadTeardown(clearClaudeUiViews)
