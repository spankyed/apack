// The link form's refusal: the reason a save of a thread's links was refused, shown under that thread's links, and only
// that thread's. The surface keeps the call its save went under and takes the refusal answering it, so a refusal that
// lands after the window moved to another thread is not shown there.
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { askAnswered, askFailed, startFeTestRuntime } from '@apackdev/sdk/testing'

// The surface's module tracks the mouse for its hotkeys as it loads; the test setup's window is a bare stand-in
vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })

const calls = vi.hoisted(() => ({ next: 0 }))
const sendToSystem = vi.hoisted(() => vi.fn(() => `call-${++calls.next}`))
vi.mock('#generated/events.ts', async (actual) => ({ ...(await actual<object>()), sendToSystem }))

const { default: threadsState } = await import('#features/threads/fe/state.ts')

afterAll(startFeTestRuntime({ client: { send() {}, watchView() { return () => {} } } }))
beforeEach(() => { sendToSystem.mockClear() })

const links = [{ relation: 'blocks', id: 'Thread-b' }]

function viewing(threadId: string) {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'SELECT_THREAD', id: threadId })
  return actor
}

/** Saves the open thread's links, answering with the call the save went under */
function saveLinks(actor: ReturnType<typeof viewing>) {
  actor.send({ type: 'UPDATE_THREAD_FIELD', key: 'linkedThreads', value: links as never, state: 'view' })
  const save = sendToSystem.mock.results.at(-1)!.value as string
  /** Answers the save: refused with the reason given, or landed with none */
  return (refusal?: string) =>
    actor.send(refusal === undefined
      ? askAnswered(save, 'UPDATE_THREAD_FIELD', undefined)
      : askFailed(save, 'UPDATE_THREAD_FIELD', { kind: 'failed', message: refusal }))
}

it("shows the reason a save of the open thread's links was refused, until a save lands", () => {
  const actor = viewing('Thread-a')
  saveLinks(actor)('THR-2 already blocks THR-1')
  expect(actor.getSnapshot().context.linkRefusal).toBe('THR-2 already blocks THR-1')
  saveLinks(actor)()
  expect(actor.getSnapshot().context.linkRefusal).toBeNull()
})

it('shows another thread no refusal of a save made before the window moved to it', () => {
  const actor = viewing('Thread-a')
  const answer = saveLinks(actor)
  actor.send({ type: 'SELECT_THREAD', id: 'Thread-c' })
  answer('THR-2 already blocks THR-1')
  expect(actor.getSnapshot().context.linkRefusal).toBeNull()
})

it('takes no refusal of a write other than a links save', () => {
  const actor = viewing('Thread-a')
  actor.send({ type: 'UPDATE_THREAD_FIELD', key: 'topic', value: 'Renamed' as never, state: 'view' })
  const topic = sendToSystem.mock.results.at(-1)!.value as string
  actor.send(askFailed(topic, 'UPDATE_THREAD_FIELD', { kind: 'failed', message: 'Thread Thread-a not found' }))
  expect(actor.getSnapshot().context.linkRefusal).toBeNull()
})
