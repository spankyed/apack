// An ask that changes something as it answers: `answered(answer, next)`. The answer and the change are one thing.
// Whoever asked is never told of a change that was not made, and never sees the answer ahead of the change.
//
//   npx tsx docs/plans/apack-spec/prototype/answer-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { explore, type Schedule } from './schedule.mts'
import { answered, given, reaching, system } from './state.mts'

type CounterAsks = {
  /** Reads, and changes nothing. */
  READ: { args: {}; answer: number }
  /** Adds one, and answers with what it is then. */
  ADD: { args: {}; answer: number }
  /** Closes it, giving the reason: a move that needs data. */
  CLOSE: { args: { reason: string }; answer: 'closed' }
  /** Adds one after outside work, as an edit to a draft. */
  ADD_LATER: { args: { after: string }; answer: 'added' }
  /** Answers with a change the data has no place for. */
  ADD_ELSEWHERE: { args: {}; answer: 'added' }
}
type CounterEvent = { type: 'REOPEN' }
type Counter = { data: { count: number }; states: { open: {}; closed: { data: { reason: string } } } }
const state = reaching()

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

const counter = (work: (label: string) => Promise<unknown>) => state<Counter, CounterEvent, CounterAsks>()({
  data: { count: 0 },
  start: 'open',
  on: { REOPEN: () => ({ at: 'open' }) },
  asks: { READ: (_, { data }) => data.count },
  states: {
    open: {
      asks: {
        ADD: (_, { data }) => answered(data.count + 1, { data: { count: data.count + 1 } }),
        CLOSE: ({ reason }) => answered('closed' as const, { at: 'closed', data: { reason } }),
        ADD_LATER: async ({ after }) => {
          await work(after)
          return answered('added' as const, { data: (d) => { d.count++ } })
        },
        // The types refuse this, which is why it is cast: the check is what the kernel does if one gets through.
        ADD_ELSEWHERE: () => answered('added' as const, { data: ((d: { total: number }) => { d.total = 1 }) as unknown as (d: { count: number }) => void }),
      },
    },
    closed: { data: { reason: given } },
  },
})

const wired = (work: (label: string) => Promise<unknown> = () => turns(4)) => {
  const traced: string[] = []
  const sys = system({ side: 'backend', trace: (line) => { if (line.startsWith('DEFECT')) traced.push(line) } })
  const it = sys.start('counter', counter(work))
  return { sys, it, traced, now: () => sys.read(it) }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['an ask that only answers changes nothing', async () => {
    const { sys, it, now } = wired()
    deepStrictEqual(await sys.ask(it, 'READ', {}), { ok: true, value: 0 })
    deepStrictEqual(now(), { at: 'open', data: { count: 0 } })
    sys.stop()
  }],
  ['an ask that answers with a change makes it, and the change is there when the answer is', async () => {
    const { sys, it, now } = wired()
    const seenAtAnswer: number[] = []
    const answer = sys.ask(it, 'ADD', {}).then((outcome) => { seenAtAnswer.push(now().data.count); return outcome })
    deepStrictEqual(await answer, { ok: true, value: 1 })
    deepStrictEqual(seenAtAnswer, [1])
    sys.stop()
  }],
  ['subscribers hear of the change in the step the answer leaves in, and once', async () => {
    const { sys, it } = wired()
    const steps: string[] = []
    sys.subscribe((changed) => { steps.push(`changed ${changed.join(',')}`) })
    void sys.ask(it, 'ADD', {}).then(() => { steps.push('answered') })
    await turns(2)
    deepStrictEqual(steps, ['changed counter', 'answered'])
    sys.stop()
  }],
  ['an answer can come with a move, which gives the data the entered state needs', async () => {
    const { sys, it, now } = wired()
    deepStrictEqual(await sys.ask(it, 'CLOSE', { reason: 'done' }), { ok: true, value: 'closed' })
    deepStrictEqual(now(), { at: 'closed', data: { count: 0, reason: 'done' } })
    sys.stop()
  }],
  ['a change that is refused fails the ask: nobody is told of a change that was not made', async () => {
    const { sys, it, now, traced } = wired()
    const outcome = await sys.ask(it, 'ADD_ELSEWHERE', {})
    strictEqual(outcome.ok, false)
    strictEqual(!outcome.ok && outcome.failure.kind, 'failed')
    deepStrictEqual(now(), { at: 'open', data: { count: 0 } })
    strictEqual(traced.length, 1)
    sys.stop()
  }],
  ['a change after a wait is made against the data as it is then: two at once both count', async () => {
    const { sys, it, now } = wired()
    const both = await Promise.all([sys.ask(it, 'ADD_LATER', { after: 'one' }), sys.ask(it, 'ADD_LATER', { after: 'two' })])
    deepStrictEqual(both.map((outcome) => outcome.ok), [true, true])
    strictEqual(now().data.count, 2)
    sys.stop()
  }],
  ['an ask whose answering state was left before it finished is abandoned, and its change is not made', async () => {
    const { sys, it, now } = wired()
    const later = sys.ask(it, 'ADD_LATER', { after: 'one' })
    await sys.ask(it, 'CLOSE', { reason: 'early' })
    const outcome = await later
    strictEqual(!outcome.ok && outcome.failure.kind, 'abandoned')
    await turns(10)
    strictEqual(now().data.count, 0)
    sys.stop()
  }],
]

/** Three asks that each add one after work of their own, and one that closes, under every ordering. */
const racing = (schedule: Schedule): (() => void) => {
  const sys = system({ side: 'backend', later: schedule.later })
  const it = sys.start('counter', counter((label) => schedule.work(label, null)))
  const outcomes: Array<{ ok: boolean }> = []
  for (const each of ['one', 'two', 'three']) void sys.ask(it, 'ADD_LATER', { after: each }).then((outcome) => { outcomes.push(outcome) })
  schedule.does('the user', ['closes', () => { void sys.ask(it, 'CLOSE', { reason: 'enough' }) }])
  return () => {
    strictEqual(outcomes.length, 3)
    // Every ask that was told it added did, and no other did: the count is exactly the answers that said so.
    strictEqual(sys.read(it).data.count, outcomes.filter((outcome) => outcome.ok).length)
  }
}

// What must not compile.
state<Counter, CounterEvent, CounterAsks>()({
  data: { count: 0 },
  start: 'open',
  states: {
    open: {
      asks: {
        // @ts-expect-error after a wait, data is changed by editing a draft, not by giving fields worked out before it
        ADD_LATER: async (_, { data }) => answered('added' as const, { data: { count: data.count + 1 } }),
        // @ts-expect-error a move into `closed` has to give its reason
        CLOSE: () => answered('closed' as const, { at: 'closed' }),
        // @ts-expect-error the answer is still checked: this ask answers with a number
        ADD: () => answered('one', { data: { count: 1 } }),
      },
    },
    closed: { data: { reason: given } },
  },
})

const unhandled: unknown[] = []
process.on('unhandledRejection', (reason) => { unhandled.push(reason) })

let failed = 0
for (const [name, check] of checks) {
  try { await check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n').slice(0, 6).join(' ')}`) }
}
{
  const name = 'under every ordering of three such asks and a close, the count is exactly the answers that said they added'
  const found = await explore(racing)
  try {
    ok(!found.failure, found.failure && `${String(found.failure.error).split('\n')[0]} after: ${found.failure.taken.join(' → ')}`)
    ok(found.complete && found.orderings > 1, `ran ${found.orderings} orderings, ${found.complete ? 'all' : 'not all'}`)
    console.log(`  ok    ${name}  (${found.orderings} orderings, all there are)`)
  } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n')[0]}`) }
}
await turns(20)
if (unhandled.length) { failed++; console.log(`  FAIL  nothing was left unhandled\n        ${String(unhandled[0])}`) } else console.log('  ok    none of it left a rejection unhandled')
console.log(`\n${checks.length + 2 - failed} of ${checks.length + 2} passed`)
if (failed) process.exitCode = 1
