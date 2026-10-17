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
