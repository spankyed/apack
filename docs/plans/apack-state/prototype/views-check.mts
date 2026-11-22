// What a window is told of a step, it is told after its views show the step. A backend that runs views for its windows
// holds what a step sends them until the views have been sent the step's rows, and sends both down the same link, so
// the order they arrive in is the order they were sent in. Checked against rows in memory under every ordering, and
// against elmdb, whose views run on its own clock.
//
//   npx tsx docs/plans/apack-state/prototype/views-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { rest, run, system } from './checks.mts'
import { explore, type Schedule } from './schedule.mts'
import { answered, reaching, type ViewHost } from './state.mts'
import { memory, type Rows } from './store.mts'
import { elmdb } from './store-elmdb.mts'

type ThreadAsks = { CREATE: { args: { id: string }; answer: { id: string } } }
type PanelEvents = { type: 'CREATED'; id: string }
type PanelAsks = { ADD: { args: { id: string }; answer: boolean } }
type App = {
  systems: { threads: { events: never; asks: ThreadAsks } }
  surfaces: { panel: { events: PanelEvents } }
  views: { threads: { count: { args: {}; result: number } } }
}
const state = reaching<App>()

/** The backend: a thread is a row, and making one is told to every window as well as answered. */
const threads = (store: Rows) => state<{}, never, ThreadAsks>()({
  asks: {
    CREATE: ({ id }, { broadcast }) => {
      store.put('thread', id, { topic: 'made' })
      broadcast('panel', { type: 'CREATED', id })
      return { id }
    },
  },
})

type Panel = { data: { count: number; atAnswer: number[]; atEvent: number[] } }
/**
 * A window's surface: it follows how many threads there are, and notes that number as each thread it asked for is
 * answered and as it is told of each one. Told of a thread its view does not show yet, the number would be behind.
 */
const panel = state<Panel, PanelEvents, PanelAsks>()({
  data: { count: 0, atAnswer: [], atEvent: [] },
  follows: (follow) => ({
    count: follow('threads', 'count', { args: () => ({}), heard: (update) => (update.ok ? { data: { count: update.value } } : undefined) }),
  }),
  on: {
    CREATED: (_, { data }) => ({ data: { atEvent: [...data.atEvent, data.count] } }),
  },
  asks: {
    ADD: async ({ id }, { ask }) => {
      const outcome = await ask('threads', 'CREATE', { id })
      return answered(outcome.ok, { data: (draft) => { draft.atAnswer.push(draft.count) } })
    },
  },
})

/** A backend state that follows a view of its own rows, and writes what it hears: once, it throws after writing. */
const watcher = (store: Rows) => state<{ data: { heard: number[] } }, never>()({
  data: { heard: [] },
  follows: (follow) => ({
    count: follow('threads', 'count', {
      args: () => ({}),
      heard: (update, { data }) => {
        if (!update.ok) return undefined
        store.put('import', `saw-${update.value}`, { state: 'seen' })
        if (update.value === 1) throw new Error('hearing broke')
        return { data: { heard: [...data.heard, update.value] } }
      },
    }),
  }),
})

/** The views a backend runs over its rows. */
const viewsOf = (store: Rows): ViewHost => (_feature, _view, _args, heard) => store.watch(() => store.count('thread'), (value) => heard({ ok: true, value }))

const made = (store: Rows, held: boolean, later?: Schedule['later']) => {
  const traced: string[] = []
  const trace = (line: string): void => { traced.push(line) }
  const backend = system({ side: 'backend', transact: store.transact, views: viewsOf(store), ...(held ? { viewsSent: store.settled } : {}), trace, ...(later ? { later } : {}) })
  backend.start('threads', threads(store))
  const window = system({ side: 'window', trace, ...(later ? { later } : {}) })
  const link = window.connect(backend)
  const handle = window.start('panel', panel)
  return { backend, window, handle, link, defects: () => traced.filter((line) => line.startsWith('DEFECT')) }
}

/** Waits until the views have been told of what was kept, and what that led to has come to rest. */
const settledAndRest = async (store: Rows): Promise<void> => {
  await new Promise<void>((resolve) => { store.settled(resolve) })
  await rest()
}

/**
 * Two threads asked for, the second once the first is answered or both at once: what the window noted at each answer
 * and each telling. With both under way, what the first step sent is waiting on the views when the second step's is
 * sent, and each has to wait for its own.
 */
const scenario = (held: boolean, how: 'one after the other' | 'both at once') => (schedule: Schedule) => {
  // The views are told in a lane of their own: when, against everything else, is the schedule's to choose.
  const views = { label: 'the views are told' }
  const store = memory((run) => schedule.later(views, run))
  const { window, handle, defects } = made(store, held, schedule.later)
  const answers: boolean[] = []
  const add = (id: string, then?: () => void) => (): void => { void window.ask(handle, 'ADD', { id }).then((outcome) => { answers.push(outcome.ok && outcome.value); then?.() }) }
  if (how === 'both at once') schedule.does('the user', ['asks for a', add('a')], ['asks for b', add('b')])
  else schedule.does('the user', ['asks for a, and then for b', add('a', add('b'))])
  return () => {
    deepStrictEqual(answers, [true, true])
    const { count, atAnswer, atEvent } = window.read(handle).data
    strictEqual(count, 2)
    // The first is in the view by the time the window hears of it, and so is the second. With both under way the
    // view may show the second by the time the window hears of the first, which is ahead and never behind.
    for (const noted of [atAnswer, atEvent]) ok(noted.length === 2 && noted[0]! >= 1 && noted[1] === 2, `noted ${JSON.stringify({ atAnswer, atEvent })}`)
    deepStrictEqual(defects(), [])
  }
}

await run([
  ['in elmdb: a thread made is in the window\'s view by the time the window is answered and by the time it is told', async () => {
    const store = elmdb()
    try {
      const { window, handle, defects } = made(store, true)
      await rest()
      for (const id of ['a', 'b', 'c']) ok((await window.ask(handle, 'ADD', { id })).ok)
      await rest()
      const { count, atAnswer, atEvent } = window.read(handle).data
      strictEqual(count, 3)
      deepStrictEqual({ atAnswer, atEvent }, { atAnswer: [1, 2, 3], atEvent: [1, 2, 3] })
      deepStrictEqual(defects(), [])
    } finally { store.close() }
  }],
  ...([['in memory', () => memory()], ['in elmdb', elmdb]] as const).map(([kept, open]) => [`${kept}: what a state hears from a view is a handler too: one that writes and then throws has written nothing`, async () => {
    const store = open()
    try {
      const traced: string[] = []
      const backend = system({ side: 'backend', transact: store.transact, views: viewsOf(store), trace: (line) => { traced.push(line) } })
      backend.start('threads', threads(store))
      const handle = backend.start('watcher', watcher(store))
      const created = backend.start('creator', state<{}, { type: 'MAKE'; id: string }>()({ on: { MAKE: ({ id }) => { store.put('thread', id, { topic: 'made' }) } } }))
      await settledAndRest(store)
      for (const id of ['a', 'b']) { backend.send(created, { type: 'MAKE', id }); await settledAndRest(store) }
      deepStrictEqual(backend.read(handle).data.heard, [0, 2])
      deepStrictEqual([store.get('import', 'saw-0'), store.get('import', 'saw-1'), store.get('import', 'saw-2')], [{ state: 'seen' }, undefined, { state: 'seen' }])
      ok(traced.some((line) => line.startsWith('DEFECT') && line.includes('hearing broke')))
    } finally { store.close() }
  }] as const),
  ['a window that closes while its answer is held is told it was disconnected, is sent nothing after, and the backend goes on', async () => {
    const store = memory()
    // The views are sent what was kept when this check says so, and not before.
    const waiting: Array<() => void> = []
    const traced: string[] = []
    const trace = (line: string): void => { traced.push(line) }
    const backend = system({ side: 'backend', transact: store.transact, views: viewsOf(store), viewsSent: (then) => { waiting.push(then) }, trace })
    backend.start('threads', threads(store))
    const closing = system({ side: 'window', name: 'the window that closes', trace })
    const link = closing.connect(backend)
    const closed = closing.start('panel', panel)
    const staying = system({ side: 'window', name: 'the window that stays', trace })
    staying.connect(backend)
    const stayed = staying.start('panel', panel)
    const turn = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })
    for (let turns = 0; turns < 6; turns++) await turn()
    const asked = closing.ask(closed, 'ADD', { id: 'a' })
    // Until the thread is kept: its answer and the broadcast are held, with the views not yet said to be sent.
    for (let turns = 0; turns < 20 && store.count('thread') === 0; turns++) await turn()
    strictEqual(store.count('thread'), 1)
    ok(waiting.length > 0, 'nothing was held')
    deepStrictEqual([closing.read(closed).data.atAnswer, staying.read(stayed).data.atEvent], [[], []])
    link.close()
    const outcome = await asked
    ok(outcome.ok && outcome.value === false)
    // Now the views are sent it: what was held goes, to the window that is there and not to the one that is not.
    for (const then of waiting.splice(0)) then()
    for (let turns = 0; turns < 6; turns++) await turn()
    for (const then of waiting.splice(0)) then()
    await rest()
    deepStrictEqual(staying.read(stayed).data.atEvent.length, 1)
    deepStrictEqual(closing.read(closed).data.atEvent, [])
    deepStrictEqual(traced.filter((line) => line.startsWith('DEFECT')), [])
    // And the backend still answers: the window that stayed asks, and is answered.
    const again = staying.ask(stayed, 'ADD', { id: 'b' })
    for (let turns = 0; turns < 20 && waiting.length === 0; turns++) await turn()
    for (const then of waiting.splice(0)) then()
    ok((await again).ok)
    strictEqual(store.count('thread'), 2)
  }],
  ['a window that closes before its ask crosses is told so, and neither side is left waiting', async () => {
    const store = memory()
    const { backend, window, handle, link } = made(store, true)
    await rest()
    const asked = window.ask(handle, 'ADD', { id: 'a' })
    link.close()
    // Its ask of the backend ended as disconnected, which is what it answered with.
    const outcome = await asked
    ok(outcome.ok && outcome.value === false)
    await rest()
    strictEqual(store.count('thread'), 0)
    ok(backend.idle() && window.idle())
  }],
], async (tally) => {
  for (const how of ['one after the other', 'both at once'] as const) {
    await tally.every(`${how}: under every ordering, a window is answered and told after its view shows the thread`, () => explore(scenario(true, how)))
    await tally.check(`${how}: without the hold there is an ordering in which it is told first, so the hold is what the rule rests on`, async () => {
      const found = await explore(scenario(false, how))
      ok(found.failure, 'every ordering passed without the hold, so the scenario proves nothing')
    })
  }
})
