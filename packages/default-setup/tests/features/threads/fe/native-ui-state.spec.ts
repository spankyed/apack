import { createActor } from 'xstate'
import { startFeTestRuntime } from '@apackdev/sdk/testing'
import threadsState from '#features/threads/fe/state.ts'
vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })
afterAll(startFeTestRuntime({ client: { send() {} } }))

it('ignores another view/thread and late replies after unmount without reviving a closed slot', () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'CLAUDE_UI_MOUNT', mountId: 'mounted', threadId: 'thread-one' })
  const state = { status: 'live' as const, tree: { kind: 'button' as const, label: 'Run', actionId: 'opaque' } }
  actor.send({ type: 'CLAUDE_UI_STATE', mountId: 'other', threadId: 'thread-one', state })
  actor.send({ type: 'CLAUDE_UI_STATE', mountId: 'mounted', threadId: 'thread-two', state })
  expect(actor.getSnapshot().context.nativeUiViews).toEqual({ mounted: { threadId: 'thread-one', state: { status: 'connecting' } } })
  actor.send({ type: 'CLAUDE_UI_STATE', mountId: 'mounted', threadId: 'thread-one', state })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.state).toEqual(state)
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', mountId: 'mounted', threadId: 'thread-one' })
  actor.send({ type: 'CLAUDE_UI_STATE', mountId: 'mounted', threadId: 'thread-one', state })
  expect(actor.getSnapshot().context.nativeUiViews).toEqual({})
  actor.stop()
})


it('correlates native draft replies with the latest edit in the mounted thread slot', () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'CLAUDE_UI_MOUNT', mountId: 'mounted', threadId: 'thread-one' })
  const edit = { type: 'CLAUDE_PROMPT_EDIT' as const, mountId: 'mounted', threadId: 'thread-one', by: 'person' as const, text: 'draft', cursor: 5 }
  actor.send({ ...edit, revision: 1 }); actor.send({ ...edit, revision: 2 })
  const reply = { type: 'CLAUDE_PROMPT_STATE' as const, mountId: 'mounted', threadId: 'thread-one', result: { revision: 1, status: 'applied' as const, frame: { text: 'OLD', cursor: 3 } } }
  actor.send(reply)
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt).toBeUndefined()
  actor.send({ ...reply, threadId: 'foreign', result: { ...reply.result, revision: 2 } })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt).toBeUndefined()
  actor.send({ ...reply, result: { ...reply.result, revision: 2 } })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt?.revision).toBe(2)
  actor.send({ type: 'CLAUDE_UI_STATE', mountId: 'mounted', threadId: 'thread-one', state: { status: 'live', tree: { kind: 'text', text: 'controls' } } })
  expect(actor.getSnapshot().context.nativeUiViews.mounted?.prompt?.revision).toBe(2)
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', mountId: 'mounted', threadId: 'thread-one' }); actor.send({ ...reply, result: { ...reply.result, revision: 2 } })
  expect(actor.getSnapshot().context.nativeUiViews).toEqual({}); actor.stop()
})


it('rejects completion replies from another view or an older edit and retires rows on edit/unmount', () => {
  const actor = createActor(threadsState).start()
  const identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', ...identity })
  actor.send({ type: 'CLAUDE_PROMPT_EDIT', ...identity, revision: 1, by: 'app', text: 'tok', cursor: 3 })
  actor.send({ type: 'CLAUDE_PROMPT_AUTOCOMPLETE', ...identity, revision: 1, text: 'tok', cursor: 3 })
  const result = { revision: 1, status: 'ready' as const, result: { start: 0, suggestions: [{ text: 'token' }] } }
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, mountId: 'foreign', result })
  expect(actor.getSnapshot().context.nativeUiViews.view?.completions).toBeUndefined()
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, result })
  expect(actor.getSnapshot().context.nativeUiViews.view?.completions).toEqual(result)
  actor.send({ type: 'CLAUDE_PROMPT_EDIT', ...identity, revision: 2, by: 'person', text: 'toke', cursor: 4 })
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, result })
  expect(actor.getSnapshot().context.nativeUiViews.view?.completions).toBeUndefined()
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity })
  actor.send({ type: 'CLAUDE_PROMPT_COMPLETIONS', ...identity, result })
  expect(actor.getSnapshot().context.nativeUiViews.view).toBeUndefined()
  actor.stop()
})


it('rejects foreign and superseded focus and clears a pending redirect when the person moves again', () => {
  const actor = createActor(threadsState).start(), identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', ...identity })
  const focus = { type: 'CLAUDE_UI_FOCUS' as const, ...identity, revision: 1, isHeld: true, focusId: 'one', by: 'person' as const }
  actor.send(focus); actor.send({ ...focus, revision: 2, focusId: 'two' })
  const reply = { type: 'CLAUDE_UI_FOCUS_STATE' as const, ...identity, result: { revision: 1, moved: true, focusId: 'old' } }
  actor.send(reply); expect(actor.getSnapshot().context.nativeUiViews.view?.focus).toBeUndefined()
  actor.send({ ...reply, threadId: 'foreign', result: { ...reply.result, revision: 2 } }); expect(actor.getSnapshot().context.nativeUiViews.view?.focus).toBeUndefined()
  actor.send({ ...reply, result: { revision: 2, moved: true, focusId: 'redirect' } }); expect(actor.getSnapshot().context.nativeUiViews.view?.focus?.focusId).toBe('redirect')
  actor.send({ ...focus, revision: 3, isHeld: false }); expect(actor.getSnapshot().context.nativeUiViews.view?.focus).toBeUndefined()
  actor.send({ type: 'CLAUDE_UI_UNMOUNT', ...identity }); actor.send(reply); expect(actor.getSnapshot().context.nativeUiViews).toEqual({})
  actor.stop()
})


it('routes only the current prompt host response and retires requests when the owner disconnects', () => {
  const actor = createActor(threadsState).start(), identity = { mountId: 'view', threadId: 'thread' }
  actor.send({ type: 'CLAUDE_UI_MOUNT', ...identity })
  const request = { requestId: 'request', revision: 1, expiresAt: Date.now() + 3000, kind: 'read' as const }
  actor.send({ type: 'CLAUDE_PROMPT_HOST_REQUEST', ...identity, threadId: 'foreign', request })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toBeUndefined()
  actor.send({ type: 'CLAUDE_PROMPT_HOST_REQUEST', ...identity, request })
  actor.send({ type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...identity, requestId: 'foreign', kind: 'read', box: { text: 'wrong', cursor: 0 } })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toEqual(request)
  actor.send({ type: 'CLAUDE_PROMPT_HOST_RESPONSE', ...identity, requestId: request.requestId, kind: 'fill', filled: true })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toEqual(request)
  actor.send({ type: 'CLAUDE_UI_STATE', ...identity, state: { status: 'disconnected' } })
  expect(actor.getSnapshot().context.nativeUiViews.view?.promptHostRequest).toBeUndefined()
  actor.stop()
})
