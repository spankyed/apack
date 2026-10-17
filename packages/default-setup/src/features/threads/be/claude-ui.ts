import type { EntityId } from '#generated/services.ts'
import { repository } from '#generated/repository.ts'
import { selectClaudeTranscriptRows } from '#features/code/be/services/claude-code/ui-transcript-rows.ts'
import { randomUUID } from 'node:crypto'
import type { ClaudePromptHostRequest, ClaudePromptHostResponse } from '#generated/types.ts'
import type { ClaudePromptHost } from '#features/code/be/services/claude-code/ui-prompt-host.ts'
import { getConversation } from '#features/code/be/services/claude-code/handle-store.ts'
import { mountClaudeUi } from '#features/code/be/services/claude-code/ui-mount.ts'
import type { ClaudeUiMountState } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeConversation } from '#features/code/be/services/claude-code/conversation.ts'
import type { ClaudeUiViewRequest, OutgoingThreadsEvents } from './types.ts'
import type { Reply } from '@apackdev/sdk/events'
import { registerThreadTeardown } from './thread-teardown.ts'

type ClaudePromptHostOperation = { [Kind in ClaudePromptHostRequest['kind']]: Omit<Extract<ClaudePromptHostRequest, { kind: Kind }>, 'requestId' | 'revision' | 'expiresAt'> }[ClaudePromptHostRequest['kind']]

interface ClaudeUiView {
  client: string
  threadId: string
  mountId: string
  expires: number
  messageIds: Set<string>
  userExpansion: Map<string, boolean>
  thinkingExpansion: Map<string, ReadonlySet<number>>
  reply: Reply<OutgoingThreadsEvents>
  state: ClaudeUiMountState
  pendingPrompt?: { requestId: string; kind: ClaudePromptHostRequest['kind']; finish(answer?: ClaudePromptHostResponse): void }
  owner?: ClaudeConversation
  mount?: ReturnType<typeof mountClaudeUi>
}
const views = new Map<string, ClaudeUiView>()
let timer: ReturnType<typeof setInterval> | undefined
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id)
const keyOf = (client: string, mountId: string) => JSON.stringify([client, mountId])

function publish(view: ClaudeUiView, state: ClaudeUiMountState): void {
  view.state = state
  view.reply({ type: 'CLAUDE_UI_STATE', threadId: view.threadId, mountId: view.mountId, state })
}
function drop(key: string, view: ClaudeUiView): void {
  views.delete(key)
  view.pendingPrompt?.finish()
  // A stopped thread can remain visible; explicitly retire the frontend drawing as well.
  try { publish(view, { status: 'disconnected' }) } catch { /* window already closed */ }
  void view.mount?.dispose().catch(() => {})
  if (!views.size && timer) { clearInterval(timer); timer = undefined }
}
function bind(key: string, view: ClaudeUiView): void {
  const owner = getConversation(view.threadId)?.owner
  if (owner === view.owner) { view.mount?.refreshTranscript(); return }
  view.pendingPrompt?.finish()
  void view.mount?.dispose().catch(() => {})
  view.mount = undefined
  view.owner = owner
  if (!owner) { publish(view, { status: 'disconnected' }); return }
  let promptQueue: Promise<unknown> = Promise.resolve()
  function ask(request: ClaudePromptHostOperation, signal: AbortSignal, expiresAt: number): Promise<ClaudePromptHostResponse | undefined> {
    const result = promptQueue.then(() => dispatch(request, signal, expiresAt))
    promptQueue = result.then(() => undefined, () => undefined)
    return result
  }
  function dispatch(request: ClaudePromptHostOperation, signal: AbortSignal, expiresAt: number): Promise<ClaudePromptHostResponse | undefined> {
    if (signal.aborted || Date.now() >= expiresAt || views.get(key) !== view || view.owner !== owner || getConversation(view.threadId)?.owner !== owner) return Promise.resolve(undefined)
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
    async read(signal, expiresAt) { const answer = await ask({ kind: 'read' }, signal, expiresAt); return answer?.kind === 'read' ? answer.box : undefined },
    async fill(input, signal, expiresAt) { const answer = await ask({ kind: 'fill', input }, signal, expiresAt); return answer?.kind === 'fill' && answer.filled },
    async suggest(text, signal, expiresAt) { const answer = await ask({ kind: 'suggest', text }, signal, expiresAt); return answer?.kind === 'suggest' && answer.shown },
  }
  view.mount = mountClaudeUi({ owner, promptHost,
    messages: () => view.messageIds.size && owner.sessionId ? selectClaudeTranscriptRows(repository.chatQueries.threadData(view.threadId as EntityId)?.messages ?? [], owner.sessionId, view.messageIds, view.userExpansion, view.thinkingExpansion) : [],
    isCurrent: () => views.get(key) === view && getConversation(view.threadId)?.owner === owner,
    requestFocus: (focusId, revision, paneId) => {
      if (views.get(key) === view && view.owner === owner) view.reply({ type: 'CLAUDE_UI_FOCUS_STATE', threadId: view.threadId, mountId: view.mountId, result: { revision, moved: true, focusId, ...(paneId ? { paneId } : {}) } })
    },
    publish: state => { if (views.get(key) === view && view.owner === owner) publish(view, state) },
  })
}

/** Delivery identity owns each mount. A heartbeat renews its lease without launching a process. */
export function handleClaudeUiView(event: ClaudeUiViewRequest, client?: string, reply?: Reply<OutgoingThreadsEvents>): void {
  if (!client || !reply || !validId(event.mountId) || !event.threadId || event.threadId.length > 256) return
  if (event.type === 'CLAUDE_UI_MOUNT' && event.messageIds !== undefined && (!Array.isArray(event.messageIds) || !event.messageIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256))) return
  if (event.type === 'CLAUDE_UI_MOUNT' && event.userExpansion !== undefined && (!event.userExpansion || typeof event.userExpansion !== 'object' || Array.isArray(event.userExpansion) || !Object.entries(event.userExpansion).every(([id, value]) => id.length > 0 && id.length <= 256 && typeof value === 'boolean'))) return
  if (event.type === 'CLAUDE_UI_MOUNT' && event.thinkingExpansion !== undefined && (!event.thinkingExpansion || typeof event.thinkingExpansion !== 'object' || Array.isArray(event.thinkingExpansion) || !Object.entries(event.thinkingExpansion).every(([id, indices]) => id.length > 0 && id.length <= 256 && Array.isArray(indices) && indices.every(index => Number.isSafeInteger(index) && index >= 0)))) return
  const key = keyOf(client, event.mountId)
  let view = views.get(key)
  if (view && view.threadId !== event.threadId) return
  if (view && view.expires <= Date.now()) { drop(key, view); view = undefined }
  if (event.type === 'CLAUDE_PROMPT_HOST_RESPONSE') {
    if (!view) return
    bind(key, view)
    if (view.pendingPrompt?.requestId === event.requestId && view.pendingPrompt.kind === event.kind) view.pendingPrompt.finish(event)
    return
  }
  if (event.type === 'CLAUDE_UI_NOTICE') {
    if (!view) return
    bind(key, view)
    view.mount?.notice(event)
    return
  }
  if (event.type === 'CLAUDE_UI_SCROLL') {
    if (!view) return
    bind(key, view)
    view.mount?.scroll(event)
    return
  }
  if (event.type === 'CLAUDE_UI_PANE') {
    if (!view) return
    bind(key, view)
    void view.mount?.pane(event)?.catch(() => { /* A failed operation retains the native roster. */ })
    return
  }
  if (event.type === 'CLAUDE_UI_FOCUS') {
    if (!view) return
    bind(key, view)
    const target = view, mount = target.mount
    if (!mount) return
    void mount.focus(event).then(result => {
      if (result && views.get(key) === target && target.mount === mount && getConversation(target.threadId)?.owner === target.owner) target.reply({ type: 'CLAUDE_UI_FOCUS_STATE', threadId: target.threadId, mountId: target.mountId, result })
    }).catch(() => { /* focus failure must not replace or disable the live drawing */ })
    return
  }
  if (event.type === 'CLAUDE_PROMPT_AUTOCOMPLETE') {
    if (!view) return
    bind(key, view)
    const target = view, mount = target.mount
    if (!mount) return
    const { type: _, threadId: __, mountId: ___, ...box } = event
    void mount.autocompletePrompt(box).then(result => {
      if (result && views.get(key) === target && target.mount === mount && getConversation(target.threadId)?.owner === target.owner) {
        target.reply({ type: 'CLAUDE_PROMPT_COMPLETIONS', threadId: target.threadId, mountId: target.mountId, result })
      }
    }).catch(() => { /* delivery connection closed */ })
    return
  }
  if (event.type === 'CLAUDE_PROMPT_EDIT') {
    if (!view) return
    bind(key, view)
    const target = view, mount = target.mount
    if (!mount) return
    const { type: _, threadId: __, mountId: ___, ...box } = event
    void mount.editPrompt(box).then(result => {
      if (result && views.get(key) === target && target.mount === mount && getConversation(target.threadId)?.owner === target.owner) {
        target.reply({ type: 'CLAUDE_PROMPT_STATE', threadId: target.threadId, mountId: target.mountId, result })
      }
    }).catch(() => { /* delivery connection closed */ })
    return
  }
  if (event.type === 'CLAUDE_UI_UNMOUNT') { if (view) drop(key, view); return }
  if (event.type === 'CLAUDE_UI_PRESS' || event.type === 'CLAUDE_UI_FIELD') {
    if (!view || !validId(event.actionId)) return
    bind(key, view)
    const target = view
    const mount = target.mount
    const operation = event.type === 'CLAUDE_UI_PRESS' ? mount?.press(event.actionId, event.href) : mount?.field(event)
    void operation?.catch(error => {
      if (views.get(key) === target && target.mount === mount && getConversation(target.threadId)?.owner === target.owner) publish(target, { status: 'error', message: error instanceof Error ? error.message : 'Native UI action failed' })
    })
    return
  }
  if (!view) {
    if (views.size >= 256 || [...views.values()].filter(item => item.client === client).length >= 16) return
    view = { client, threadId: event.threadId, mountId: event.mountId, expires: 0, messageIds: new Set(), userExpansion: new Map(), thinkingExpansion: new Map(), reply, state: { status: 'disconnected' } }
    views.set(key, view)
  }
  if (event.messageIds !== undefined) {
    view.messageIds = new Set(event.messageIds)
  }
  if (event.userExpansion !== undefined) view.userExpansion = new Map(Object.entries(event.userExpansion))
  if (event.thinkingExpansion !== undefined) view.thinkingExpansion = new Map(Object.entries(event.thinkingExpansion).map(([id, indices]) => [id, new Set(indices)]))
  view.reply = reply
  view.expires = Date.now() + 30000
  publish(view, view.state)
  bind(key, view)
  timer ??= setInterval(() => {
    for (const [entryKey, entry] of views) {
      if (entry.expires <= Date.now()) drop(entryKey, entry)
      else bind(entryKey, entry)
    }
  }, 1000)
  timer.unref?.()
}

export function clearClaudeUiViews(threadId?: string): void {
  for (const [key, view] of views) if (threadId === undefined || view.threadId === threadId) drop(key, view)
}
registerThreadTeardown(clearClaudeUiViews)
