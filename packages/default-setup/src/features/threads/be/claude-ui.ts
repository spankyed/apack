import { getConversation } from '#features/code/be/services/claude-code/handle-store.ts'
import { mountClaudeUi } from '#features/code/be/services/claude-code/ui-mount.ts'
import type { ClaudeUiMountState } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeConversation } from '#features/code/be/services/claude-code/conversation.ts'
import type { ClaudeUiViewRequest, OutgoingThreadsEvents } from './types.ts'
import type { Reply } from '@apackdev/sdk/events'
import { registerThreadTeardown } from './thread-teardown.ts'

interface ClaudeUiView {
  client: string
  threadId: string
  mountId: string
  expires: number
  reply: Reply<OutgoingThreadsEvents>
  state: ClaudeUiMountState
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
  // A stopped thread can remain visible; explicitly retire the frontend drawing as well.
  try { publish(view, { status: 'disconnected' }) } catch { /* window already closed */ }
  void view.mount?.dispose().catch(() => {})
  if (!views.size && timer) { clearInterval(timer); timer = undefined }
}
function bind(key: string, view: ClaudeUiView): void {
  const owner = getConversation(view.threadId)?.owner
  if (owner === view.owner) return
  void view.mount?.dispose().catch(() => {})
  view.mount = undefined
  view.owner = owner
  if (!owner) { publish(view, { status: 'disconnected' }); return }
  view.mount = mountClaudeUi({ owner,
    isCurrent: () => views.get(key) === view && getConversation(view.threadId)?.owner === owner,
    publish: state => { if (views.get(key) === view && view.owner === owner) publish(view, state) },
  })
}

/** Delivery identity owns each mount. A heartbeat renews its lease without launching a process. */
export function handleClaudeUiView(event: ClaudeUiViewRequest, client?: string, reply?: Reply<OutgoingThreadsEvents>): void {
  if (!client || !reply || !validId(event.mountId) || !event.threadId || event.threadId.length > 256) return
  const key = keyOf(client, event.mountId)
  let view = views.get(key)
  if (view && view.threadId !== event.threadId) return
  if (view && view.expires <= Date.now()) { drop(key, view); view = undefined }
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
    view = { client, threadId: event.threadId, mountId: event.mountId, expires: 0, reply, state: { status: 'disconnected' } }
    views.set(key, view)
  }
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
