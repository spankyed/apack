// The link form's refusal: the reason a save of a thread's links was refused, shown under that thread's links, and only
// that thread's. The surface keeps which ask its save is and takes that ask's refusal, so a refusal that lands after
// the window moved to another thread is not shown there.
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { startFeTestRuntime } from '@apackdev/sdk/testing'

// The surface's module tracks the mouse for its hotkeys as it loads; the test setup's window is a bare stand-in
vi.hoisted(() => { (globalThis as { addEventListener?: unknown }).addEventListener ??= () => {} })

/** The asks the surface made, in order, each ended by the case as the system would */
const asks = vi.hoisted(() => [] as { type: string; end(outcome: object): void }[])
vi.mock('#generated/events.ts', async (actual) => {
  const { fromPromise } = await import('xstate')
  return {
    ...(await actual<object>()),
    fromAsk: (_to: string, type: string) => fromPromise<object, object>(() => new Promise(end => { asks.push({ type, end }) })),
  }
})

const { default: threadsState } = await import('#features/threads/fe/state.ts')

afterAll(startFeTestRuntime({ client: { send() {}, watchView() { return () => {} } } }))
beforeEach(() => { asks.length = 0 })

/** Ends an ask, and lets the surface take how it ended */
async function end(ask: (typeof asks)[number], refusal?: string) {
  ask.end(refusal === undefined ? { ok: true, value: undefined } : { ok: false, failure: { kind: 'failed', message: refusal } })
  await new Promise(setImmediate)
}

const links = [{ relation: 'blocks', id: 'Thread-b' }]

function viewing(threadId: string) {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'SELECT_THREAD', id: threadId })
  return actor
}

/** Saves the open thread's links, answering with how to end the save: refused with the reason given, or landed with none */
function saveLinks(actor: ReturnType<typeof viewing>) {
  actor.send({ type: 'UPDATE_THREAD_FIELD', key: 'linkedThreads', value: links as never, state: 'view' })
  const save = asks.at(-1)!
  return (refusal?: string) => end(save, refusal)
}

it("shows the reason a save of the open thread's links was refused, until a save lands", async () => {
  const actor = viewing('Thread-a')
  await saveLinks(actor)('THR-2 already blocks THR-1')
  expect(actor.getSnapshot().context.linkRefusal).toBe('THR-2 already blocks THR-1')
  await saveLinks(actor)()
  expect(actor.getSnapshot().context.linkRefusal).toBeNull()
})

it('shows another thread no refusal of a save made before the window moved to it', async () => {
  const actor = viewing('Thread-a')
  const answer = saveLinks(actor)
  actor.send({ type: 'SELECT_THREAD', id: 'Thread-c' })
  await answer('THR-2 already blocks THR-1')
  expect(actor.getSnapshot().context.linkRefusal).toBeNull()
})

it('takes no refusal of a write other than a links save', async () => {
  const actor = viewing('Thread-a')
  actor.send({ type: 'UPDATE_THREAD_FIELD', key: 'topic', value: 'Renamed' as never, state: 'view' })
  await end(asks.at(-1)!, 'Thread Thread-a not found')
  expect(actor.getSnapshot().context.linkRefusal).toBeNull()
})
