import { z } from 'zod'
import { createClaudeChildApprovalSource } from './ui-approval-source.ts'
import { ClaudeNativeQuestionRenderSchema } from './terminal-dialogs.ts'
import { getConversation, getNativeTerminal, getNativeBackgroundDesktopOwner } from './handle-store.ts'
import type { ClaudeNativeTerminalOwner } from './terminal-owner.ts'
import { createClaudeUiControls } from './ui-controls.ts'
import type { ClaudeUiOwner } from './ui-mount.ts'
import type { ClaudeNativeAgentUiTarget } from '../../../common/native-terminal.ts'

import type { ClaudeBackgroundDesktopOwner } from './background-status-observer.ts'
import type { ClaudeBackgroundUiTarget } from '../../../common/native-background.ts'

const backgroundOwners = new WeakMap<ClaudeBackgroundDesktopOwner, ClaudeUiOwner>()

export function snapshotClaudeBackgroundUiTarget(owner: ClaudeBackgroundDesktopOwner): ClaudeBackgroundUiTarget {
  return {ownerId: owner.id, parentSessionId: owner.parentSessionId, sessionId: owner.identity.sessionId, jobId: owner.identity.jobId, pid: owner.identity.pid, processStart: owner.identity.start}
}

export function matchesClaudeBackgroundUiTarget(owner: ClaudeBackgroundDesktopOwner | undefined, target: ClaudeBackgroundUiTarget): boolean {
  if (!owner) return false
  const expected = snapshotClaudeBackgroundUiTarget(owner)
  return Object.keys(expected).every(key => expected[key as keyof ClaudeBackgroundUiTarget] === target[key as keyof ClaudeBackgroundUiTarget])
}

const nativeOwners = new WeakMap<ClaudeNativeTerminalOwner, { key: string; owner: ClaudeUiOwner }>()

/** Native UI authority belongs to one observed view; targeted mounts never follow a different selection. */
export function getClaudeUiOwner(threadId: string, target?: ClaudeNativeAgentUiTarget, background?: ClaudeBackgroundUiTarget): ClaudeUiOwner | undefined {
  if (background) {
    if (target) return
    const desktop = getNativeBackgroundDesktopOwner(threadId, {sessionId: background.parentSessionId, continuedInSessionId: background.sessionId})
    if (!desktop) return
    if (!matchesClaudeBackgroundUiTarget(desktop, background)) return
    const cached = backgroundOwners.get(desktop)
    if (cached) return cached
    const initialized = desktop.transport.request({subtype: 'apack_ui_capabilities'}).then(value => z.object({capabilities: z.array(z.string())}).parse(value))
    initialized.catch(() => {})
    const owner: ClaudeUiOwner = {
      done: desktop.done, sessionId: desktop.identity.sessionId, subscribe: listener => desktop.transport.subscribe(listener),
      approval: createClaudeChildApprovalSource(desktop),
      question: {
        ownerId: desktop.id,
        row() { const current = desktop.controls.value; const q = current?.kind === 'question' ? current.dialog : undefined; return q ? {messageId: `${desktop.id}:${q.id}:${q.revision}`, id: q.id, revision: q.revision, sessionId: q.sessionId, requestId: q.requestId} : undefined },
        subscribe: desktop.controls.subscribe,
        async render(request) {
          if (request.sessionId !== desktop.identity.sessionId) throw new Error('Background question owner changed')
          return ClaudeNativeQuestionRenderSchema.parse(await desktop.transport.request({subtype: 'apack_render_question_dialog', id: request.id, revision: request.revision, session_id: request.sessionId, client_id: request.clientId, viewport: request.viewport}))
        },
        async hold(request) {
          if (request.sessionId !== desktop.identity.sessionId) throw new Error('Background question owner changed')
          const result = await desktop.transport.request({subtype: 'apack_hold_question_dialog', id: request.id, revision: request.revision, session_id: request.sessionId, client_id: request.clientId, render_token: request.renderToken}) as {held?: unknown}
          if (result.held !== true) throw new Error('Background question draft was not acknowledged')
        },
        async reject(request) {
          const current=desktop.controls.value, q=current?.kind==='question'?current.dialog:undefined
          if(!q||q.id!==request.id||q.revision!==request.revision||q.sessionId!==request.sessionId)throw new Error('Background question changed')
          const result=await desktop.transport.request({subtype:'apack_deny_question_dialog',id:request.id,revision:request.revision,session_id:request.sessionId,render_token:request.renderToken,draft_started:request.draftStarted}) as {answered?:unknown}
          if(result.answered!==true)throw new Error('Background question rejection was not acknowledged')
          desktop.controls.settled(request.id,request.revision)
        },
        async answer(request) {
          const current = desktop.controls.value; const q = current?.kind === 'question' ? current.dialog : undefined
          if (!q || q.id !== request.id || q.revision !== request.revision || q.sessionId !== request.sessionId) throw new Error('Background question changed')
          const result = await desktop.transport.request({subtype: 'apack_answer_question_dialog', id: request.id, revision: request.revision, session_id: request.sessionId, answer: request.answer, render_token: request.renderToken, draft_started: request.draftStarted}) as {answered?: unknown}
          if (result.answered !== true) throw new Error('Background question answer was not acknowledged')
          desktop.controls.settled(request.id, request.revision)
        },
      },
      handle: {ui: createClaudeUiControls(initialized, desktop.transport, desktop.transport.promptHosts)},
    }
    backgroundOwners.set(desktop, owner)
    return owner
  }
  const native = getNativeTerminal(threadId)
  if (!native) return target ? undefined : getConversation(threadId)?.owner
  const state = native.state, view = state.view
  if (state.status !== 'live' || state.continuation || !view) return
  if (target ? state.ownerId !== target.ownerId || state.sessionId !== target.sessionId || view.kind !== 'agent' || view.taskId !== target.taskId || view.revision !== target.revision : view.kind !== 'main') return
  const key = JSON.stringify([state.sessionId, view.revision, target?.taskId ?? null])
  const cached = nativeOwners.get(native)
  if (cached?.key === key) return cached.owner
  const initialized = native.uiTransport.request({ subtype: 'apack_ui_capabilities' }).then(value => z.object({ capabilities: z.array(z.string()) }).parse(value))
  // A view can disappear before attach awaits metadata; retain the error for that attach.
  initialized.catch(() => {})
  const owner: ClaudeUiOwner = {
    nativeView: target ? { session_id: target.sessionId, revision: target.revision, agent_id: target.taskId } : undefined,
    readAgent: target ? async () => {
      const result = await native.operateTask(target.taskId, 'inspect')
      if (getClaudeUiOwner(threadId, target) !== owner || !result.details) throw new Error('Native Agent selection changed')
      return result.details
    } : undefined,
    done: native.done,
    get billing() { return native.state.status === 'live' && native.state.sessionId === state.sessionId ? native.state.billing : undefined },
    sessionId: state.sessionId,
    subscribe: listener => native.uiTransport.subscribe(listener),
    question: { ownerId: native.state.ownerId, render: native.renderQuestionDialog, hold: native.holdQuestionDialog },
    handle: { ui: createClaudeUiControls(initialized, native.uiTransport, native.uiTransport.promptHosts) },
  }
  nativeOwners.set(native, { key, owner })
  return owner
}
