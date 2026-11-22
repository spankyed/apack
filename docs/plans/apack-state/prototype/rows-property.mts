// The rule about rows as a property, and not as the cases somebody thought of: for any run of handlers that write,
// tell themselves more, throw, refuse, return a change that cannot be made, and wait, the rows kept are those written
// by what was made, the data counts what was made, an ask is answered as made exactly when it was, and nobody is told
// of a step while it is still writing.
//
// A run is generated from a seed and held against a model that knows nothing of the kernel: a few lines that say what
// the rule says. A run that differs is reported with its seed, and `SEED=<n>` runs that one alone.
//
//   npx tsx docs/plans/apack-state/prototype/rows-property.mts
import { deepStrictEqual } from 'node:assert'
import { rest, run, system } from './checks.mts'
import { sample, type Schedule } from './schedule.mts'
import { answered, reaching } from './state.mts'
import { memory, type Rows } from './store.mts'
import { elmdb } from './store-elmdb.mts'

const IDS = ['r0', 'r1', 'r2', 'r3'] as const
type Write = readonly [id: string, value: number | null]
/** How a handler ends: made, or one of the ways of changing nothing. */
type Ends = 'made' | 'throws' | 'refuses' | 'stray'
/** What a handler does: it writes, tells itself more, and ends. One that answers may write again in the change it returns. */
interface Does {
  readonly writes: readonly Write[]
  readonly sends: readonly Does[]
  readonly adds: number
  readonly ends: Ends
  readonly inChange: readonly Write[]
  readonly changeEnds: Ends
}
type Op = { readonly how: 'told' | 'asked' | 'asked, and it waits'; readonly does: Does }

// --- what the rule says -------------------------------------------------------------------------------------------

interface Model { rows: Map<string, number>; count: number }
const write = (rows: Map<string, number>, writes: readonly Write[]): void => { for (const [id, value] of writes) { if (value === null) rows.delete(id); else rows.set(id, value) } }
/**
 * Events, each handled in the order it was sent: what its handler wrote is kept if it was made, and what it told
 * itself waits its turn behind what was sent before, whether or not it was made.
 */
const told = (model: Model, ...first: readonly Does[]): void => {
  const waiting = [...first]
  for (let does = waiting.shift(); does; does = waiting.shift()) {
    const before = new Map(model.rows)
    write(model.rows, does.writes)
    if (does.ends === 'made') model.count += does.adds; else model.rows = before
    waiting.push(...does.sends)
  }
}
/**
 * An ask's handler and the change that comes with its answer. Answers whether it was made.
 *
 * One that does not wait is one thing: what the handler wrote and what its change wrote are kept together or not at
 * all, and what it told itself is handled after. One that waits is two: what it wrote before the wait is kept as its
 * step ends, what it told itself is handled then, and its change is made later, kept or not on its own.
 */
const asked = (model: Model, does: Does, waits: boolean): boolean => {
  const before = new Map(model.rows)
  write(model.rows, does.writes)
  if (waits) told(model, ...does.sends)
  const beforeChange = waits ? new Map(model.rows) : before
  let made = does.ends === 'made'
  if (made) {
    write(model.rows, does.inChange)
    made = does.changeEnds === 'made'
  }
  if (made) model.count += does.adds
  else if (!waits || does.ends === 'made') model.rows = beforeChange
  if (!waits) told(model, ...does.sends)
  return made
}

/**
 * The same rule over what was handled in the order it was, for runs in which that order is not one the model can
 * say: asks under way together, each waiting on something that ends when a schedule gets to it. What the rule says
 * of each thing handled does not depend on what came between.
 */
const follow = (trace: readonly Handled[]): Model => {
  const model: Model = { rows: new Map(), count: 0 }
  /** The rows as an ask that does not wait found them: what its change goes back to if it is not made. */
  let asking: Map<string, number> | undefined
  for (const entry of trace) {
    const { does } = entry
    const before = new Map(model.rows)
    if (entry.what === 'changed') {
      write(model.rows, does.inChange)
      if (does.changeEnds === 'made') model.count += does.adds
      else model.rows = entry.waited ? before : asking!
      continue
    }
    write(model.rows, does.writes)
    if (entry.what === 'began waiting') continue
    if (entry.what === 'told') { if (does.ends === 'made') model.count += does.adds; else model.rows = before; continue }
    // An ask that does not wait: undone now unless it goes on to its change, which is the next thing handled.
    if (does.ends === 'made') asking = before; else model.rows = before
  }
  return model
}

// --- the same, done by states -------------------------------------------------------------------------------------

type Events = { type: 'DO'; does: Does }
type Asks = { RUN: { args: { does: Does }; answer: number; refuses: 'no' }; WAIT: { args: { does: Does }; answer: number; refuses: 'no' } }
const state = reaching()
/** What was handled, as it was: an event, an ask, an ask that waits as it begins, or the change that came with an answer. */
type Handled = { readonly what: 'told' | 'asked' | 'began waiting'; readonly does: Does } | { readonly what: 'changed'; readonly does: Does; readonly waited: boolean }
interface Watched {
  /** Told of each thing as it is handled, in the order it is. */
  handled?(entry: Handled): void
  /** What an ask that waits waits for. A turn of the event loop, unless a schedule is to say when. */
  wait?(does: Does): Promise<unknown>
}
const subject = (store: Rows, { handled, wait = () => new Promise((resolve) => { setImmediate(resolve) }) }: Watched = {}) => {
  const put = (writes: readonly Write[]): void => { for (const [id, value] of writes) { if (value === null) store.remove('thread', id); else store.put('thread', id, { value }) } }
  return state<{ data: { count: number } }, Events, Asks>()({
    data: { count: 0 },
    on: {
      DO: ({ does }, { data, send }) => {
        handled?.({ what: 'told', does })
        put(does.writes)
        for (const sent of does.sends) send({ type: 'DO', does: sent })
        if (does.ends === 'throws' || does.ends === 'refuses') throw new Error('the handler threw')
        if (does.ends === 'stray') return { data: { nothing: 1 } } as never
        return { data: { count: data.count + does.adds } }
      },
    },
    asks: {
      RUN: ({ does }, { send, refuse }) => {
        handled?.({ what: 'asked', does })
        put(does.writes)
        for (const sent of does.sends) send({ type: 'DO', does: sent })
        if (does.ends === 'throws') throw new Error('the handler threw')
        if (does.ends === 'refuses') throw refuse('no', 'the handler refused')
        if (does.ends === 'stray') return answered(does.adds, { data: { nothing: 1 } } as never)
        return answered(does.adds, { data: (draft) => {
          handled?.({ what: 'changed', does, waited: false })
          put(does.inChange)
          if (does.changeEnds === 'throws' || does.changeEnds === 'stray') throw new Error('the change threw')
          if (does.changeEnds === 'refuses') throw refuse('no', 'the change refused')
          draft.count += does.adds
        } })
      },
      WAIT: async ({ does }, { send, refuse }) => {
        handled?.({ what: 'began waiting', does })
        put(does.writes)
        for (const sent of does.sends) send({ type: 'DO', does: sent })
        await wait(does)
        if (does.ends === 'throws' || does.ends === 'stray') throw new Error('the handler threw')
        if (does.ends === 'refuses') throw refuse('no', 'the handler refused')
        return answered(does.adds, { data: (draft) => {
          handled?.({ what: 'changed', does, waited: true })
          put(does.inChange)
          if (does.changeEnds === 'throws' || does.changeEnds === 'stray') throw new Error('the change threw')
          if (does.changeEnds === 'refuses') throw refuse('no', 'the change refused')
          draft.count += does.adds
        } })
      },
    },
  })
}

// --- runs ----------------------------------------------------------------------------------------------------------

/** Numbers from a seed, the same every time: a run can be made again from its seed alone. */
const numbers = (seed: number) => {
  let at = seed >>> 0
  return (): number => {
    at = (at + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(at ^ (at >>> 15), 1 | at)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}
const generate = (seed: number, length: number): Op[] => {
  const next = numbers(seed)
  const below = (count: number): number => Math.floor(next() * count)
  const writes = (most: number): Write[] => Array.from({ length: below(most + 1) }, () => [IDS[below(IDS.length)]!, next() < 0.25 ? null : below(9)] as const)
  const ends = (): Ends => { const roll = next(); return roll < 0.6 ? 'made' : roll < 0.75 ? 'throws' : roll < 0.9 ? 'refuses' : 'stray' }
  const does = (depth: number): Does => ({
    writes: writes(3),
    sends: depth >= 2 ? [] : Array.from({ length: below(3) }, () => does(depth + 1)),
    adds: 1 + below(3),
    ends: ends(),
    inChange: writes(2),
    changeEnds: ends(),
  })
  const hows = ['told', 'asked', 'asked, and it waits'] as const
  return Array.from({ length }, () => ({ how: hows[below(hows.length)]!, does: does(0) }))
}

const holds = async (seed: number, open: () => Rows): Promise<void> => {
  const ops = generate(seed, 10)
  const store = open()
  let failedAt = 0
  try {
    const sys = system({ side: 'backend', transact: store.transact })
    const handle = sys.start('subject', subject(store))
    // Nobody is told of a step while its rows are still being written.
    let toldWhileWriting = 0
    sys.subscribe(() => { if (store.writing) toldWhileWriting++ })
    const model: Model = { rows: new Map(), count: 0 }
    const answers: boolean[] = []
    const expected: boolean[] = []
    for (const [at, { how, does }] of ops.entries()) {
      failedAt = at
      if (how === 'told') { told(model, does); sys.send(handle, { type: 'DO', does }) }
      else {
        const waits = how === 'asked, and it waits'
        expected.push(asked(model, does, waits))
        answers.push((await sys.ask(handle, waits ? 'WAIT' : 'RUN', { does })).ok)
      }
      await rest()
      const rows = Object.fromEntries(IDS.flatMap((id) => { const row = store.get('thread', id); return row ? [[id, row['value']]] : [] }))
      deepStrictEqual({ rows, count: sys.read(handle).data.count, answers, toldWhileWriting }, { rows: Object.fromEntries(model.rows), count: model.count, answers: expected, toldWhileWriting: 0 })
    }
    sys.stop()
  } catch (error) {
    throw new Error(`seed ${seed} differs from the model: ${String(error).split('\n').slice(0, 14).join(' ')}\n        at ${failedAt + 1} of ${ops.length}: ${JSON.stringify(ops[failedAt])}`)
  } finally { store.close() }
}

/**
 * One run with everything under way together: two lanes of things done, and each ask that waits waiting on work the
 * schedule ends when it chooses. Run under orderings picked from the seed.
 */
const together = (seed: number, open: () => Rows) => (schedule: Schedule) => {
  const ops = generate(seed, 6)
  const store = open()
  const trace: Handled[] = []
  const waits = new Map<Does, Promise<unknown>>()
  for (const [at, { how, does }] of ops.entries()) if (how === 'asked, and it waits') waits.set(does, schedule.work(`what ask ${at + 1} waits on`, undefined))
  const sys = system({ side: 'backend', transact: store.transact, later: schedule.later })
  const handle = sys.start('subject', subject(store, { handled: (entry) => { trace.push(entry) }, wait: (does) => waits.get(does) ?? Promise.resolve() }))
  let toldWhileWriting = 0
  sys.subscribe(() => { if (store.writing) toldWhileWriting++ })
  const answers = new Map<number, boolean>()
  const doing = ops.map(({ how, does }, at) => [`${how} ${at + 1}`, (): void => {
    if (how === 'told') sys.send(handle, { type: 'DO', does })
    else void sys.ask(handle, how === 'asked' ? 'RUN' : 'WAIT', { does }).then((outcome) => { answers.set(at, outcome.ok) })
  }] as const)
  schedule.does('one window', ...doing.filter((_, at) => at % 2 === 0))
  schedule.does('another window', ...doing.filter((_, at) => at % 2 === 1))
  return () => {
    try {
      const model = follow(trace)
      const rows = Object.fromEntries(IDS.flatMap((id) => { const row = store.get('thread', id); return row ? [[id, row['value']]] : [] }))
      const expected = new Map(ops.flatMap(({ how, does }, at) => (how === 'told' ? [] : [[at, does.ends === 'made' && does.changeEnds === 'made'] as const])))
      deepStrictEqual({ rows, count: sys.read(handle).data.count, answers: [...answers].sort(), toldWhileWriting }, { rows: Object.fromEntries(model.rows), count: model.count, answers: [...expected].sort(), toldWhileWriting: 0 })
    } finally { store.close() }
  }
}
const interleaved = async (seeds: number, orderings: number, open: () => Rows): Promise<void> => {
  for (const seed of only === undefined ? Array.from({ length: seeds }, (_, at) => at + 1) : [only]) {
    const found = await sample(together(seed, open), { seed, runs: orderings })
    if (found.failure) throw new Error(`seed ${seed} differs from the model: ${String(found.failure.error).split('\n').slice(0, 14).join(' ')}\n        after: ${found.failure.taken.join(' → ')}`)
  }
}

const only = process.env['SEED'] === undefined ? undefined : Number(process.env['SEED'])
const over = async (runs: number, open: () => Rows): Promise<void> => { for (const seed of only === undefined ? Array.from({ length: runs }, (_, at) => at + 1) : [only]) await holds(seed, open) }

await run([
  ['in memory: 1,500 runs of ten handlers each keep the rows, the count and the answers the model says', () => over(1_500, () => memory())],
  ['in elmdb: 150 runs of ten handlers each keep the rows, the count and the answers the model says', () => over(150, elmdb)],
  ['in memory, under way together: 200 runs of six, each under 25 orderings, keep what the model says of what was handled', () => interleaved(200, 25, () => memory())],
  ['in elmdb, under way together: 20 runs of six, each under 10 orderings, keep what the model says of what was handled', () => interleaved(20, 10, elmdb)],
])
