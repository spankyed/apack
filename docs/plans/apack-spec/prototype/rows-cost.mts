// What it costs to make a step a unit of the database, on elmdb: a measurement. It prints, and refuses nothing.
//
// Each line is the median of seven runs, as time per step. A step through the kernel is set beside the same writes
// made straight to the engine, so that what the kernel adds is the difference: one more unit around each thing a step
// handles, which is a savepoint once the step has written.
//
//   npx tsx docs/plans/apack-spec/prototype/rows-cost.mts
import { cpus } from 'node:os'
import { reaching, system } from './state.mts'
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
