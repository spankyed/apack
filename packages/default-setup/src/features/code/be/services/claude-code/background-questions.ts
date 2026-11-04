import { ClaudeNativeQuestionDialogsSchema, type ClaudeNativeQuestionDialog } from './terminal-dialogs.ts'
import type { ClaudeTerminalUiTransport } from './terminal-ui.ts'

/** Observe the verified child once, independently of desktop clients and Reply visibility. */
export function createClaudeBackgroundQuestions(options: {
  sessionId: string
  transport: Pick<ClaudeTerminalUiTransport, 'request'>
  changed(): void
}) {
  let closed = false, reading = false
  let question: ClaudeNativeQuestionDialog | undefined
  function replace(next: ClaudeNativeQuestionDialog | undefined) {
    if (JSON.stringify(question) === JSON.stringify(next)) return
    question = next
    options.changed()
  }
  async function refresh() {
    if (closed || reading) return
    reading = true
    try {
      const result = await options.transport.request({ subtype: 'apack_question_dialogs' }) as { dialogs?: unknown }
      if (closed) return
      const dialogs = ClaudeNativeQuestionDialogsSchema.parse(result.dialogs)
      if (dialogs.some(dialog => dialog.sessionId !== options.sessionId)) throw new Error('Background question owner changed')
      replace(dialogs[0])
    } catch {
      // A failed read cannot leave an actionable stale card in any window.
      if (!closed) replace(undefined)
    } finally { reading = false }
  }
  const timer = setInterval(() => { void refresh() }, 1000)
  timer.unref()
  void refresh()
  return {
    get value() { return closed ? undefined : question },
    refresh,
    close() { closed = true; clearInterval(timer); question = undefined },
  }
}
