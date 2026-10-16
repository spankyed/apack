import { PassThrough } from 'node:stream'
import { runThreadTeardown } from '#features/threads/be/thread-teardown.ts'
import { closeIdleConversation, getHandle, isConversationBusy, killAllHandles, openConversation } from '#features/code/be/services/claude-code/handle-store.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'
import type { StreamLine } from '#features/code/be/services/claude-code/types.ts'
function native() {
  const events = new PassThrough({ objectMode: true })
  const handle = { events: events as AsyncIterable<StreamLine>, close: vi.fn(async () => { events.end() }), kill: vi.fn(() => events.end()) } as unknown as QueryHandle
  return handle
}
afterEach(killAllHandles)
it('reserves startup atomically and cancels the spawned process when thread teardown wins', async () => {
  let resolve!: (handle: QueryHandle) => void
  const spawned = new Promise<QueryHandle>(yes => { resolve = yes })
  const starting = openConversation('starting-thread', 'launch', () => spawned, async () => {})
  expect(isConversationBusy('starting-thread')).toBe(true)
  await expect(openConversation('starting-thread', 'duplicate', async () => native(), async () => {})).rejects.toThrow('already exists')
  runThreadTeardown('starting-thread')
  const handle = native()
  resolve(handle)
  await expect(starting).rejects.toThrow('startup was cancelled')
  expect(handle.kill).toHaveBeenCalledOnce()
  expect(getHandle('starting-thread')).toBeUndefined()
})
it('keeps an idle process addressable for controls and closes it before a history operation', async () => {
  const handle = native()
  await openConversation('idle-thread', 'launch', async () => handle, async () => {})
  expect(getHandle('idle-thread')).toBe(handle)
  expect(isConversationBusy('idle-thread')).toBe(false)
  expect(await closeIdleConversation('idle-thread')).toBe(true)
  expect(handle.close).toHaveBeenCalledOnce()
  expect(getHandle('idle-thread')).toBeUndefined()
})
it('kills idle processes on thread teardown and global pack shutdown', async () => {
  const first = native(), second = native()
  const a = await openConversation('delete-thread', 'a', async () => first, async () => {})
  const b = await openConversation('shutdown-thread', 'b', async () => second, async () => {})
  runThreadTeardown('delete-thread')
  killAllHandles()
  await Promise.all([a.done, b.done])
  expect(first.kill).toHaveBeenCalledOnce()
  expect(second.kill).toHaveBeenCalledOnce()
  expect(getHandle('delete-thread')).toBeUndefined()
  expect(getHandle('shutdown-thread')).toBeUndefined()
})
