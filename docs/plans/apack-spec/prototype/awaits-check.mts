// The asks a state awaits. They are declared, and which are made follows from the data: a read from the fields it
// names, several writes from the keys of a field, one write from a field that holds it. Nothing spawns an ask, keeps
// an id for it, or handles an event for how it ended.
//
//   npx tsx docs/plans/apack-spec/prototype/awaits-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { commit, git, type CommitEvent } from './commit.mts'
import { explore, sample, type Explored, type Schedule } from './schedule.mts'
import { reaching, system } from './state.mts'

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

// ── a worker, and a state that waits on it ──────────────────────────────────────────────────────────────────────────

type WorkerAsks = {
  /** Runs a job. The one called `flaky` is refused the first time it is run. */
  RUN: { args: { id: string }; progress: string; answer: string; refuses: 'busy' }
  LOOKUP: { args: { query: string }; answer: string }
}
type App = { systems: { worker: { events: never; asks: WorkerAsks } }; surfaces: {}; views: {} }
const state = reaching<App>()

/** What the worker was asked and what it was told to give up, in order. */
const worker = (did: string[], work: (what: string) => Promise<unknown> = () => turns(3)) => {
  const tried = new Set<string>()
  return state<{}, never, WorkerAsks>()({
    asks: {
      RUN: async ({ id }, { progress, refuse, signal }) => {
        did.push(`run ${id}`)
        signal.addEventListener('abort', () => { did.push(`gave up ${id}`) })
        progress(`${id} began`)
        await work(`running ${id}`)
        if (id === 'flaky' && !tried.has(id)) { tried.add(id); throw refuse('busy', 'Not this time') }
        progress(`${id} ended`)
        return `${id} done`
      },
      LOOKUP: async ({ query }) => { did.push(`lookup ${query}`); await work(`looking up ${query}`); return query.toUpperCase() },
    },
  })
}

type JobsEvent =
  | { type: 'ADD'; id: string }
  | { type: 'DROP'; id: string }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'RENAME'; title: string }
  | { type: 'AGAIN' }
  | { type: 'TURN'; on: boolean }
  | { type: 'CIRCLE' }
type Jobs = {
  data: {
    title: string
    queue: string[]
    done: string[]
    heard: string[]
    tries: Record<string, number>
    query: string
    again: number
    found: string | null
    circling: number
    problem: string | null
  }
  states: { on: {}; off: {} }
}

const jobs = state<Jobs, JobsEvent>()({
  data: { title: 'Jobs', queue: [], done: [], heard: [], tries: {}, query: '', again: 0, found: null, circling: 0, problem: null },
  start: 'on',

  on: {
    ADD: ({ id }, { data }) => (data.queue.includes(id) ? undefined : { data: { queue: [...data.queue, id] } }),
    DROP: ({ id }, { data }) => ({ data: { queue: data.queue.filter((queued) => queued !== id) } }),
    SET_QUERY: ({ query }) => ({ data: { query, found: null } }),
    RENAME: ({ title }) => ({ data: { title } }),
    AGAIN: (_, { data }) => ({ data: { again: data.again + 1 } }),
    TURN: ({ on }) => ({ at: on ? 'on' : 'off' }),
    CIRCLE: (_, { data }) => ({ data: { circling: data.circling + 1 } }),
  },

  states: {
    on: {
      awaits: (asking) => ({
        // One for each job in the queue.
        run: asking('worker', 'RUN', {
          each: 'queue',
          args: (id) => ({ id }),
          heard: (updates) => ({ data: (d) => { d.heard.push(updates.join('+')) } }),
          ended: (outcome, { key, data }) => {
            if (outcome.ok) return { data: (d) => { d.done.push(outcome.value) } }
            // Refused as busy, it is put back once, which asks for it again.
            const tries = (data.tries[key] ?? 0) + 1
            if (outcome.failure.kind === 'busy' && tries < 2) return { data: (d) => { d.tries[key] = tries; d.queue.push(key) } }
            return { data: { problem: `${key}: ${outcome.failure.message}` } }
          },
        }),

        // A read. Nothing is looked up while there is nothing to look up, and `again` only counts.
        lookup: asking('worker', 'LOOKUP', {
          from: ['query', 'again'],
          args: ({ query }) => query !== '' && { query },
          ended: (outcome) => (outcome.ok ? { data: { found: outcome.value } } : { data: { problem: outcome.failure.message } }),
        }),

        // Asked from a field that how it ended changes: it would ask itself again for good.
        circle: asking('worker', 'LOOKUP', {
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
  sys.start('worker', worker(did))
  const it = sys.start('jobs', jobs)
  return { sys, did, defects, looked, send: (event: JobsEvent): void => sys.send(it, event), now: () => sys.read(it).data }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['one is asked for each key of a field, and a key goes from the field when its ask ends', async () => {
    const { send, now, did, sys } = wired()
    send({ type: 'ADD', id: 'a' })
    send({ type: 'ADD', id: 'b' })
    deepStrictEqual(now().queue, ['a', 'b'])
    await turns(12)
    deepStrictEqual(now().queue, [])
    deepStrictEqual(now().done.sort(), ['a done', 'b done'])
    deepStrictEqual(did, ['run a', 'run b'])
    sys.stop()
  }],
  ['a key that is already there is not asked for twice', async () => {
    const { send, did, sys } = wired()
    send({ type: 'ADD', id: 'a' })
    send({ type: 'ADD', id: 'a' })
    send({ type: 'RENAME', title: 'Another' })
    await turns(12)
    deepStrictEqual(did, ['run a'])
    sys.stop()
  }],
  ['taking a key out gives its ask up: the one answering is told, and how it ended is not heard', async () => {
    const { send, now, did, sys } = wired()
    send({ type: 'ADD', id: 'a' })
    await turns(1)
    send({ type: 'DROP', id: 'a' })
    await turns(12)
    deepStrictEqual(did, ['run a', 'gave up a'])
    deepStrictEqual({ done: now().done, problem: now().problem }, { done: [], problem: null })
    sys.stop()
  }],
  ['how one ended may put its key back, which asks for it again', async () => {
    const { send, now, did, sys } = wired()
    send({ type: 'ADD', id: 'flaky' })
    await turns(20)
    deepStrictEqual(did.filter((line) => line.startsWith('run')), ['run flaky', 'run flaky'])
    deepStrictEqual({ done: now().done, queue: now().queue, problem: now().problem }, { done: ['flaky done'], queue: [], problem: null })
    sys.stop()
  }],
  ['what an ask says before it ends is heard, as a list', async () => {
    const { send, now, sys } = wired()
    send({ type: 'ADD', id: 'a' })
    await turns(12)
    deepStrictEqual(now().heard, ['a began', 'a ended'])
    sys.stop()
  }],
  ['a read is asked when a field it names changes, and not when another does', async () => {
    const { send, now, did, sys } = wired()
    send({ type: 'SET_QUERY', query: 'apack' })
    await turns(10)
    strictEqual(now().found, 'APACK')
    send({ type: 'RENAME', title: 'Another' })
    send({ type: 'ADD', id: 'a' })
    await turns(12)
    deepStrictEqual(did.filter((line) => line.startsWith('lookup')), ['lookup apack'])
    sys.stop()
  }],
  ['a field that only counts has it asked again', async () => {
    const { send, did, sys } = wired()
    send({ type: 'SET_QUERY', query: 'apack' })
    await turns(10)
    send({ type: 'AGAIN' })
    await turns(10)
    deepStrictEqual(did, ['lookup apack', 'lookup apack'])
    sys.stop()
  }],
  ['where there is nothing to ask for, nothing is asked', async () => {
    const { send, did, sys } = wired()
    send({ type: 'AGAIN' })
    send({ type: 'SET_QUERY', query: '' })
    await turns(10)
    deepStrictEqual(did, [])
    sys.stop()
  }],
  ['a read asked again gives up the one before: only the last is taken', async () => {
    const { send, now, did, sys } = wired()
    send({ type: 'SET_QUERY', query: 'first' })
    await turns(1)
    send({ type: 'SET_QUERY', query: 'second' })
    await turns(12)
    strictEqual(now().found, 'SECOND')
    deepStrictEqual(did, ['lookup first', 'lookup second'])
    sys.stop()
  }],
  ['leaving the state gives up what it was waiting on, and entering it again asks afresh', async () => {
    const { send, now, did, sys } = wired()
    send({ type: 'ADD', id: 'a' })
    await turns(1)
    send({ type: 'TURN', on: false })
    await turns(10)
    deepStrictEqual(did, ['run a', 'gave up a'])
    // It was never taken out of the queue, so it is still to be done.
    deepStrictEqual(now().queue, ['a'])
    send({ type: 'TURN', on: true })
    await turns(12)
    deepStrictEqual({ queue: now().queue, done: now().done }, { queue: [], done: ['a done'] })
    sys.stop()
  }],
  ['how a read ended may not change a field it is asked from: it is reported, and not asked again', async () => {
    const { send, now, did, defects, sys } = wired()
    send({ type: 'CIRCLE' })
    await turns(20)
    deepStrictEqual(did, ['lookup round 1'])
    strictEqual(now().circling, 2)
    strictEqual(defects.length, 1)
    ok(defects[0]!.includes('jobs#circle delivered changed a field it is itself asked from'))
    sys.stop()
  }],
  ['how a write ended may clear the field that holds it: that is not a circle, and nothing is reported', async () => {
    const defects: string[] = []
    const backend = system({ side: 'backend' })
    backend.start('code', git(() => turns(2)))
    const window = system({ side: 'window', trace: (line) => { if (line.startsWith('DEFECT')) defects.push(line) } })
    window.connect(backend)
    const surface = window.start('commit', commit)
    window.send(surface, { type: 'commit.PUSH_BRANCH' })
    await turns(30)
    deepStrictEqual({ push: window.read(surface).data.push, defects }, { push: null, defects: [] })
    // And it can be made again.
    window.send(surface, { type: 'commit.PUSH_BRANCH' })
    strictEqual(window.read(surface).data.push !== null, true)
    await turns(30)
    deepStrictEqual({ push: window.read(surface).data.push, defects }, { push: null, defects: [] })
    window.stop(); backend.stop()
  }],
  ['which keys there are is looked at only when that field changes', async () => {
    const { send, looked, sys } = wired()
    looked.length = 0
    send({ type: 'RENAME', title: 'Another' })
    send({ type: 'SET_QUERY', query: 'apack' })
    deepStrictEqual(looked, [])
    send({ type: 'ADD', id: 'a' })
    strictEqual(looked.length, 1)
    await turns(12)
    sys.stop()
  }],
]

// ── the commit surface, under every ordering ────────────────────────────────────────────────────────────────────────

/** The commit surface in a window, on a backend whose work a schedule decides. */
const repository = (schedule: Schedule) => {
  const said: string[] = []
  const backend = system({ side: 'backend', later: schedule.later })
  const code = backend.start('code', git((what) => schedule.work(what, null), said))
  const window = system({ side: 'window', later: schedule.later })
  window.connect(backend)
  const surface = window.start('commit', commit)
  return { said, send: (event: CommitEvent): void => window.send(surface, event), now: () => window.read(surface).data, held: () => backend.read(code).data }
}
const scenarios: Array<[string, (schedule: Schedule) => () => void, 'all' | number]> = [
  ['the diff shown is of the file selected last, whichever read ends first', (schedule) => {
    const it = repository(schedule)
    schedule.does('the user', ['selects a', () => it.send({ type: 'commit.VIEW_DIFF', path: 'a.ts', staged: false })], ['selects c', () => it.send({ type: 'commit.VIEW_DIFF', path: 'c.ts', staged: false })])
    return () => { deepStrictEqual({ diff: it.now().gitDiff, error: it.now().gitError }, { diff: 'diff of c.ts', error: null }) }
  }, 'all'],
  ['two files staged at once are both staged, nothing is left under way, and the status shown is the last', (schedule) => {
    const it = repository(schedule)
    schedule.does('the user', ['stages a', () => it.send({ type: 'commit.STAGE_FILE', path: 'a.ts' })], ['stages b', () => it.send({ type: 'commit.STAGE_FILE', path: 'b.ts' })])
    return () => {
      deepStrictEqual(it.held().staged.sort(), ['a.ts', 'b.ts'])
      deepStrictEqual({ staging: it.now().staging, error: it.now().gitError }, { staging: {}, error: null })
      // What is shown is what the repository holds: the last read was made after the last write.
      deepStrictEqual({ ...it.now().gitStatus, staged: [...it.now().gitStatus!.staged].sort() }, { staged: ['a.ts', 'b.ts'], unstaged: ['c.ts'], ahead: 2 })
    }
  }, 3_000],
  ['a push stopped at any moment leaves no push under way and reports no failure', (schedule) => {
    const it = repository(schedule)
    schedule.does('the user', ['pushes', () => it.send({ type: 'commit.PUSH_BRANCH' })], ['stops', () => it.send({ type: 'commit.STOP_PUSH' })])
    return () => {
      deepStrictEqual({ push: it.now().push, phase: it.now().pushPhase, error: it.now().gitError }, { push: null, phase: null, error: null })
      // It was either pushed or it was not: nothing in between is shown.
      strictEqual(it.now().gitStatus?.ahead, it.held().ahead)
    }
  }, 3_000],
]

// What must not compile.
state<Jobs, JobsEvent>()({
  data: { title: '', queue: [], done: [], heard: [], tries: {}, query: '', again: 0, found: null, circling: 0, problem: null },
  start: 'on',
  awaits: (asking) => ({
    // @ts-expect-error there is no such system to ask
    nobody: asking('printer', 'RUN', { args: () => ({ id: '' }), ended: () => {} }),
    // @ts-expect-error the worker answers no such ask
    nothing: asking('worker', 'SLEEP', { args: () => ({}), ended: () => {} }),
    // @ts-expect-error a job is run by its id, not by a query
    wrong: asking('worker', 'RUN', { each: 'queue', args: (id) => ({ query: id }), ended: () => {} }),
    // @ts-expect-error a title is neither a list nor keyed, so it cannot say which to run
    titled: asking('worker', 'RUN', { each: 'title', args: (id) => ({ id }), ended: () => {} }),
    // @ts-expect-error it reads the title, which it did not name
    unnamed: asking('worker', 'LOOKUP', { from: ['query'], args: ({ title }) => ({ query: title }), ended: () => {} }),
    // @ts-expect-error what a lookup answers is a string, so it cannot be put where the queue goes
    misplaced: asking('worker', 'LOOKUP', { from: ['query'], args: ({ query }) => ({ query }), ended: (outcome) => (outcome.ok ? { data: { queue: outcome.value } } : undefined) }),
  }),
  states: { on: {}, off: {} },
})

const unhandled: unknown[] = []
process.on('unhandledRejection', (reason) => { unhandled.push(reason) })

let failed = 0
for (const [name, check] of checks) {
  try { await check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n').slice(0, 8).join(' ')}`) }
}
for (const [name, scenario, how] of scenarios) {
  const found: Explored = how === 'all' ? await explore(scenario) : await sample(scenario, { seed: 1, runs: how })
  if (found.failure) { failed++; console.log(`  FAIL  ${name}\n        ${String(found.failure.error).split('\n').slice(0, 6).join(' ')}\n        after: ${found.failure.taken.join(' → ')}\n        replay: [${found.failure.choices.join(', ')}]`) }
  else if (how === 'all' && !found.complete) { failed++; console.log(`  FAIL  ${name}\n        stopped at ${found.orderings} orderings with more to run`) }
  else console.log(`  ok    ${name}  (${found.orderings} orderings${how === 'all' ? ', all there are' : ' from seed 1, of more than can all be run'})`)
}
await turns(30)
if (unhandled.length) { failed++; console.log(`  FAIL  nothing was left unhandled\n        ${String(unhandled[0])}`) } else console.log('  ok    none of it left a rejection unhandled')
const total = checks.length + scenarios.length + 1
console.log(`\n${total - failed} of ${total} passed`)
if (failed) process.exitCode = 1
