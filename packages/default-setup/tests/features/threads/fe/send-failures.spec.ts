// A message of this window's that was not sent: held until the chat has told the person, and then dropped, so each
// is told once and one noted meanwhile is not lost.
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

/** Sends a message and ends its ask refused with `message` */
async function sendRefused(actor: ReturnType<typeof createActor<typeof threadsState>>, message: string) {
  actor.send({ type: 'SEND_MESSAGE', text: 'hello' })
  asks.filter(ask => ask.type === 'USER_MSG').at(-1)!.end({ ok: false, failure: { kind: 'failed', message } })
  await new Promise(setImmediate)
}

it('holds each message that was not sent until the chat says it told the person', async () => {
  const actor = createActor(threadsState).start()
  await sendRefused(actor, 'The assistant is not running')
  const [first] = actor.getSnapshot().context.sendFailures
  expect(first).toEqual({ message: 'The assistant is not running' })

  // One noted after the chat read the first is kept when the chat says it told the first
  await sendRefused(actor, 'The assistant is not running')
  actor.send({ type: 'CHAT.FAILURES_TOLD', told: [first!] })
  expect(actor.getSnapshot().context.sendFailures).toHaveLength(1)
  expect(actor.getSnapshot().context.sendFailures[0]).not.toBe(first)
})

it('holds nothing for a message that was sent', async () => {
  const actor = createActor(threadsState).start()
  actor.send({ type: 'SEND_MESSAGE', text: 'hello' })
  asks.filter(ask => ask.type === 'USER_MSG').at(-1)!.end({ ok: true, value: { threadId: 'Thread-a', started: false } })
  await new Promise(setImmediate)
  expect(actor.getSnapshot().context.sendFailures).toEqual([])
})
