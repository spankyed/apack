// The risk in this design is order: an answer that comes after its state was left, progress that passes a broadcast,
// a click that lands between two things. A check that runs one order proves that order. These run every one.
//
//   npx tsx docs/plans/apack-state/prototype/interleaving-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { run } from './checks.mts'
import { explore, replay, sample, type Schedule } from './schedule.mts'
import { reaching, system } from './state.mts'

type FinderAsks = {
  /** Says a piece, does its work, says another, and answers. */
  FIND: { args: { query: string }; progress: string; answer: string[] }
  /** The same search with its results sent as a broadcast, and nothing in the answer. */
  FIND_AND_BROADCAST: { args: { query: string }; answer: null }
  /** Progress and broadcasts in a fixed order, with work between them. */
  STREAM: { args: {}; progress: string; answer: null }
}
type PanelEvent =
  | { type: 'START'; query: string }
  | { type: 'CANCEL' }
  | { type: 'PIECES'; pieces: string[] }
  | { type: 'RESULTS'; results: string[] }
  | { type: 'NOTE'; note: string }
  | { type: 'CLICK' }
type App = {
  systems: { finder: { events: never; asks: FinderAsks } }
  surfaces: { panel: { events: PanelEvent } }
  views: {}
}
const state = reaching<App>()

const finder = (schedule: Schedule) => state<{}, never, FinderAsks>()({
  asks: {
    FIND: async ({ query }, { progress }) => {
      progress(`${query}:1`)
      await schedule.work(`finding ${query}`, null)
      progress(`${query}:2`)
      return [`${query} result`]
    },
    FIND_AND_BROADCAST: async ({ query }, { broadcast }) => {
      await schedule.work(`finding ${query}`, null)
      broadcast('panel', { type: 'RESULTS', results: [`${query} result`] })
      return null
    },
    STREAM: async (_, { progress, broadcast }) => {
      progress('a')
      broadcast('panel', { type: 'NOTE', note: '1' })
      await schedule.work('the first half', null)
      progress('b')
      progress('c')
      broadcast('panel', { type: 'NOTE', note: '2' })
      await schedule.work('the second half', null)
      progress('d')
      return null
    },
  },
})

type Panel = { data: { query: string; results: string[]; pieces: string[] }; states: { idle: {}; searching: {} } }

/** A search whose results are its answer: only the search that is running can be heard from. */
const panel = (held: { locks: number; unwound: number }) => state<Panel, PanelEvent>()({
  data: { query: '', results: [], pieces: [] },
  start: 'idle',
  on: {
    START: ({ query }) => ({ at: 'searching', data: { query, results: [], pieces: [] } }),
    CANCEL: () => ({ at: 'idle' }),
  },
  states: {
    idle: {},
    searching: {
      async run({ data, ask, send }) {
        held.locks++
        try {
          const found = await ask('finder', 'FIND', { query: data.query }, (pieces) => send({ type: 'PIECES', pieces: [...pieces] }))
          return found.ok ? { at: 'idle' as const, data: { results: found.value } } : { at: 'idle' as const }
        } finally { held.locks--; held.unwound++ }
      },
      failed: () => ({ at: 'idle' }),
      on: { PIECES: ({ pieces }) => ({ data: (d) => { d.pieces.push(...pieces) } }) },
    },
  },
})

/** The same search with its results taken from a broadcast: whichever search finishes last is the one shown. */
const broadcastPanel = state<Panel, PanelEvent>()({
  data: { query: '', results: [], pieces: [] },
  start: 'idle',
  on: {
    START: ({ query }) => ({ at: 'searching', data: { query, results: [], pieces: [] } }),
    RESULTS: ({ results }) => ({ data: { results } }),
  },
  states: {
    idle: {},
    searching: {
      async run({ data, ask }) { await ask('finder', 'FIND_AND_BROADCAST', { query: data.query }); return { at: 'idle' as const } },
      failed: () => ({ at: 'idle' }),
    },
  },
})

/** A search that does its own work, with nobody to ask: what it finds comes back as what `run` returns. */
const ownWork = (schedule: Schedule) => state<Panel, PanelEvent>()({
  data: { query: '', results: [], pieces: [] },
  start: 'idle',
  on: { START: ({ query }) => ({ at: 'searching', data: { query, results: [] } }) },
  states: {
    idle: {},
    searching: {
      async run({ data }) {
        const query = data.query
        await schedule.work(`finding ${query}`, null)
        return { at: 'idle' as const, data: { results: [`${query} result`] } }
      },
      failed: () => ({ at: 'idle' }),
    },
  },
})

/** Writes down everything it hears, in the order it hears it. */
type Listener = { states: { idle: {}; listening: {} } }
const listener = (heard: string[]) => state<Listener, PanelEvent>()({
  start: 'idle',
  on: {
    START: () => ({ at: 'listening' }),
    NOTE: ({ note }) => { heard.push(`note ${note}`) },
    CLICK: () => { heard.push('click') },
    PIECES: ({ pieces }) => { for (const piece of pieces) heard.push(piece) },
  },
  states: {
    idle: {},
    listening: {
      async run({ ask, send }) {
        await ask('finder', 'STREAM', {}, (pieces) => send({ type: 'PIECES', pieces: [...pieces] }))
        heard.push('answer')
        return { at: 'idle' as const }
      },
      failed: () => ({ at: 'idle' }),
    },
  },
})

/** A backend and a window on one schedule. */
const wired = (schedule: Schedule, called = 'the window') => {
  const backend = system({ side: 'backend', later: schedule.later })
  backend.start('finder', finder(schedule))
  const window = system({ side: 'window', name: called, later: schedule.later })
  window.connect(backend)
  return { backend, window }
}

type Scenario = (schedule: Schedule) => () => void
const scenarios: Array<[string, Scenario]> = [
  ['a second search started while the first is running: only the second is ever shown', (schedule) => {
    const held = { locks: 0, unwound: 0 }
    const { window } = wired(schedule)
    const it = window.start('panel', panel(held))
    schedule.does('the user', ['searches for a', () => window.send(it, { type: 'START', query: 'a' })], ['searches for b', () => window.send(it, { type: 'START', query: 'b' })])
    return () => {
      const now = window.read(it)
      strictEqual(now.at, 'idle')
      deepStrictEqual(now.data, { query: 'b', results: ['b result'], pieces: ['b:1', 'b:2'] })
      deepStrictEqual(held, { locks: 0, unwound: 2 })
    }
  }],
  ['work that finishes after its state was left changes nothing: the search that ran last is the one shown', (schedule) => {
    const window = system({ side: 'window', later: schedule.later })
    const it = window.start('panel', ownWork(schedule))
    schedule.does('the user', ['searches for a', () => window.send(it, { type: 'START', query: 'a' })], ['searches for b', () => window.send(it, { type: 'START', query: 'b' })])
    return () => { deepStrictEqual(window.read(it), { at: 'idle', data: { query: 'b', results: ['b result'], pieces: [] } }) }
  }],
  ['a search cancelled at any moment: nothing of it arrives afterwards, and what it held is let go', (schedule) => {
    const held = { locks: 0, unwound: 0 }
    const { window } = wired(schedule)
    const it = window.start('panel', panel(held))
    let atCancel: { results: string[]; pieces: string[] } | undefined
    schedule.does('the user', ['searches for a', () => window.send(it, { type: 'START', query: 'a' })], ['cancels', () => {
      window.send(it, { type: 'CANCEL' })
      atCancel = { results: [...window.read(it).data.results], pieces: [...window.read(it).data.pieces] }
    }])
    return () => {
      const now = window.read(it)
      strictEqual(now.at, 'idle')
      // Whatever had arrived by the cancel is all there ever is.
      deepStrictEqual({ results: now.data.results, pieces: now.data.pieces }, atCancel)
      deepStrictEqual(held, { locks: 0, unwound: 1 })
    }
  }],
  ['progress, broadcasts and the answer are heard in the order they were sent, wherever a click lands', (schedule) => {
    const heard: string[] = []
    const { window } = wired(schedule)
    const it = window.start('panel', listener(heard))
    window.send(it, { type: 'START', query: '' })
    schedule.does('the user', ['clicks', () => window.send(it, { type: 'CLICK' })])
    return () => {
      deepStrictEqual(heard.filter((each) => each !== 'click'), ['a', 'note 1', 'b', 'c', 'note 2', 'd', 'answer'])
      strictEqual(heard.filter((each) => each === 'click').length, 1)
    }
  }],
]

/** Two windows on one backend have more orderings than can all be run, so this one is run under a seed's worth. */
const twoWindows: Scenario = (schedule) => {
    const first = { locks: 0, unwound: 0 }
    const second = { locks: 0, unwound: 0 }
    const backend = system({ side: 'backend', later: schedule.later })
    backend.start('finder', finder(schedule))
    const one = system({ side: 'window', name: 'window one', later: schedule.later })
    const link = one.connect(backend)
    const two = system({ side: 'window', name: 'window two', later: schedule.later })
    two.connect(backend)
    const inOne = one.start('panel', panel(first))
    const inTwo = two.start('panel', panel(second))
    one.send(inOne, { type: 'START', query: 'a' })
    two.send(inTwo, { type: 'START', query: 'b' })
    schedule.does('window one', ['closes', () => { link.close(); one.stop() }])
    return () => {
      deepStrictEqual(first, { locks: 0, unwound: 1 })
      deepStrictEqual(two.read(inTwo), { at: 'idle', data: { query: 'b', results: ['b result'], pieces: ['b:1', 'b:2'] } })
    }
  }

/** Results taken from a broadcast. The check is that exploring finds the order that breaks it. */
const broken = (schedule: Schedule): (() => void) => {
  const { window } = wired(schedule)
  const it = window.start('panel', broadcastPanel)
  schedule.does('the user', ['searches for a', () => window.send(it, { type: 'START', query: 'a' })], ['searches for b', () => window.send(it, { type: 'START', query: 'b' })])
  return () => { deepStrictEqual(window.read(it).data.results, ['b result']) }
}

await run([], async (tally) => {
  for (const [name, scenario] of scenarios) await tally.every(name, () => explore(scenario))
  await tally.every('a window closed at any moment: its search unwinds, and the backend goes on answering the other window', () => sample(twoWindows, { seed: 1, runs: 5_000 }), 'sampled')

  await tally.check('exploring finds the order that breaks results taken from a broadcast, and replaying it breaks the same way', async () => {
    const found = await explore(broken)
    ok(found.failure, `no ordering failed in ${found.orderings}`)
    const again = await replay(broken, found.failure.choices)
    const first = await replay(broken, [])
    ok(again.error !== undefined, 'the replay did not fail')
    deepStrictEqual(again.taken, found.failure.taken)
    strictEqual(first.error, undefined, 'the first ordering fails too, so nothing had to be found')
    // The order it found: the second search's work done before the first's.
    deepStrictEqual(found.failure.taken.filter((each) => each.startsWith('finding')), ['finding b', 'finding a'])
  })

  await tally.check('a seed chooses the same orderings every time', async () => {
    const orders = async (seed: number): Promise<string[]> => {
      const seen: string[] = []
      await sample((schedule) => {
        const order: string[] = []
        const watched: Schedule = { ...schedule, work: (label, value) => schedule.work(label, value).then((done) => { order.push(label); return done }) }
        const check = scenarios[0]![1](watched)
        return () => { check(); seen.push(order.join(',')) }
      }, { seed, runs: 25 })
      return seen
    }
    const [once, again, other] = [await orders(7), await orders(7), await orders(8)]
    strictEqual(once.length, 25)
    deepStrictEqual(once, again)
    ok(new Set(once).size > 1, 'every run took the same order')
    ok(once.join() !== other.join(), 'another seed chose the same orderings')
  })
})
