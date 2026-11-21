// Who may send a state what. A state is declared with the events others may send it. The ones it sends itself are
// declared apart, as `internal`, and nothing outside it reaches them. And one surface tells another in its own
// window what that surface says it takes.
//
//   npx tsx docs/plans/apack-spec/prototype/internal-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { rest, run, system } from './checks.mts'
import { reaching } from './state.mts'

type ListEvent =
  | { type: 'PICK'; id: string }
  | { type: 'REFRESH' }
  | { type: 'PICK_AGAIN' }
  | { type: 'TELL_THE_STORE'; id: string }
type DetailEvent = { type: 'SHOW'; id: string }
/** The backend has a system called `detail` too, as a feature's system and its surface are called the same. */
type DetailSystemEvent = { type: 'SAVE'; id: string } | { type: 'SHOW_FROM_HERE' }

type App = {
  systems: { detail: { events: DetailSystemEvent; asks: {} } }
  surfaces: { list: { events: ListEvent }; detail: { events: DetailEvent } }
  views: {}
}
const state = reaching<App>()

type List = {
  data: { picked: string | null; ticks: number }
  /** What it sends itself as its own work goes on. Nothing else may send it this. */
  internal: { type: 'TICK' }
}
const list = state<List, ListEvent>()({
  data: { picked: null, ticks: 0 },
  on: {
    // Tells the surface beside it, in this window.
    PICK: ({ id }, { tell }) => { tell({ surface: 'detail' }, { type: 'SHOW', id }); return { data: { picked: id } } },
    REFRESH: (_, { send }) => { send({ type: 'TICK' }) },
    // What others may send it, it may send itself too.
    PICK_AGAIN: (_, { data, send }) => { send({ type: 'PICK', id: `${data.picked} again` }) },
    // A name alone is a backend system, though a surface here is called the same.
    TELL_THE_STORE: ({ id }, { tell }) => { tell('detail', { type: 'SAVE', id }) },
  },
  internal: {
    TICK: (_, { data }) => ({ data: { ticks: data.ticks + 1 } }),
  },
})

const detail = state<{ data: { shown: string | null } }, DetailEvent>()({
  data: { shown: null },
  on: { SHOW: ({ id }) => ({ data: { shown: id } }) },
})

const detailSystem = state<{ data: { saved: string[] } }, DetailSystemEvent>()({
  data: { saved: [] },
  on: {
    SAVE: ({ id }, { data }) => ({ data: { saved: [...data.saved, id] } }),
    // A surface is in a window: the backend cannot tell one, only broadcast to it.
    SHOW_FROM_HERE: (_, { tell }) => { tell({ surface: 'detail' }, { type: 'SHOW', id: 'from the backend' }) },
  },
})

const wired = (connected = false) => {
  const traced: string[] = []
  const window = system({ side: 'window', trace: (line) => { traced.push(line) } })
  const theList = window.start('list', list)
  const theDetail = window.start('detail', detail)
  const backendTraced: string[] = []
  const backend = system({ side: 'backend', trace: (line) => { backendTraced.push(line) } })
  const theSystem = backend.start('detail', detailSystem)
  if (connected) window.connect(backend)
  return {
    window, theList, traced, backendTraced,
    send: (event: ListEvent): void => window.send(theList, event),
    list: () => window.read(theList).data,
    shown: () => window.read(theDetail).data.shown,
    saved: () => backend.read(theSystem).data.saved,
    tellSystem: (event: DetailSystemEvent): void => backend.send(theSystem, event),
  }
}

const checks: Array<[string, () => Promise<void> | void]> = [
  ['what a state sends itself is taken by its internal handler', () => {
    const it = wired()
    it.send({ type: 'REFRESH' })
    strictEqual(it.list().ticks, 1)
  }],
  ['the same event from outside is not taken, and that is said', () => {
    const it = wired()
    // The types refuse this, which is why it is cast: the check is what the kernel does with one that gets through.
    it.window.send(it.theList, { type: 'TICK' } as never)
    strictEqual(it.list().ticks, 0)
    ok(it.traced.some((line) => line.includes('list was sent TICK from outside, which only it sends itself')), it.traced.join(' / '))
  }],
  ['what others may send a state, it may send itself too', () => {
    const it = wired()
    it.send({ type: 'PICK', id: 'a' })
    it.send({ type: 'PICK_AGAIN' })
    strictEqual(it.list().picked, 'a again')
  }],
  ['one surface tells another in its own window, with no backend there to go through', () => {
    const it = wired()
    it.send({ type: 'PICK', id: 'a' })
    strictEqual(it.shown(), 'a')
    deepStrictEqual(it.saved(), [])
  }],
  ['a surface and a backend system called the same are told apart by how each is named', async () => {
    const it = wired(true)
    it.send({ type: 'PICK', id: 'a' })
    it.send({ type: 'TELL_THE_STORE', id: 'b' })
    await rest()
    strictEqual(it.shown(), 'a')
    deepStrictEqual(it.saved(), ['b'])
  }],
  ['from the backend a surface is not told: it is reported, and nothing is sent', async () => {
    const it = wired(true)
    it.tellSystem({ type: 'SHOW_FROM_HERE' })
    await rest()
    strictEqual(it.shown(), null)
    ok(it.backendTraced.some((line) => line.startsWith('DEFECT') && line.includes('told the surface detail SHOW')), it.backendTraced.join(' / '))
  }],
]

// What must not compile.
{
  const window = system({ side: 'window' })
  const theList = window.start('typed', list)
  // @ts-expect-error only the list sends itself a tick
  window.send(theList, { type: 'TICK' })
  window.stop()
}
state<List, ListEvent>()({
  data: { picked: null, ticks: 0 },
  on: {
    // @ts-expect-error a tick is what it sends itself, and is taken under `internal`
    TICK: () => ({ data: { ticks: 1 } }),
    // @ts-expect-error the detail surface takes no such event
    PICK: (_, { tell }) => { tell({ surface: 'detail' }, { type: 'HIDE' }) },
    // @ts-expect-error there is no such surface
    REFRESH: (_, { tell }) => { tell({ surface: 'sidebar' }, { type: 'SHOW', id: 'a' }) },
    // @ts-expect-error it sends itself a tick, or what others may send it, and nothing else
    PICK_AGAIN: (_, { send }) => { send({ type: 'TOCK' }) },
  },
  internal: {
    // @ts-expect-error what others may send it is taken under `on`
    PICK: () => ({ data: { picked: null } }),
  },
})

await run(checks)
