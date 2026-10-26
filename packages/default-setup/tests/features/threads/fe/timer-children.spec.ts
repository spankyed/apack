// The threads surface clears a new thread's flag and a flashed chat state on a timer, each a child actor. A timer
// leaves the surface's children once it fires, and a later timer for the same thread replaces the earlier one.
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { startFeTestRuntime } from '@apackdev/sdk/testing'
import threadsState from '#features/threads/fe/state.ts'

// The surface's module tracks the mouse for its hotkeys as it loads; the test setup's window is a bare stand-in
vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })

afterAll(startFeTestRuntime({ client: { send() {}, watchView: () => () => {} } }))
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const children = (actor: ReturnType<typeof startThreads>) => Object.keys(actor.getSnapshot().children)

function startThreads() {
  return createActor(threadsState).start()
}

it('drops the new-thread timer once it clears the flag', () => {
  const actor = startThreads()
  actor.send({ type: 'THREADS.READ', threads: [{ id: 'Thread-t1', topic: 'New' } as never] })
  actor.send({ type: 'THREAD_CREATED', id: 'Thread-t1' })
  expect(children(actor)).toContain('clear-new-thread-flag-Thread-t1')
  expect(actor.getSnapshot().context.threadMap['Thread-t1']?.isNew).toBe(true)

  vi.advanceTimersByTime(1000)

  expect(children(actor)).not.toContain('clear-new-thread-flag-Thread-t1')
  expect(actor.getSnapshot().context.threadMap['Thread-t1']?.isNew).toBe(false)
})

it('drops the chat state timer once the override expires', () => {
  const actor = startThreads()
  actor.send({ type: 'FLASH_CHAT_STATE', threadId: 'Thread-t1', stateId: 'saved', durationMs: 500 })
  expect(children(actor)).toContain('clear-expired-override-Thread-t1')

  vi.advanceTimersByTime(500)

  expect(children(actor)).not.toContain('clear-expired-override-Thread-t1')
  expect(actor.getSnapshot().context.chatStateOverrides['Thread-t1']).toBeUndefined()
})

it("keeps a thread's later chat state override until its own timer, not the earlier one's", () => {
  const actor = startThreads()
  actor.send({ type: 'FLASH_CHAT_STATE', threadId: 'Thread-t1', stateId: 'first', durationMs: 500 })
  vi.advanceTimersByTime(300)
  actor.send({ type: 'FLASH_CHAT_STATE', threadId: 'Thread-t1', stateId: 'second', durationMs: 500 })

  vi.advanceTimersByTime(300)
  expect(actor.getSnapshot().context.chatStateOverrides['Thread-t1']?.id).toBe('second')

  vi.advanceTimersByTime(200)
  expect(actor.getSnapshot().context.chatStateOverrides['Thread-t1']).toBeUndefined()
  expect(children(actor)).not.toContain('clear-expired-override-Thread-t1')
})
