// The asks a state awaits. These are reads: one is there because the data says so, for as long as it does. It names
// the fields it reads, or the field with one for each of its keys, and which are asked follows from the data.
//
//   npx tsx docs/plans/apack-spec/prototype/awaits-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { run, system } from './checks.mts'
import { commit, git, type CommitEvent } from './commit.mts'
import { explore, type Schedule } from './schedule.mts'
import { reaching } from './state.mts'

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

type LibraryAsks = { LOOKUP: { args: { query: string }; progress: string; answer: string } }
type App = { systems: { library: { events: never; asks: LibraryAsks } }; surfaces: {}; views: {} }
const state = reaching<App>()

/** What the library was asked and what it was told to give up, in order. */
const library = (did: string[]) => state<{}, never, LibraryAsks>()({
  asks: {
    LOOKUP: async ({ query }, { progress, signal }) => {
      did.push(`lookup ${query}`)
      signal.addEventListener('abort', () => { did.push(`gave up ${query}`) })
      progress(`${query} began`)
      await turns(3)
      progress(`${query} ended`)
      return query.toUpperCase()
    },
  },
})

type ReaderEvent =
  | { type: 'SET_QUERY'; query: string }
  | { type: 'RENAME'; title: string }
  | { type: 'AGAIN' }
  | { type: 'WATCH'; ids: string[] }
  | { type: 'TURN'; on: boolean }
  | { type: 'CIRCLE' }
type Reader = {
  data: { title: string; query: string; again: number; found: string | null; heard: string[]; watched: string[]; labels: Record<string, string>; circling: number; problem: string | null }
  states: { on: {}; off: {} }
}

const reader = state<Reader, ReaderEvent>()({
  data: { title: 'Reader', query: '', again: 0, found: null, heard: [], watched: [], labels: {}, circling: 0, problem: null },
  start: 'on',

  on: {
    SET_QUERY: ({ query }) => ({ data: { query, found: null } }),
    RENAME: ({ title }) => ({ data: { title } }),
    AGAIN: (_, { data }) => ({ data: { again: data.again + 1 } }),
    WATCH: ({ ids }) => ({ data: (d) => { d.watched = ids; for (const id of Object.keys(d.labels)) if (!ids.includes(id)) delete d.labels[id] } }),
    TURN: ({ on }) => ({ at: on ? 'on' : 'off' }),
    CIRCLE: (_, { data }) => ({ data: { circling: data.circling + 1 } }),
  },

  states: {
    on: {
      awaits: (asking) => ({
        // Nothing is looked up while there is nothing to look up, and `again` only counts.
        lookup: asking('library', 'LOOKUP', {
          from: ['query', 'again'],
          args: ({ query }) => query !== '' && { query },
          heard: (updates) => ({ data: (d) => { d.heard.push(updates.join('+')) } }),
          ended: (outcome) => (outcome.ok ? { data: { found: outcome.value } } : { data: { problem: outcome.failure.message } }),
        }),

        // One for each thing watched. It is asked once for its key, and what it found stays.
        label: asking('library', 'LOOKUP', {
          each: 'watched',
          args: (id) => ({ query: id }),
          ended: (outcome, { key }) => (outcome.ok ? { data: (d) => { d.labels[key] = outcome.value } } : undefined),
        }),

        // Asked from a field that how it ended changes: it would ask itself again for good.
        circle: asking('library', 'LOOKUP', {
          from: ['circling'],
          args: ({ circling }) => circling > 0 && { query: `round ${circling}` },
          ended: (_, { data }) => ({ data: { circling: data.circling + 1 } }),
        }),
      }),
    },
    off: {},
  },
})

const wired = () => {
  const did: string[] = []
  const defects: string[] = []
  const looked: string[] = []
  const sys = system({ side: 'backend', trace: (line) => { if (line.startsWith('DEFECT')) defects.push(line); if (line.includes('looked at')) looked.push(line) } })
  sys.start('library', library(did))
  const it = sys.start('reader', reader)
  return { did, defects, looked, send: (event: ReaderEvent): void => sys.send(it, event), now: () => sys.read(it).data }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['a read is asked when a field it names changes, and not when another does', async () => {
    const { send, now, did } = wired()
    send({ type: 'SET_QUERY', query: 'apack' })
    await turns(10)
    strictEqual(now().found, 'APACK')
    send({ type: 'RENAME', title: 'Another' })
    await turns(10)
    deepStrictEqual(did, ['lookup apack'])
  }],
  ['a field that only counts has it asked again', async () => {
    const { send, did } = wired()
    send({ type: 'SET_QUERY', query: 'apack' })
    await turns(10)
    send({ type: 'AGAIN' })
    await turns(10)
    deepStrictEqual(did, ['lookup apack', 'lookup apack'])
  }],
  ['where there is nothing to ask for, nothing is asked', async () => {
    const { send, did } = wired()
    send({ type: 'AGAIN' })
    send({ type: 'SET_QUERY', query: '' })
    await turns(10)
    deepStrictEqual(did, [])
  }],
  ['a read asked again gives up the one before: the one answering is told, and only the last is taken', async () => {
    const { send, now, did } = wired()
    send({ type: 'SET_QUERY', query: 'first' })
    await turns(1)
    send({ type: 'SET_QUERY', query: 'second' })
    await turns(12)
    strictEqual(now().found, 'SECOND')
    deepStrictEqual(did, ['lookup first', 'gave up first', 'lookup second'])
  }],
  ['what a read says before it ends is heard, as a list', async () => {
    const { send, now } = wired()
    send({ type: 'SET_QUERY', query: 'apack' })
    await turns(10)
    deepStrictEqual(now().heard, ['apack began', 'apack ended'])
  }],
  ['one is asked for each item of a list, once, and what it found stays', async () => {
    const { send, now, did } = wired()
    send({ type: 'WATCH', ids: ['a', 'b'] })
    await turns(10)
    deepStrictEqual(now().labels, { a: 'A', b: 'B' })
    // A read does not end by taking its key out: the list is the data's, and it is as it was.
    deepStrictEqual(now().watched, ['a', 'b'])
    send({ type: 'WATCH', ids: ['a', 'b', 'c'] })
    await turns(10)
    deepStrictEqual(did, ['lookup a', 'lookup b', 'lookup c'])
    deepStrictEqual(now().labels, { a: 'A', b: 'B', c: 'C' })
  }],
  ['an item taken from the list gives up its read', async () => {
    const { send, now, did } = wired()
    send({ type: 'WATCH', ids: ['a', 'b'] })
    await turns(1)
    send({ type: 'WATCH', ids: ['b'] })
    await turns(10)
    deepStrictEqual(did, ['lookup a', 'lookup b', 'gave up a'])
    deepStrictEqual(now().labels, { b: 'B' })
  }],
  ['leaving the state gives up what it was waiting on, and entering it again asks afresh', async () => {
    const { send, now, did } = wired()
    send({ type: 'SET_QUERY', query: 'apack' })
    await turns(1)
    send({ type: 'TURN', on: false })
    await turns(10)
    deepStrictEqual({ did, found: now().found }, { did: ['lookup apack', 'gave up apack'], found: null })
    // The data still says to look it up, so being the case again is asking again.
    send({ type: 'TURN', on: true })
    await turns(10)
    strictEqual(now().found, 'APACK')
  }],
  ['how a read ended may not change a field it is asked from: it is reported, and not asked again', async () => {
    const { send, now, did, defects } = wired()
    send({ type: 'CIRCLE' })
    await turns(20)
    deepStrictEqual(did, ['lookup round 1'])
    strictEqual(now().circling, 2)
    strictEqual(defects.length, 1)
    ok(defects[0]!.includes('reader#circle delivered changed a field it is itself asked from'))
  }],
  ['which keys there are is looked at only when that field changes', async () => {
    const { send, looked } = wired()
    looked.length = 0
    send({ type: 'RENAME', title: 'Another' })
    send({ type: 'SET_QUERY', query: 'apack' })
    deepStrictEqual(looked, [])
    send({ type: 'WATCH', ids: ['a'] })
    strictEqual(looked.length, 1)
    await turns(10)
  }],
]

/** The commit surface's reads, on a backend whose work a schedule decides. */
const selecting = (schedule: Schedule): (() => void) => {
  const backend = system({ side: 'backend', later: schedule.later })
  backend.start('code', git((what) => schedule.work(what, null)))
  const window = system({ side: 'window', later: schedule.later })
  window.connect(backend)
  const surface = window.start('commit', commit)
  const send = (event: CommitEvent): void => window.send(surface, event)
  schedule.does('the user', ['selects a', () => send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false })], ['selects c', () => send({ type: 'commit.VIEW_DIFF', path: 'c.ts', staged: false })])
  return () => { deepStrictEqual({ diff: window.read(surface).data.gitDiff, error: window.read(surface).data.gitError }, { diff: 'diff of c.ts', error: null }) }
}

// What must not compile.
state<Reader, ReaderEvent>()({
  data: { title: '', query: '', again: 0, found: null, heard: [], watched: [], labels: {}, circling: 0, problem: null },
  start: 'on',
  awaits: (asking) => ({
    // @ts-expect-error there is no such system to ask
    nobody: asking('printer', 'LOOKUP', { args: () => ({ query: '' }), ended: () => {} }),
    // @ts-expect-error the library answers no such ask
    nothing: asking('library', 'SLEEP', { args: () => ({}), ended: () => {} }),
    // @ts-expect-error a lookup is asked for a query, not an id
    wrong: asking('library', 'LOOKUP', { each: 'watched', args: (id) => ({ id }), ended: () => {} }),
    // @ts-expect-error a title is neither a list nor keyed, so it cannot say which to look up
    titled: asking('library', 'LOOKUP', { each: 'title', args: (id) => ({ query: id }), ended: () => {} }),
    // @ts-expect-error it reads the title, which it did not name
    unnamed: asking('library', 'LOOKUP', { from: ['query'], args: ({ title }) => ({ query: title }), ended: () => {} }),
    // @ts-expect-error what a lookup answers is a string, so it cannot be put where the list goes
    misplaced: asking('library', 'LOOKUP', { from: ['query'], args: ({ query }) => ({ query }), ended: (outcome) => (outcome.ok ? { data: { watched: outcome.value } } : undefined) }),
  }),
  states: { on: {}, off: {} },
})

await run(checks, async (tally) => {
  await tally.every('the diff shown is of the file selected last, whichever read ends first', () => explore(selecting))
})
