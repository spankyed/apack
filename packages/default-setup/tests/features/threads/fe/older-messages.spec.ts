// The chat asks for a thread's older messages as it scrolls to the top: once per page, and only while there is one.
import { afterAll, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { startFeTestRuntime } from '@apackdev/sdk/testing'
import threadsState from '#features/threads/fe/state.ts'

// The surface's module tracks the mouse for its hotkeys as it loads; the test setup's window is a bare stand-in
vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })

const sent: Array<{ type: string }> = []
afterAll(startFeTestRuntime({ client: { send(message: { event: { type: string } }) { sent.push(message.event) } } }))

const asked = () => sent.filter((event) => event.type === 'LOAD_MORE_MESSAGES')

function openThread(page: { hasMore: boolean; nextCursor: string | null }) {
  sent.length = 0
  const actor = createActor(threadsState).start()
  actor.send({ type: 'LOAD_CHAT_THREAD', restore: true, data: { id: 'Thread-t1', messages: [], ...page } as never })
  return actor
}

it('asks once for the page before the oldest message, and not again while that page is loading', () => {
  const actor = openThread({ hasMore: true, nextCursor: 'm-1' })
  actor.send({ type: 'LOAD_MORE_MESSAGES' })
  actor.send({ type: 'LOAD_MORE_MESSAGES' })
  expect(asked()).toEqual([{ type: 'LOAD_MORE_MESSAGES', threadId: 'Thread-t1', cursor: 'm-1' }])
  expect(actor.getSnapshot().context.messagePagination.isLoading).toBe(true)
})

it('asks for nothing, and shows nothing loading, when the thread has no older page', () => {
  const actor = openThread({ hasMore: false, nextCursor: null })
  actor.send({ type: 'LOAD_MORE_MESSAGES' })
  expect(asked()).toEqual([])
  expect(actor.getSnapshot().context.messagePagination.isLoading).toBe(false)
})

it('seeks a message opened from search only in its own thread, and stops when another thread loads', () => {
  const actor = openThread({ hasMore: true, nextCursor: 'm-1' })
  actor.send({ type: 'OPEN_MESSAGE', threadId: 'Thread-t1', messageId: 'Message-old' })
  actor.send({ type: 'LOAD_CHAT_THREAD', restore: true, data: { id: 'Thread-t1', messages: [], hasMore: true, nextCursor: 'm-1' } as never })
  expect(asked()).toEqual([{ type: 'LOAD_MORE_MESSAGES', threadId: 'Thread-t1', cursor: 'm-1' }])

  actor.send({ type: 'LOAD_CHAT_THREAD', restore: true, data: { id: 'Thread-t2', messages: [], hasMore: true, nextCursor: 'n-1' } as never })
  actor.send({ type: 'OLDER_MESSAGES_LOADED', threadId: 'Thread-t1', messages: [], hasMore: true, nextCursor: 'm-2' })
  expect(asked().map((event) => (event as { threadId?: string }).threadId)).toEqual(['Thread-t1'])
  expect(actor.getSnapshot().context.focusMessage).toBeNull()
})
