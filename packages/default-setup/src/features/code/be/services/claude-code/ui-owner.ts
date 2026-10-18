import { z } from 'zod'
import { getConversation, getNativeTerminal } from './handle-store.ts'
import type { ClaudeNativeTerminalOwner } from './terminal-owner.ts'
import { createClaudeUiControls } from './ui-controls.ts'
import type { ClaudeUiOwner } from './ui-mount.ts'
import type { ClaudeNativeAgentUiTarget } from '../../../common/native-terminal.ts'

const nativeOwners = new WeakMap<ClaudeNativeTerminalOwner, { key: string; owner: ClaudeUiOwner }>()

/** Native UI authority belongs to one observed view; targeted mounts never follow a different selection. */
export function getClaudeUiOwner(threadId: string, target?: ClaudeNativeAgentUiTarget): ClaudeUiOwner | undefined {
  const native = getNativeTerminal(threadId)
  if (!native) return target ? undefined : getConversation(threadId)?.owner
  const state = native.state, view = state.view
  if (state.status !== 'live' || !view) return
  if (target ? state.ownerId !== target.ownerId || state.sessionId !== target.sessionId || view.kind !== 'agent' || view.taskId !== target.taskId || view.revision !== target.revision : view.kind !== 'main') return
  const key = JSON.stringify([state.sessionId, view.revision, target?.taskId ?? null])
  const cached = nativeOwners.get(native)
  if (cached?.key === key) return cached.owner
  const initialized = native.uiTransport.request({ subtype: 'apack_ui_capabilities' }).then(value => z.object({ capabilities: z.array(z.string()) }).parse(value))
  // A view can disappear before attach awaits metadata; retain the error for that attach.
  initialized.catch(() => {})
  const owner: ClaudeUiOwner = {
    nativeView: target ? { session_id: target.sessionId, revision: target.revision, agent_id: target.taskId } : undefined,
    done: native.done,
    sessionId: state.sessionId,
    subscribe: listener => native.uiTransport.subscribe(listener),
    question: { ownerId: native.state.ownerId, render: native.renderQuestionDialog, hold: native.holdQuestionDialog },
    handle: { ui: createClaudeUiControls(initialized, native.uiTransport, native.uiTransport.promptHosts) },
  }
  nativeOwners.set(native, { key, owner })
  return owner
}
