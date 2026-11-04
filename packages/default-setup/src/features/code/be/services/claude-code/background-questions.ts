import { ClaudeNativeQuestionDialogsSchema, type ClaudeNativeQuestionDialog } from './terminal-dialogs.ts'
import type { ClaudeTerminalUiTransport } from './terminal-ui.ts'

/** Observe the verified child once, independently of desktop clients and Reply visibility. */
export function createClaudeBackgroundQuestions(options: {
  sessionId: string
  transport: Pick<ClaudeTerminalUiTransport, 'request'>
  changed(): void
}) {
  const listeners = new Set<() => void>()
  let epoch = 0
  let closed = false, reading = false
  let question: ClaudeNativeQuestionDialog | undefined
  function replace(next: ClaudeNativeQuestionDialog | undefined) {
    if (JSON.stringify(question) === JSON.stringify(next)) return
    question = next
    options.changed()
    for (const listener of listeners) { try { listener() } catch { /* Isolate presentation clients. */ } }
  }
  async function refresh() {
    if (closed || reading) return
    const readEpoch = epoch
    reading = true
    try {
      const result = await options.transport.request({ subtype: 'apack_question_dialogs' }) as { dialogs?: unknown }
      if (closed || readEpoch !== epoch) return
      const dialogs = ClaudeNativeQuestionDialogsSchema.parse(result.dialogs)
      if (dialogs.some(dialog => dialog.sessionId !== options.sessionId)) throw new Error('Background question owner changed')
      replace(dialogs[0])
    } catch {
      // A failed read cannot leave an actionable stale card in any window.
      if (!closed && readEpoch === epoch) replace(undefined)
    } finally { reading = false }
  }
  const timer = setInterval(() => { void refresh() }, 1000)
  timer.unref()
  void refresh()
  return {
    get value() { return closed ? undefined : question },
    refresh,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    settled(id: string, revision: string) { if (question?.id === id && question.revision === revision) { epoch++; replace(undefined) } },
    close() { closed = true; clearInterval(timer); question = undefined; listeners.clear() },
  }
}
