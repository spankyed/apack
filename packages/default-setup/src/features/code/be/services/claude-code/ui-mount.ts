import { randomUUID } from 'node:crypto'
import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import type { ClaudeConversation } from './conversation.ts'
import type { ClaudeUiControls } from './ui-controls.ts'

import type { ClaudeUiMountState } from './ui-presentation.ts'

type UiOwner = Pick<ClaudeConversation, 'done' | 'subscribe'> & { handle: { ui: ClaudeUiControls } }

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
    if (attached && !alreadyDirty) publish({ status: 'rendering' })
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
      drawing = createClaudeUiDrawing(result.tree)
      publish({ status: 'live', tree: drawing.tree })
    } catch (error) {
      if (current() && revision === generation) {
        drawing = undefined
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
    /** No retry: a native press may have applied its side effect even if its reply was lost. */
    async press(actionId: string): Promise<{ handled: boolean }> {
      if (!current() || pressing) return { handled: false }
      const action = drawing?.actions.get(actionId)
      if (!action) return { handled: false }
      pressing = true
      // Retire immediately; a second click cannot reuse an accepted capability.
      drawing = undefined
      publish({ status: 'rendering' })
      try {
        const result = await owner.handle.ui.press({ ...client, ...action })
        return { handled: current() && result.handled }
      } finally {
        pressing = false
        if (current()) invalidate()
      }
    },
  }
}
