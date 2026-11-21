// A machine's record of the asks it spawned: under way from the action that spawns one to the action that stops it,
// including for an event raised in the same step, which the machine's children do not yet show.
import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, setup } from 'xstate'
import { askUnderWay, enqueueAsks, noAsks, stopAsks, type AsksUnderWay } from '../../src/fe/asks-under-way.ts'

const PUSH = 'push'

/** A machine that pushes unless a push is under way; `PUSH_TWICE` raises a second push in the step of the first */
function pusher() {
  const started: string[] = []
  const machine = setup({
    types: {} as { context: { asking: AsksUnderWay }; events: { type: 'PUSH' } | { type: 'PUSH_TWICE' } | { type: 'STOP' } },
    actors: { push: fromPromise<void, { n: number }>(() => new Promise<void>(() => {})) },
  }).createMachine({
    context: { asking: noAsks() },
    on: {
      PUSH: {
        guard: ({ context }) => !askUnderWay(context.asking, PUSH),
        actions: enqueueAsks(({ enqueue }) => {
          started.push(PUSH)
          enqueue.spawnChild('push', { id: PUSH, input: { n: started.length } })
        }),
      },
      PUSH_TWICE: { actions: enqueueAsks(({ enqueue }) => { enqueue.raise({ type: 'PUSH' }); enqueue.raise({ type: 'PUSH' }) }) },
      STOP: { actions: stopAsks(PUSH) },
    },
  })
  return { actor: createActor(machine).start(), started }
}

describe('asks under way', () => {
  it('holds an ask from the action that spawns it to the one that stops it', () => {
    const { actor } = pusher()
    expect(askUnderWay(actor.getSnapshot().context.asking, PUSH)).toBe(false)
    actor.send({ type: 'PUSH' })
    expect(askUnderWay(actor.getSnapshot().context.asking, PUSH)).toBe(true)
    expect(Object.keys(actor.getSnapshot().children)).toEqual([PUSH])
    actor.send({ type: 'STOP' })
    expect(askUnderWay(actor.getSnapshot().context.asking, PUSH)).toBe(false)
    expect(Object.keys(actor.getSnapshot().children)).toEqual([])
  })

  it('shows an ask to an event raised in the step that spawned it', () => {
    const { actor, started } = pusher()
    actor.send({ type: 'PUSH_TWICE' })
    expect(started, 'the second push saw the first under way').toEqual([PUSH])
  })

  it('answers for any of several ids', () => {
    expect(askUnderWay({ a: true }, 'b', 'a')).toBe(true)
    expect(askUnderWay({ a: true }, 'b', 'c')).toBe(false)
  })

  it('refuses a machine that keeps no record', () => {
    const unrecorded = setup({ types: {} as { events: { type: 'GO' } }, actors: { push: fromPromise(async () => {}) } }).createMachine({
      on: { GO: { actions: enqueueAsks(({ enqueue }) => { enqueue.spawnChild('push', { id: PUSH }) }) } },
    })
    const errors: unknown[] = []
    const actor = createActor(unrecorded)
    actor.subscribe({ error: (error) => { errors.push(error) } })
    actor.start().send({ type: 'GO' })
    expect(String(errors[0])).toContain('asking: AsksUnderWay')
  })
})
