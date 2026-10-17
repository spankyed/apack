import { randomUUID } from 'node:crypto'
import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import type { ClaudeConversation } from './conversation.ts'
import type { ClaudeUiControls } from './ui-controls.ts'

import type { ClaudeUiFieldEvent, ClaudeUiMountState, ClaudePromptEdit, ClaudePromptReply } from './ui-presentation.ts'

type UiOwner = Pick<ClaudeConversation, 'done' | 'subscribe'> & { handle: { ui: Pick<ClaudeUiControls, 'attach' | 'detach' | 'render' | 'press' | 'input' | 'select' | 'promptEdit'> } }

/** One independent native attachment per mounted view; never starts or owns a conversation. */
export function mountClaudeUi(options: {
  owner: UiOwner
  isCurrent(): boolean
  publish(state: ClaudeUiMountState): void
}) {
  const { owner } = options
  const client = { client_id: `apack-${randomUUID()}`, surface: 'desktop' as const }
  const instanceId = randomUUID()
  let disposed = false
  let attached = false
  let dirty = false
  let rendering = false
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let drawing: ClaudeUiDrawing | undefined
  let fieldDrawing: ClaudeUiDrawing | undefined
  let promptRevision = 0
  let generation = 0
  let pressing = false
  let disposal: Promise<void> | undefined
  let unsubscribe = () => {}

  function publish(state: ClaudeUiMountState): void {
    // An observer must not break native attachment cleanup or the process event reader.
    try { options.publish(state) } catch { /* presentation is not process authority */ }
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
  function invalidate(): void {
    if (!current()) return
    generation++
    drawing = undefined
    const alreadyDirty = dirty
    dirty = true
    if (attached && !alreadyDirty && !fieldDrawing?.fields.size) publish({ status: 'rendering' })
    schedule()
  }
  async function render(): Promise<void> {
    if (!current() || !dirty || rendering) return
    rendering = true
    dirty = false
    const revision = generation
    try {
      const result = await owner.handle.ui.render({ ...client, component: 'AbovePrompt', instance_id: instanceId, props: {} })
      if (!current() || revision !== generation) return
      drawing = createClaudeUiDrawing(result.tree, fieldDrawing)
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
    fieldDrawing = undefined
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

  publish({ status: 'connecting' })
  unsubscribe = owner.subscribe(event => {
    const line = event as Record<string, unknown>
    if (line.type === 'system' && line.subtype === 'ui_invalidate' && line.event === 'ui.render') invalidate()
  })
  const ready = (async () => {
    try {
      await owner.handle.ui.attach(client)
      attached = true
      if (current()) invalidate()
    } catch (error) {
      if (current()) publish({ status: 'error', message: error instanceof Error ? error.message : 'Native UI attachment failed' })
    }
  })()
  void owner.done.then(() => dispose(), () => dispose()).catch(() => {})

  return {
    ready,
    dispose,
    async editPrompt(event: ClaudePromptEdit): Promise<ClaudePromptReply | undefined> {
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= promptRevision) return
      promptRevision = event.revision
      const { revision, ...box } = event
      try {
        await ready
        if (!attached || !current() || revision !== promptRevision) return
        const frame = await owner.handle.ui.promptEdit({ ...client, ...box })
        if (!current() || revision !== promptRevision || frame.superseded) return
        return { revision, status: 'applied', frame }
      } catch (error) {
        if (current() && revision === promptRevision) return { revision, status: 'error', message: error instanceof Error ? error.message : 'Native composer edit failed' }
      }
    },
    async field(event: ClaudeUiFieldEvent): Promise<{ handled: boolean }> {
      if (!current() || typeof event.value !== 'string' || event.value.length > 16384) return { handled: false }
      const field = fieldDrawing?.fields.get(event.actionId)
      if (!field || (field.type === 'select' ? event.kind !== 'select' || !field.options?.includes(event.value) : event.kind !== 'change' && event.kind !== 'submit')) return { handled: false }
      const identity = { ...client, plugin: field.plugin, handle: field.handle, key: field.key, component: 'AbovePrompt', instance_id: instanceId, value: event.value }
      // Native queues each plugin's field callbacks. Keyed identity safely re-resolves redraws.
      // Never retry a callback whose native side effect may already have happened.
      const result = field.type === 'select' ? await owner.handle.ui.select(identity)
        : await owner.handle.ui.input({ ...identity, kind: event.kind as 'change' | 'submit' })
      return { handled: current() && result.handled }
    },
    /** No retry: a native press may have applied its side effect even if its reply was lost. */
    async press(actionId: string, href?: string): Promise<{ handled: boolean }> {
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
      if (!fieldDrawing?.fields.size) publish({ status: 'rendering' })
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
