import { z } from 'zod'
import { getConversation, getNativeTerminal } from './handle-store.ts'
import type { ClaudeNativeTerminalOwner } from './terminal-owner.ts'
import { createClaudeUiControls } from './ui-controls.ts'
import type { ClaudeUiOwner } from './ui-mount.ts'

const nativeOwners = new WeakMap<ClaudeNativeTerminalOwner, ClaudeUiOwner>()

/** Stable UI identity follows the sole conversation owner across an explicit native handoff. */
export function getClaudeUiOwner(threadId: string): ClaudeUiOwner | undefined {
  const native = getNativeTerminal(threadId)
  if (!native) return getConversation(threadId)?.owner
  if (native.state.status !== 'live') return
  let owner = nativeOwners.get(native)
  if (!owner) {
    const initialized = native.uiTransport.request({ subtype: 'apack_ui_capabilities' }).then(value => z.object({ capabilities: z.array(z.string()) }).parse(value))
    // A view can disappear before attach awaits metadata; retain the error for that attach.
    initialized.catch(() => {})
    owner = {
      done: native.done,
      get sessionId() { return native.state.sessionId },
      subscribe: listener => native.uiTransport.subscribe(listener),
      question: { ownerId: native.state.ownerId, render: native.renderQuestionDialog, hold: native.holdQuestionDialog },
      handle: { ui: createClaudeUiControls(initialized, native.uiTransport, native.uiTransport.promptHosts) },
    }
    nativeOwners.set(native, owner)
  }
  return owner
}
