// What a growing collection costs, and why progress arrives in batches.
//
//   npx tsx docs/plans/apack-spec/prototype/append-cost.mts
//
// A value is replaced, never mutated, so appending copies the array it appends to. One change per item is then
// quadratic. The first half measures that on the draft alone. The second streams results through a real ask, from a
// backend to a window, the way the search does.
import { produce } from './draft.mts'
import { reaching, system } from './state.mts'

const time = async (label: string, run: () => void | Promise<void>): Promise<void> => {
  const started = process.hrtime.bigint()
  await run()
  console.log(`  ${label.padEnd(54)} ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(0).padStart(7)} ms`)
}
const row = (i: number) => ({ path: `/repo/file-${i}.ts`, matches: [{ line: i }] })
type Row = ReturnType<typeof row>

console.log('the draft alone')
for (const count of [10_000, 100_000]) {
  for (const each of [1, 100, 1000]) {
    await time(`${count} results, ${each} per change`, () => {
      let data = { results: [] as Row[] }
      for (let i = 0; i < count; i += each) {
        const batch = Array.from({ length: each }, (_, k) => row(i + k))
        data = produce(data, (d) => { d.results.push(...batch) }).value
      }
    })
  }
}
await time('100000 pieces of text, 1 per change', () => {
  let data = { streamed: '' }
  for (let i = 0; i < 100_000; i++) data = produce(data, (d) => { d.streamed += 'token ' }).value
})

// ── through an ask ──────────────────────────────────────────────────────────────────────────────────────────────────

type FinderAsks = { FIND: { args: { count: number }; progress: Row; answer: { found: number } } }
type App = { systems: { finder: { events: never; asks: FinderAsks } }; surfaces: {}; views: {} }
const state = reaching<App>()

const finder = state<{}, never, FinderAsks>()({
  asks: {
    // Results come off a process in bursts: many at once, then a turn of the event loop.
    async FIND({ count }, { progress }) {
      for (let i = 0; i < count; i++) {
        progress(row(i))
        if (i % 500 === 499) await new Promise((resolve) => setImmediate(resolve))
      }
      return { found: count }
    },
  },
})

type Panel = { data: { results: Row[]; changes: number }; states: { idle: {}; finding: { data: { count: number } } } }
type PanelEvent = { type: 'FIND'; count: number } | { type: 'FOUND'; results: Row[] }

const panel = state<Panel, PanelEvent>()({
  data: { results: [], changes: 0 },
  start: 'idle',
  on: { FIND: ({ count }) => ({ at: 'finding', data: { count, results: [], changes: 0 } }) },
  states: {
    idle: {},
    finding: {
      data: { count: 0 },
      async run({ data, ask, send }) {
        await ask('finder', 'FIND', { count: data.count }, (results) => send({ type: 'FOUND', results: [...results] }))
        return { at: 'idle' }
      },
      on: { FOUND: ({ results }) => ({ data: (d) => { d.results.push(...results); d.changes++ } }) },
    },
  },
})

console.log('\nthrough an ask, backend to window')
for (const count of [10_000, 100_000]) {
  const notes: string[] = []
  const backend = system({ side: 'backend' })
  backend.start('finder', finder)
  const window = system({ side: 'window', trace: (line) => { if (line.startsWith('LARGE')) notes.push(line) } })
  window.connect(backend)
  const surface = window.start('panel', panel)
  await time(`${count} results streamed`, () => new Promise<void>((resolve) => {
    window.subscribe(() => { const now = window.read(surface); if (now?.at === 'idle' && now.data.results.length === count) resolve() })
    window.send(surface, { type: 'FIND', count })
  }))
  console.log(`    arrived as ${window.read(surface).data.changes} changes`)
  for (const note of notes) console.log(`    ${note}`)
  window.stop(); backend.stop()
}
