import type { ClaudeUiNotices } from './ui-presentation.ts'

/** A mounted native view owns its notice clock; a shown holdToasts pane pauses transient lifetimes. */
export function createClaudeUiNotices(options: { current(): boolean; sessionId(): string | undefined; publish(): void }) {
  const statuses = new Map<string, string>(), seen = new Set<string>()
  let toasts: { id: string; plugin: string; text: string; deadline: number; hoveredAt?: number }[] = []
  let sessionId: string | undefined, held = false, pausedAt = 0, pausedFor = 0, disposed = false, timer: ReturnType<typeof setTimeout> | undefined
  const now = () => (held ? pausedAt : Date.now()) - pausedFor
  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined }
  function schedule() {
    clearTimer()
    if (disposed || held || !toasts.length) return
    timer = setTimeout(() => {
      timer = undefined
      if (!options.current()) return
      const at = now(); toasts = toasts.filter(toast => {
        if (toast.hoveredAt !== undefined && at - toast.hoveredAt >= 30000) { toast.deadline += at - toast.hoveredAt; toast.hoveredAt = undefined }
        return toast.hoveredAt !== undefined || toast.deadline > at
      })
      options.publish(); schedule()
    }, Math.max(1, Math.min(2_147_483_647, ...toasts.map(toast => (toast.hoveredAt !== undefined ? toast.hoveredAt + 30000 : toast.deadline) - now()))))
  }
  function reset(nextSession?: string) { clearTimer(); statuses.clear(); toasts = []; seen.clear(); sessionId = nextSession }
  return {
    get state(): ClaudeUiNotices | undefined {
      if (disposed) return
      const visible = held ? [] : toasts.map(({ id, plugin, text }) => ({ id, plugin, text }))
      if (!statuses.size && !visible.length) return
      return { statuses: [...statuses].map(([plugin, text]) => ({ plugin, text })), toasts: visible }
    },
    setHeld(next: boolean) {
      if (disposed || next === held) return
      if (next) pausedAt = Date.now()
      else pausedFor += Date.now() - pausedAt
      held = next; schedule()
    },
    receive(event: Record<string, unknown>) {
      if (disposed || !options.current()) return
      if (event.type === 'conversation_reset') { reset(); options.publish(); return }
      if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
        if (sessionId && sessionId !== event.session_id) { reset(event.session_id); options.publish() }
        return
      }
      if (event.type !== 'system' || !['ui_status', 'ui_toast'].includes(String(event.subtype))) return
      if (typeof event.session_id !== 'string' || !event.session_id || (options.sessionId() && options.sessionId() !== event.session_id)
        || (sessionId && sessionId !== event.session_id) || typeof event.uuid !== 'string' || !event.uuid || event.uuid.length > 128
        || typeof event.plugin !== 'string' || !event.plugin || event.plugin.length > 256
        || (event.text !== null && (typeof event.text !== 'string' || event.text.length > 10001))) return
      if (event.subtype === 'ui_toast' && (typeof event.text !== 'string' || !Number.isSafeInteger(event.timeout_ms))) return
      if (seen.has(event.uuid)) return
      sessionId = event.session_id; seen.add(event.uuid)
      if (seen.size > 512) seen.delete(seen.values().next().value!)
      if (event.subtype === 'ui_status') {
        if (event.text === null) statuses.delete(event.plugin)
        else { statuses.delete(event.plugin); statuses.set(event.plugin, event.text as string) }
      } else {
        const remaining = Math.max(0, event.timeout_ms as number)
        toasts.push({ id: event.uuid, plugin: event.plugin, text: event.text as string, deadline: now() + remaining })
        // Native caps the stack at fifty and evicts an oldest row from its most numerous owner.
        if (toasts.length > 50) {
          const counts = new Map<string, number>()
          for (const toast of toasts) counts.set(toast.plugin, (counts.get(toast.plugin) ?? 0) + 1)
          const owner = [...counts].sort((a, b) => b[1] - a[1])[0]![0]
          toasts.splice(toasts.findIndex(toast => toast.plugin === owner), 1)
        }
        schedule()
      }
      options.publish()
    },
    operate(event: import('./ui-presentation.ts').ClaudeUiNoticeEvent) {
      if (disposed || !options.current()) return
      const toast = toasts.find(value => value.id === event.id)
      if (!toast) return
      if (event.kind === 'dismiss') toasts = toasts.filter(value => value !== toast)
      else if (event.kind === 'hold' && typeof event.isHeld === 'boolean') {
        if (event.isHeld && toast.hoveredAt === undefined) toast.hoveredAt = now()
        else if (!event.isHeld && toast.hoveredAt !== undefined) { toast.deadline += now() - toast.hoveredAt; toast.hoveredAt = undefined }
        else return
      } else return
      schedule(); options.publish()
    },
    dispose() { disposed = true; reset() },
  }
}
