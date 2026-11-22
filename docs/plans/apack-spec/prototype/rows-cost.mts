// What it costs to make a step a unit of the database, on elmdb: a measurement. It prints, and refuses nothing.
//
// Each line is the median of seven runs, as time per step. A step through the kernel is set beside the same writes
// made straight to the engine, so that what the kernel adds is the difference: one more unit around each thing a step
// handles, which is a savepoint once the step has written.
//
//   npx tsx docs/plans/apack-spec/prototype/rows-cost.mts
import { cpus } from 'node:os'
import { reaching, system, type ViewHost } from './state.mts'
import { elmdb } from './store-elmdb.mts'
import type { Rows } from './store.mts'

const state = reaching()
type Events = { type: 'TOUCH' } | { type: 'NOTE'; id: string } | { type: 'MANY'; from: number; count: number }
const counter = (store: Rows) => state<{ data: { count: number } }, Events>()({
  data: { count: 0 },
  on: {
    TOUCH: (_, { data }) => ({ data: { count: data.count + 1 } }),
    NOTE: ({ id }, { data }) => { store.put('thread', id, { topic: 'noted' }); return { data: { count: data.count + 1 } } },
    // One step in which `count` handlers each write a row.
    MANY: ({ from, count }, { send }) => { for (let at = 0; at < count; at++) send({ type: 'NOTE', id: String(from + at) }) },
  },
})

const RUNS = 7
const median = (values: number[]): number => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
/** Microseconds per step, the median of several runs, each on a database of its own. */
const timed = (steps: number, body: (store: Rows, step: (at: number) => void) => (at: number) => void): number => median(Array.from({ length: RUNS }, () => {
  const store = elmdb()
  const step = body(store, () => {})
  for (let at = 0; at < 200; at++) step(at)
  const began = process.hrtime.bigint()
  for (let at = 200; at < 200 + steps; at++) step(at)
  const took = Number(process.hrtime.bigint() - began) / 1_000
  store.close()
  return took / steps
}))
const kernel = (unit: boolean, event: (at: number) => Events) => (store: Rows): ((at: number) => void) => {
  const sys = system({ side: 'backend', ...(unit ? { transact: store.transact } : {}) })
  const handle = sys.start('counter', counter(store))
  return (at) => sys.send(handle, event(at))
}
const line = (what: string, micros: number, beside?: number): void => {
  console.log(`  ${what.padEnd(64)} ${micros.toFixed(1).padStart(8)} µs${beside === undefined ? '' : `   (${(micros - beside >= 0 ? '+' : '')}${(micros - beside).toFixed(1)} µs beside the line above)`}`)
}

console.log(`${new Date().toISOString().slice(0, 10)}, ${cpus()[0]?.model}, node ${process.version}, load ${process.platform === 'win32' ? 'unread' : (await import('node:os')).loadavg()[0]!.toFixed(1)}, temporary databases with syncing off\n`)

console.log('A step that writes nothing')
const quiet = timed(20_000, kernel(false, () => ({ type: 'TOUCH' })))
line('the kernel alone, given no database', quiet)
line('the kernel, with each step a unit', timed(20_000, kernel(true, () => ({ type: 'TOUCH' }))), quiet)

console.log('\nA step that writes one row')
const bareOne = timed(5_000, (store) => (at) => store.transact(() => { store.put('thread', String(at), { topic: 'noted' }) }))
line('the engine alone: one unit, one write', bareOne)
line('the kernel, with the step a unit', timed(5_000, kernel(true, (at) => ({ type: 'NOTE', id: String(at) }))), bareOne)

console.log('\nA step in which ten handlers each write one row')
const bareTen = timed(2_000, (store) => (at) => store.transact(() => { for (let row = 0; row < 10; row++) store.put('thread', `${at}-${row}`, { topic: 'noted' }) }))
line('the engine alone: one unit, ten writes', bareTen)
const marked = timed(2_000, (store) => (at) => store.transact(() => { for (let row = 0; row < 10; row++) store.transact(() => { store.put('thread', `${at}-${row}`, { topic: 'noted' }) }) }))
line('the engine alone: one unit, each write in a unit inside it', marked, bareTen)
line('the kernel, with the step a unit', timed(2_000, kernel(true, (at) => ({ type: 'MANY', from: at * 10, count: 10 }))), marked)

console.log('\nTen rows, a step each: what a stream written a piece at a time is')
line('the kernel, ten steps of one write', timed(500, (store) => { const step = kernel(true, (at) => ({ type: 'NOTE', id: String(at) }))(store); return (at) => { for (let row = 0; row < 10; row++) step(at * 10 + row) } }), bareTen)

// What it costs a window to be answered after its views show the row: the backend holds the answer until the engine
// has told its watches. The engine runs a watch again no sooner than a frame after it last ran, so what the hold costs
// depends on how long ago the view was last told: asks are made straight after one another, and a frame or more apart.
type WindowAsks = { ADD: { args: { id: string }; answer: boolean } }
type Net = { systems: { rows: { events: never; asks: { CREATE: { args: { id: string }; answer: string } } } }; surfaces: {}; views: { rows: { count: { args: {}; result: number } } } }
const linked = reaching<Net>()
const asking = async (held: boolean, asks: number, writes: boolean, apartMs: number): Promise<number> => {
  const store = elmdb()
  const views: ViewHost = (_feature, _view, _args, heard) => store.watch(() => store.count('thread'), (value) => heard({ ok: true, value }))
  const backend = system({ side: 'backend', transact: store.transact, views, ...(held ? { viewsSent: store.settled } : {}) })
  backend.start('rows', linked<{}, never, Net['systems']['rows']['asks']>()({ asks: { CREATE: ({ id }) => { if (writes) store.put('thread', id, { topic: 'made' }); return id } } }))
  const window = system({ side: 'window' })
  window.connect(backend)
  const handle = window.start('panel', linked<{ data: { count: number } }, never, WindowAsks>()({
    data: { count: 0 },
    follows: (follow) => ({ count: follow('rows', 'count', { args: () => ({}), heard: (update) => (update.ok ? { data: { count: update.value } } : undefined) }) }),
    asks: { ADD: async ({ id }, { ask }) => (await ask('rows', 'CREATE', { id })).ok },
  }))
  for (let at = 0; at < 20; at++) await window.ask(handle, 'ADD', { id: `warm-${at}` })
  let took = 0
  for (let at = 0; at < asks; at++) {
    if (apartMs) await new Promise((resolve) => { setTimeout(resolve, apartMs) })
    const began = process.hrtime.bigint()
    await window.ask(handle, 'ADD', { id: String(at) })
    took += Number(process.hrtime.bigint() - began) / 1_000
  }
  window.stop(); backend.stop(); store.close()
  return took / asks
}
const cases = [
  ['to write a row, straight after the last', true, 0, 200],
  ['to write a row, 20 ms after the last was answered', true, 20, 40],
  ['something that writes nothing, straight after the last', false, 0, 200],
] as const
for (const [what, writes, apartMs, asks] of cases) {
  console.log(`\nA window asks its backend ${what}, with a view of the rows open`)
  const unheld: number[] = []
  const held: number[] = []
  for (let at = 0; at < RUNS; at++) { unheld.push(await asking(false, asks, writes, apartMs)); held.push(await asking(true, asks, writes, apartMs)) }
  const plain = median(unheld)
  line('answered when the rows are kept', plain)
  line('answered when its views have been sent them', median(held), plain)
}
