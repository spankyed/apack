// The rule about rows as a property, and not as the cases somebody thought of: for any run of handlers that write,
// tell themselves more, throw, refuse, return a change that cannot be made, and wait, the rows kept are those written
// by what was made, the data counts what was made, an ask is answered as made exactly when it was, and nobody is told
// of a step while it is still writing.
//
// A run is generated from a seed and held against a model that knows nothing of the kernel: a few lines that say what
// the rule says. A run that differs is reported with its seed, and `SEED=<n>` runs that one alone.
//
//   npx tsx docs/plans/apack-spec/prototype/rows-property.mts
import { deepStrictEqual } from 'node:assert'
import { rest, run, system } from './checks.mts'
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

// --- the same, done by states -------------------------------------------------------------------------------------

type Events = { type: 'DO'; does: Does }
type Asks = { RUN: { args: { does: Does }; answer: number; refuses: 'no' }; WAIT: { args: { does: Does }; answer: number; refuses: 'no' } }
const state = reaching()
const subject = (store: Rows) => {
  const put = (writes: readonly Write[]): void => { for (const [id, value] of writes) { if (value === null) store.remove('thread', id); else store.put('thread', id, { value }) } }
  return state<{ data: { count: number } }, Events, Asks>()({
    data: { count: 0 },
    on: {
      DO: ({ does }, { data, send }) => {
        put(does.writes)
        for (const sent of does.sends) send({ type: 'DO', does: sent })
        if (does.ends === 'throws' || does.ends === 'refuses') throw new Error('the handler threw')
        if (does.ends === 'stray') return { data: { nothing: 1 } } as never
        return { data: { count: data.count + does.adds } }
      },
    },
    asks: {
      RUN: ({ does }, { send, refuse }) => {
        put(does.writes)
        for (const sent of does.sends) send({ type: 'DO', does: sent })
        if (does.ends === 'throws') throw new Error('the handler threw')
        if (does.ends === 'refuses') throw refuse('no', 'the handler refused')
        if (does.ends === 'stray') return answered(does.adds, { data: { nothing: 1 } } as never)
        return answered(does.adds, { data: (draft) => {
          put(does.inChange)
          if (does.changeEnds === 'throws' || does.changeEnds === 'stray') throw new Error('the change threw')
          if (does.changeEnds === 'refuses') throw refuse('no', 'the change refused')
          draft.count += does.adds
        } })
      },
      WAIT: async ({ does }, { send, refuse }) => {
        put(does.writes)
        for (const sent of does.sends) send({ type: 'DO', does: sent })
        await new Promise((resolve) => { setImmediate(resolve) })
        if (does.ends === 'throws' || does.ends === 'stray') throw new Error('the handler threw')
        if (does.ends === 'refuses') throw refuse('no', 'the handler refused')
        return answered(does.adds, { data: (draft) => {
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

const only = process.env['SEED'] === undefined ? undefined : Number(process.env['SEED'])
const over = async (runs: number, open: () => Rows): Promise<void> => { for (const seed of only === undefined ? Array.from({ length: runs }, (_, at) => at + 1) : [only]) await holds(seed, open) }

await run([
  ['in memory: 1,500 runs of ten handlers each keep the rows, the count and the answers the model says', () => over(1_500, () => memory())],
  ['in elmdb: 150 runs of ten handlers each keep the rows, the count and the answers the model says', () => over(150, elmdb)],
])
