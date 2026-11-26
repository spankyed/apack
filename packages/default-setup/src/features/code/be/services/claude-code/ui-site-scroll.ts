import type { ClaudeUiControls } from './ui-controls.ts'
import type { ClaudeUiDrawing } from './ui-tree.ts'
import type { ClaudeUiScrollEvent, ClaudeUiScrollState } from './ui-presentation.ts'

/** One serialized scroll queue for one native site; a plugin push supersedes older person replies. */
export function createClaudeSiteScroll(options: {
  ui: Pick<ClaudeUiControls, 'scroll'>
  client: { client_id: string; surface: 'desktop' }
  component: 'Pane' | 'AbovePrompt'
  instanceId: string
  current(): boolean
  drawing(): ClaudeUiDrawing | undefined
  publish(state: ClaudeUiScrollState): void
}) {
  let disposed = false, inFlight = false, serial = 0, generation = 0, latest = 0
  let pending: ClaudeUiScrollEvent | undefined, state: ClaudeUiScrollState | undefined
  const current = () => !disposed && options.current()
  async function pump() {
    if (inFlight || !pending || !current()) return
    const event = pending, epoch = generation
    pending = undefined; inFlight = true
    const targets = options.drawing()?.scrollTargets
    const keyed = event.keyed.flatMap(item => {
      const identity = targets?.get(item.id)
      return identity ? [{ ...identity, top: item.top, bottom: item.bottom }] : []
    })
    try {
      const result = await options.ui.scroll({ ...options.client, component: options.component, instance_id: options.instanceId,
        offset: event.offset, by: event.by, body_rows: event.rows, content_rows: event.contentRows, ...(event.pointer ? { pointer: event.pointer } : {}), ...(keyed.length || (targets && !event.keyed.length) ? { keyed } : {}) })
      if (current() && epoch === generation && event.revision === latest) {
        state = { serial: ++serial, requestRevision: event.revision, offset: Math.max(0, result.offset), followEnd: result.follow_end === true }
        options.publish(state)
      }
    } catch { /* Never retry a move; the native hook may already have run. */ }
    finally { inFlight = false; if (pending && current()) void pump() }
  }
  return {
    get state() { return state },
    report(event: ClaudeUiScrollEvent) {
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= latest || !Number.isSafeInteger(event.by)
        || ![event.offset, event.rows, event.contentRows].every(value => Number.isSafeInteger(value) && value >= 0)
        || (event.pointer !== undefined && (!event.pointer || !Number.isSafeInteger(event.pointer.column) || !Number.isSafeInteger(event.pointer.row)))
        || !Array.isArray(event.keyed) || event.keyed.length > 512 || event.keyed.some(item => !item || typeof item.id !== 'string' || !Number.isSafeInteger(item.top) || !Number.isSafeInteger(item.bottom) || item.top < 0 || item.bottom < item.top)) return
      const by = event.by + (pending?.by ?? 0)
      if (!Number.isSafeInteger(by)) return
      latest = event.revision
      pending = { ...event, by, ...(event.by === 0 && pending?.pointer ? { pointer: pending.pointer } : {}) }
      void pump()
    },
    receive(event: Record<string, unknown>) {
      if (!current() || event.type !== 'system' || event.subtype !== 'ui_scroll' || event.client_id !== options.client.client_id || event.component !== options.component || event.instance_id !== options.instanceId || !Number.isSafeInteger(event.offset) || (event.offset as number) < 0) return
      generation++; pending = undefined
      state = { serial: ++serial, offset: event.offset as number, followEnd: event.follow_end === true }
      options.publish(state)
    },
    dispose() { disposed = true; generation++; pending = undefined; state = undefined },
  }
}
