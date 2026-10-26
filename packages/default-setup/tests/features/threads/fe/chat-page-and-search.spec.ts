// The chat's page of a thread's messages and the panel's message search, each a view the surface follows. Scrolling to
// the top asks for a longer page once per page and only while there is one; a message opened from search grows the page
// of its own thread until the page lists it; the search box follows one query's view, and its results are that query's.
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { startFeTestRuntime } from '@apackdev/sdk/testing'
import type { ViewRequest } from '@apackdev/sdk/framework'
import threadsState from '#features/threads/fe/state.ts'

// The surface's module tracks the mouse for its hotkeys as it loads; the test setup's window is a bare stand-in
vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })

/** Every view the surface subscribed to, and whether it still is */
const watched: Array<{ request: ViewRequest; open: boolean }> = []
afterAll(startFeTestRuntime({
  client: {
    send() {},
    watchView(request: ViewRequest) {
      const entry = { request, open: true }
      watched.push(entry)
      return () => { entry.open = false }
    },
  },
}))
beforeEach(() => { watched.length = 0 })

const asked = (view: string) => watched.filter((w) => w.request.view === view).map((w) => w.request.args)
const following = (view: string) => watched.filter((w) => w.request.view === view && w.open).map((w) => w.request.args)
const page = (threadId: string, messageIds: string[], hasMore: boolean) =>
  ({ type: 'CHAT.READ', threadId, chat: { id: threadId, messageIds, hasMore } as never }) as const

function openThread(threadId = 'Thread-t1') {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'OPEN_THREAD_CHAT', threadId })
  return actor
}

it('asks once for a longer page, and not again while that page is loading', () => {
  const actor = openThread()
  actor.send(page('Thread-t1', ['m-2'], true))
  actor.send({ type: 'LOAD_MORE_MESSAGES' })
  actor.send({ type: 'LOAD_MORE_MESSAGES' })
  expect(asked('chat')).toEqual([{ threadId: 'Thread-t1', limit: 50 }, { threadId: 'Thread-t1', limit: 100 }])
  expect(actor.getSnapshot().context.messagePagination.isLoading).toBe(true)
})

it('asks for nothing, and shows nothing loading, when the thread has no older message', () => {
  const actor = openThread()
  actor.send(page('Thread-t1', ['m-1'], false))
  actor.send({ type: 'LOAD_MORE_MESSAGES' })
  expect(asked('chat')).toEqual([{ threadId: 'Thread-t1', limit: 50 }])
  expect(actor.getSnapshot().context.messagePagination.isLoading).toBe(false)
})

it("grows a message's own thread's page until the page lists it", () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'OPEN_MESSAGE', threadId: 'Thread-t1', messageId: 'm-old' })
  actor.send(page('Thread-t1', ['m-new'], true))
  actor.send(page('Thread-t1', ['m-mid', 'm-new'], true))
  actor.send(page('Thread-t1', ['m-old', 'm-mid', 'm-new'], true))
  expect(asked('chat').map((args) => (args as { limit: number }).limit)).toEqual([50, 100, 150])
  expect(actor.getSnapshot().context.focusMessage).toEqual({ threadId: 'Thread-t1', messageId: 'm-old' })
})

it('seeks in the thread already open, and gives up where the thread has no more', () => {
  const actor = openThread()
  actor.send(page('Thread-t1', ['m-new'], false))
  actor.send({ type: 'OPEN_MESSAGE', threadId: 'Thread-t1', messageId: 'm-gone' })
  expect(asked('chat')).toHaveLength(1)
  expect(actor.getSnapshot().context.focusMessage).toBeNull()
})

it('stops seeking when another thread opens in its place', () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'OPEN_MESSAGE', threadId: 'Thread-t1', messageId: 'm-old' })
  actor.send({ type: 'OPEN_THREAD_CHAT', threadId: 'Thread-t2' })
  actor.send(page('Thread-t2', ['n-1'], true))
  expect(asked('chat')).toEqual([{ threadId: 'Thread-t1', limit: 50 }, { threadId: 'Thread-t2', limit: 50 }])
  expect(actor.getSnapshot().context.focusMessage).toBeNull()
})

it("follows the box's query alone, and takes no result of a query it replaced", () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'SEARCH_MESSAGES', query: ' dep ' })
  actor.send({ type: 'SEARCH_MESSAGES', query: 'deploy' })
  expect(following('messageSearch')).toEqual([{ query: 'deploy' }])
  actor.send({ type: 'SEARCH.READ', query: 'dep', results: [{ messageId: 'm-1' } as never] })
  expect(actor.getSnapshot().context.messageSearch).toEqual({ query: 'deploy', results: [], searching: true })
  actor.send({ type: 'SEARCH.READ', query: 'deploy', results: [{ messageId: 'm-2' } as never] })
  expect(actor.getSnapshot().context.messageSearch).toMatchObject({ results: [{ messageId: 'm-2' }], searching: false })

  actor.send({ type: 'SEARCH_MESSAGES', query: '' })
  expect(following('messageSearch')).toEqual([])
  expect(actor.getSnapshot().context.messageSearch).toEqual({ query: '', results: [], searching: false })
})
