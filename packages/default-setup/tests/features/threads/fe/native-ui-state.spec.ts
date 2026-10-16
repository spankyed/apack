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
