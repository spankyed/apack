import { createClaudeAssistantMessageHost } from './ui-assistant-messages.ts'
import { createClaudeUiNotices } from './ui-notices.ts'
import { createClaudeSiteScroll } from './ui-site-scroll.ts'
import { createClaudePaneHost } from './ui-pane-host.ts'
import { randomUUID } from 'node:crypto'
import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import type { ClaudeConversation } from './conversation.ts'
import type { ClaudeUiControls } from './ui-controls.ts'

import type { ClaudeUiFieldEvent, ClaudeUiFocusEvent, ClaudeUiFocusReply, ClaudeUiMountState, ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRequest, ClaudePromptCompletionReply } from './ui-presentation.ts'

type UiOwner = Pick<ClaudeConversation, 'done' | 'subscribe' | 'sessionId'> & { handle: { ui: Pick<ClaudeUiControls, 'servePrompt' | 'focus' | 'attach' | 'detach' | 'render' | 'press' | 'input' | 'select' | 'promptEdit' | 'promptAutocomplete' | 'panes' | 'showPane' | 'focusPane' | 'closePane' | 'scroll'> } }

/** One independent native attachment per mounted view; never starts or owns a conversation. */
export function mountClaudeUi(options: {
  owner: UiOwner
  isCurrent(): boolean
  publish(state: ClaudeUiMountState): void
  requestFocus?(focusId: string, revision: number, paneId?: string): void
  messages?(): import('./ui-presentation.ts').ClaudeUiAssistantRow[]
  promptHost?: import('./ui-prompt-host.ts').ClaudePromptHost
}) {
  const { owner } = options
  const client = { client_id: `apack-${randomUUID()}`, surface: 'desktop' as const }
  const instanceId = 'above-prompt'
  let disposed = false
  let attached = false
  let attachmentError: string | undefined
  let dirty = false
  let rendering = false
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let drawing: ClaudeUiDrawing | undefined
  let fieldDrawing: ClaudeUiDrawing | undefined
  const fieldRevisions = new Map<string, number>()
  const completedFields = new Map<string, number>()
  let focusRevision = 0
  let promptRevision = 0
  let completionRevision = 0
  let generation = 0
  let pressing = false
  let stopPromptHost: (() => void) | undefined
  let disposal: Promise<void> | undefined
  let unsubscribe = () => {}
  let lastState: ClaudeUiMountState = { status: 'connecting' }
  let panes: ReturnType<typeof createClaudePaneHost> | undefined
  const scroll = createClaudeSiteScroll({ ui: owner.handle.ui, client, component: 'AbovePrompt', instanceId, current, drawing: () => drawing ?? fieldDrawing, publish: () => publish(lastState) })

  const messages = createClaudeAssistantMessageHost({ ui: owner.handle.ui, client, current, rows: () => options.messages?.() ?? [], publish: () => publish(lastState) })

  const notices = createClaudeUiNotices({ current, sessionId: () => owner.sessionId, publish: () => publish(lastState) })

  function publish(state: ClaudeUiMountState): void {
    // An observer must not break native attachment cleanup or the process event reader.
    lastState = state
    const pane = panes?.state?.roster
    notices.setHeld(pane?.panes.find(value => value.id === pane.shown_id)?.hold_toasts === true)
    try { options.publish({ ...state, ...(messages.state.length ? { assistantMessages: messages.state } : {}), ...(notices.state ? { notices: notices.state } : {}), ...(panes?.state ? { panes: panes.state } : {}), ...(scroll.state ? { scroll: scroll.state } : {}) }) } catch { /* presentation is not process authority */ }
  }
  function current(): boolean {
    if (disposed) return false
    if (options.isCurrent()) return true
    void dispose().catch(() => {})
    return false
  }
  function schedule(): void {
    if (!attached || rendering || scheduled || !current()) return
    // At most one render in flight, with a bounded refresh rate during invalidation bursts.
    scheduled = setTimeout(() => { scheduled = undefined; void render() }, 50)
  }
  function retireDrawing(): void {
    if (!fieldDrawing?.fields.size) { publish({ status: 'rendering' }); return }
    function retire(node: import('./ui-presentation.ts').ClaudeUiNode): import('./ui-presentation.ts').ClaudeUiNode {
      if (node.kind === 'button' || node.kind === 'markdown') {
        const { actionId: _, ...inert } = node
        return inert
      }
      if (node.kind === 'box' || node.kind === 'link') return { ...node, children: node.children.map(retire) }
      if (node.kind === 'text' && node.children) return { ...node, children: node.children.map(retire) }
      return node
    }
    // Keep in-progress fields mounted, but never display an expired button/link as actionable.
    publish({ status: 'live', tree: retire(fieldDrawing.tree) })
  }
  function invalidate(): void {
    if (!current()) return
    generation++
    drawing = undefined
    const alreadyDirty = dirty
    dirty = true
    if (attached && !alreadyDirty) retireDrawing()
    schedule()
  }
  async function render(): Promise<void> {
    if (!current() || !dirty || rendering) return
    rendering = true
    dirty = false
    const revision = generation
    // Stamp only callbacks completed before this render began. A reply racing newer typing is stale.
    const completed = new Map(completedFields)
    try {
      const result = await owner.handle.ui.render({ ...client, component: 'AbovePrompt', instance_id: instanceId, props: {} })
      if (!current() || revision !== generation) return
      drawing = createClaudeUiDrawing(result.tree, fieldDrawing)
      function stamp(node: import('./ui-presentation.ts').ClaudeUiNode): void {
        if (node.kind === 'box') node.children.forEach(stamp)
        else if (node.kind === 'input' || node.kind === 'select') node.revision = completed.get(node.actionId) ?? 0
      }
      stamp(drawing.tree)
      for (const id of fieldRevisions.keys()) if (!drawing.fields.has(id)) { fieldRevisions.delete(id); completedFields.delete(id) }
      fieldDrawing = drawing
      publish({ status: 'live', tree: drawing.tree })
    } catch (error) {
      if (current() && revision === generation) {
        drawing = undefined
        fieldDrawing = undefined
        publish({ status: 'error', message: error instanceof Error ? error.message : 'Native UI render failed' })
      }
    } finally {
      rendering = false
      if (dirty) schedule()
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal
    disposed = true
    panes?.dispose()
    scroll.dispose()
    notices.dispose()
    messages.dispose()
    stopPromptHost?.(); stopPromptHost = undefined
    fieldDrawing = undefined
    fieldRevisions.clear()
    completedFields.clear()
    generation++
    drawing = undefined
    if (scheduled) clearTimeout(scheduled)
    scheduled = undefined
    unsubscribe()
    publish({ status: 'disconnected' })
    disposal = (async () => {
      await ready
      attached = false
      // Attach may have applied before a lost/error reply; detach is idempotent natively.
      await owner.handle.ui.detach(client.client_id)
    })()
    return disposal
  }

  panes = createClaudePaneHost({ ui: owner.handle.ui, client, current, publish: () => publish(lastState), requestFocus: options.requestFocus })
  publish({ status: 'connecting' })
  unsubscribe = owner.subscribe(event => {
    const line = event as Record<string, unknown>
    notices.receive(line)
    messages.receive(line)
    panes?.receive(line)
    scroll.receive(line)
    if (line.type === 'system' && line.subtype === 'ui_focus' && current() && line.client_id === client.client_id && line.component === 'AbovePrompt' && line.instance_id === instanceId) {
      const target = [...(drawing?.focusables ?? [])].find(([, identity]) => identity.plugin === line.plugin && identity.key === line.key)
      if (target) { try { options.requestFocus?.(target[0], focusRevision) } catch { /* closed presentation */ } }
    }
    if (line.type === 'system' && line.subtype === 'ui_invalidate' && line.event === 'ui.render') invalidate()
  })
  const ready = (async () => {
    try {
      if (options.promptHost) stopPromptHost = owner.handle.ui.servePrompt(client.client_id, options.promptHost)
      await owner.handle.ui.attach(client)
      attached = true
      if (current()) { invalidate(); messages.start(); await panes?.start() }
    } catch (error) {
      stopPromptHost?.(); stopPromptHost = undefined
      attachmentError = error instanceof Error ? error.message : 'Native UI attachment failed'
      if (current()) publish({ status: 'error', message: attachmentError })
    }
  })()
  void owner.done.then(() => dispose(), () => dispose()).catch(() => {})

  return {
    ready,
    dispose,
    refreshTranscript: () => messages.refresh(),
    notice(event: import('./ui-presentation.ts').ClaudeUiNoticeEvent) { notices.operate(event) },
    scroll(event: import('./ui-presentation.ts').ClaudeUiScrollEvent) { if (event.paneId) panes?.scroll(event); else scroll.report(event) },
    pane(event: import('./ui-presentation.ts').ClaudeUiPaneEvent) { return panes?.operate(event) },
    get promptRevision() { return promptRevision },
    async focus(event: ClaudeUiFocusEvent): Promise<ClaudeUiFocusReply | undefined> {
      if (event.paneId) return panes?.focus(event)
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= focusRevision || typeof event.isHeld !== 'boolean' || !['person', 'auto'].includes(event.by)) return
      focusRevision = event.revision
      const snapshot = drawing, revision = event.revision, epoch = generation
      const identity = typeof event.focusId === 'string' ? snapshot?.focusables.get(event.focusId) : event.focusId
      if (typeof event.focusId === 'string' && !identity) return
      await ready
      if (!attached || !current() || revision !== focusRevision || epoch !== generation) return
      const result = await owner.handle.ui.focus({ ...client, component: 'AbovePrompt', instance_id: instanceId,
        is_held: event.isHeld, by: event.by, ...(identity !== undefined ? { element: identity } : {}) })
      if (!current() || revision !== focusRevision || epoch !== generation || snapshot !== drawing) return
      const target = result.element === null ? null : [...(drawing?.focusables ?? [])].find(([, candidate]) => candidate.plugin === result.element?.plugin && candidate.key === result.element.key)?.[0]
      // An unrecognized native redirect must never focus a different view or an obsolete DOM node.
      if (target === undefined) return
      return { revision, moved: result.moved, focusId: target, ...(result.deny !== undefined ? { deny: result.deny } : {}) }
    },
    async autocompletePrompt(event: ClaudePromptCompletionRequest): Promise<ClaudePromptCompletionReply | undefined> {
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= completionRevision) return
      completionRevision = event.revision
      const editRevision = promptRevision, { revision, ...box } = event
      try {
        await ready
        if (!current() || revision !== completionRevision || editRevision !== promptRevision) return
        if (!attached) return { revision, status: 'error', message: attachmentError ?? 'Native composer is not attached' }
        const result = await owner.handle.ui.promptAutocomplete({ ...client, ...box })
        if (!current() || revision !== completionRevision || editRevision !== promptRevision) return
        return { revision, status: 'ready', result }
      } catch (error) {
        if (current() && revision === completionRevision && editRevision === promptRevision) return { revision, status: 'error', message: error instanceof Error ? error.message : 'Native autocomplete failed' }
      }
    },
    async editPrompt(event: ClaudePromptEdit): Promise<ClaudePromptReply | undefined> {
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= promptRevision) return
      promptRevision = event.revision
      const { revision, ...box } = event
      try {
        await ready
        if (!current() || revision !== promptRevision) return
        if (!attached) return { revision, status: 'error', message: attachmentError ?? 'Native composer is not attached' }
        const frame = await owner.handle.ui.promptEdit({ ...client, ...box })
        if (!current() || revision !== promptRevision) return
        return { revision, status: 'applied', frame }
      } catch (error) {
        if (current() && revision === promptRevision) return { revision, status: 'error', message: error instanceof Error ? error.message : 'Native composer edit failed' }
      }
    },
    async field(event: ClaudeUiFieldEvent): Promise<{ handled: boolean }> {
      if (messages.ownsField(event.actionId)) return messages.field(event)
      if (panes?.ownsField(event.actionId)) return panes.field(event)
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= (fieldRevisions.get(event.actionId) ?? 0) || typeof event.value !== 'string' || event.value.length > 16384) return { handled: false }
      const field = fieldDrawing?.fields.get(event.actionId)
      if (!field || (field.type === 'select' ? event.kind !== 'select' || !field.options?.includes(event.value) : event.kind !== 'change' && event.kind !== 'submit')) return { handled: false }
      fieldRevisions.set(event.actionId, event.revision)
      const identity = { ...client, plugin: field.plugin, handle: field.handle, key: field.key, component: 'AbovePrompt', instance_id: instanceId, value: event.value }
      // Native queues each plugin's field callbacks. Keyed identity safely re-resolves redraws.
      // Never retry a callback whose native side effect may already have happened.
      const result = field.type === 'select' ? await owner.handle.ui.select(identity)
        : await owner.handle.ui.input({ ...identity, kind: event.kind as 'change' | 'submit' })
      if (current() && fieldDrawing?.fields.has(event.actionId)) {
        completedFields.set(event.actionId, Math.max(completedFields.get(event.actionId) ?? 0, event.revision))
        invalidate()
      }
      return { handled: current() && result.handled }
    },
    /** No retry: a native press may have applied its side effect even if its reply was lost. */
    async press(actionId: string, href?: string): Promise<{ handled: boolean }> {
      if (messages.ownsAction(actionId)) return messages.press(actionId, href)
      if (panes?.ownsAction(actionId)) return panes.press(actionId, href)
      if (!current() || pressing) return { handled: false }
      const action = drawing?.actions.get(actionId)
      if (!action) return { handled: false }
      const isLink = drawing?.links.has(actionId)
      if (isLink) {
        if (!href || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return { handled: false }
        try { if (!['https:', 'http:', 'file:'].includes(new URL(href).protocol)) return { handled: false } } catch { return { handled: false } }
        const allowed = drawing?.links.get(actionId)
        if (allowed && !allowed.has(href)) return { handled: false }
      } else if (href !== undefined) return { handled: false }
      pressing = true
      // Retire immediately; a second click cannot reuse an accepted capability.
      drawing = undefined
      retireDrawing()
      try {
        const result = await owner.handle.ui.press({ ...client, ...action, ...(href !== undefined ? { href } : {}) })
        return { handled: current() && result.handled }
      } finally {
        pressing = false
        if (current()) invalidate()
      }
    },
  }
}
