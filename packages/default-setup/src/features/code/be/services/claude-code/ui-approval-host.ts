import { randomUUID } from 'node:crypto'
import type { ClaudeUiApprovalSource } from './ui-approval-source.ts'
import type { ClaudeUiApprovalAnswer } from '../../../common/native-approval.ts'
import type { ClaudeUiApprovalFrame } from './ui-presentation.ts'
import type { ClaudeBackgroundApproval } from './background-controls.ts'

const same = (a: ClaudeBackgroundApproval, b?: ClaudeBackgroundApproval) => !!b && a.kind === b.kind && a.dialog.id === b.dialog.id && a.dialog.revision === b.dialog.revision && a.dialog.requestId === b.dialog.requestId && a.dialog.sessionId === b.dialog.sessionId

/** A view's approval frame never follows a replacement original request. */
export function createClaudeApprovalHost(options: {source?: ClaudeUiApprovalSource; current(): boolean; publish(): void}) {
  let frame: ClaudeUiApprovalFrame | undefined, disposed = false
  const valid = (value: ClaudeUiApprovalFrame) => !disposed && options.current() && frame === value && same(value.control, options.source?.read())
  return {
    get state() { return frame && valid(frame) ? frame : undefined },
    refresh() {
      if (disposed || !options.current()) return
      const control = options.source?.read()
      if (!control) { if (frame) { frame = undefined; options.publish() }; return }
      if (frame && same(frame.control, control)) frame.control = control
      else frame = {id: randomUUID(), control}
      options.publish()
    },
    async answer(id: string, response: ClaudeUiApprovalAnswer) {
      const target = frame
      if (!target || !valid(target) || target.id !== id || target.pending || !options.source) return
      target.pending = true; target.problem = undefined; options.publish()
      try { await options.source.answer(target.control, response); if (valid(target)) { frame = undefined; options.publish() } }
      catch (error) { if (valid(target)) { target.problem = error instanceof Error ? error.message : 'Native approval failed'; options.publish() } }
      finally { target.pending = false; if (valid(target)) options.publish() }
    },
    dispose() { disposed = true; frame = undefined },
  }
}
