// The asks a state makes. These are writes: one is made once, because a handler said `make`. Nothing in the data
// stands for it, so nothing in the data has to be taken out when it ends. Which are under way is the kernel's to
// keep, and is read beside the data.
//
//   npx tsx docs/plans/apack-spec/prototype/makes-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { run, system } from './checks.mts'
import { commit, git, type CommitEvent } from './commit.mts'
import { explore, sample, type Schedule } from './schedule.mts'
import { reaching } from './state.mts'

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

type WorkerAsks = {
  /** Runs a job. The one called `flaky` is refused the first time it is run. */
  RUN: { args: { id: string }; progress: string; answer: string; refuses: 'busy' }
  /** Saves what it is given, and answers with what it saved. */
  SAVE: { args: { text: string }; answer: string }
}
type App = { systems: { worker: { events: never; asks: WorkerAsks } }; surfaces: {}; views: {} }
const state = reaching<App>()

/** What the worker was asked and what it was told to give up, in order. */
const worker = (did: string[]) => {
  const tried = new Set<string>()
  return state<{}, never, WorkerAsks>()({
    asks: {
      RUN: async ({ id }, { progress, refuse, signal }) => {
        did.push(`run ${id}`)
        signal.addEventListener('abort', () => { did.push(`gave up ${id}`) })
        progress(`${id} began`)
        await turns(3)
        if (id === 'flaky' && !tried.has(id)) { tried.add(id); throw refuse('busy', 'Not this time') }
        progress(`${id} ended`)
        return `${id} done`
      },
      SAVE: async ({ text }, { signal }) => {
        did.push(`save ${text}`)
        signal.addEventListener('abort', () => { did.push(`gave up saving ${text}`) })
        await turns(3)
        return text
      },
    },
  })
}

type JobsEvent =
  | { type: 'ADD'; id: string }
  | { type: 'DROP'; id: string }
  | { type: 'TYPE'; text: string }
  | { type: 'SAVE' }
  | { type: 'TYPE_AND_SAVE'; text: string }
  | { type: 'STOP_SAVING' }
  | { type: 'BREAK'; id: string }
  | { type: 'TURN'; on: boolean }
type Jobs = {
  data: { text: string; saved: string | null; done: string[]; heard: string[]; tries: Record<string, number>; problem: string | null }
  states: {
    on: { makes: { run: 'each'; save: 'one' } }
    off: {}
  }
}

const jobs = state<Jobs, JobsEvent>()({
  data: { text: '', saved: null, done: [], heard: [], tries: {}, problem: null },
  start: 'on',

  on: {
    TYPE: ({ text }) => ({ data: { text } }),
    TURN: ({ on }) => ({ at: on ? 'on' : 'off' }),
  },

  states: {
    on: {
      makes: ({ one, each }) => ({
        run: each('worker', 'RUN', {
          args: (id) => ({ id }),
          heard: (updates) => ({ data: (d) => { d.heard.push(updates.join('+')) } }),
          ended: (outcome, { key, data, make }) => {
            if (outcome.ok) return { data: (d) => { d.done.push(outcome.value) } }
            // Refused as busy, it is made again, once.
            const tries = (data.tries[key] ?? 0) + 1
            if (outcome.failure.kind === 'busy' && tries < 2) { make('run', key); return { data: (d) => { d.tries[key] = tries } } }
            return { data: { problem: `${key}: ${outcome.failure.message}` } }
          },
        }),

        // What it saves is the text as it is when the save is made.
        save: one('worker', 'SAVE', {
          args: (data) => ({ text: data.text }),
          ended: (outcome) => (outcome.ok ? { data: { saved: outcome.value } } : { data: { problem: outcome.failure.message } }),
        }),
      }),

      on: {
        ADD: ({ id }, { make }) => { make('run', id) },
        DROP: ({ id }, { drop }) => { drop('run', id) },
        SAVE: (_, { make }) => { make('save') },
        // The text is changed and saved in one handler: what is saved is the text it was changed to.
        TYPE_AND_SAVE: ({ text }, { make }) => { make('save'); return { data: { text } } },
        STOP_SAVING: (_, { drop }) => { drop('save') },
        // Makes one, and then throws.
        BREAK: ({ id }, { make }) => { make('run', id); throw new Error('the handler broke') },
      },
    },
    off: {},
  },
})

const wired = () => {
  const did: string[] = []
  const defects: string[] = []
  const sys = system({ side: 'backend', trace: (line) => { if (line.startsWith('DEFECT')) defects.push(line) } })
  sys.start('worker', worker(did))
  const it = sys.start('jobs', jobs)
  const steps: Array<{ making: boolean; data: boolean }> = []
  sys.subscribe((_, fields, changes) => { const mine = changes.jobs; if (mine) steps.push({ making: mine.making, data: (fields.jobs ?? []).length > 0 }) })
  return { did, defects, steps, send: (event: JobsEvent): void => sys.send(it, event), now: () => sys.read(it).data, making: () => sys.read(it).making }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['one is made for each key it is told to, and is under way for that key until it ends', async () => {
    const { send, now, making, did } = wired()
    send({ type: 'ADD', id: 'a' })
    send({ type: 'ADD', id: 'b' })
    deepStrictEqual(making(), { run: { a: true, b: true }, save: false })
    await turns(12)
    deepStrictEqual(making(), { run: {}, save: false })
    deepStrictEqual({ done: now().done.sort(), did }, { done: ['a done', 'b done'], did: ['run a', 'run b'] })
  }],
  ['what is under way is not data: making one changes none of it', async () => {
    const { send, now, steps } = wired()
    const before = now()
    steps.length = 0
    send({ type: 'ADD', id: 'a' })
    deepStrictEqual(steps, [{ making: true, data: false }])
    deepStrictEqual(now(), before)
    await turns(12)
  }],
  ['one that is under way is the same one: it is not made twice', async () => {
    const { send, did } = wired()
    send({ type: 'ADD', id: 'a' })
    send({ type: 'ADD', id: 'a' })
    send({ type: 'SAVE' })
    send({ type: 'SAVE' })
    await turns(12)
    deepStrictEqual(did.sort(), ['run a', 'save '])
  }],
  ['once it has ended it can be made again', async () => {
    const { send, did } = wired()
    send({ type: 'ADD', id: 'a' })
    await turns(12)
    send({ type: 'ADD', id: 'a' })
    await turns(12)
    deepStrictEqual(did, ['run a', 'run a'])
  }],
  ['giving one up tells the one answering, and how it ended is not heard', async () => {
    const { send, now, making, did } = wired()
    send({ type: 'ADD', id: 'a' })
    await turns(1)
    send({ type: 'DROP', id: 'a' })
    deepStrictEqual(making().run, {})
    await turns(12)
    deepStrictEqual(did, ['run a', 'gave up a'])
    deepStrictEqual({ done: now().done, problem: now().problem }, { done: [], problem: null })
  }],
  ['how one ended may have it made again', async () => {
    const { send, now, making, did } = wired()
    send({ type: 'ADD', id: 'flaky' })
    await turns(20)
    deepStrictEqual(did.filter((line) => line.startsWith('run')), ['run flaky', 'run flaky'])
    deepStrictEqual({ done: now().done, making: making().run, problem: now().problem }, { done: ['flaky done'], making: {}, problem: null })
  }],
  ['what one says before it ends is heard, as a list', async () => {
    const { send, now } = wired()
    send({ type: 'ADD', id: 'a' })
    await turns(12)
    deepStrictEqual(now().heard, ['a began', 'a ended'])
  }],
  ['it is made when the step commits, with the data as the handler left it', async () => {
    const { send, now, did } = wired()
    send({ type: 'TYPE', text: 'before' })
    send({ type: 'TYPE_AND_SAVE', text: 'after' })
    await turns(12)
    deepStrictEqual({ did, saved: now().saved }, { did: ['save after'], saved: 'after' })
  }],
  ['one at a time is under way or it is not', async () => {
    const { send, making, did } = wired()
    send({ type: 'SAVE' })
    strictEqual(making().save, true)
    send({ type: 'STOP_SAVING' })
    strictEqual(making().save, false)
    await turns(12)
    deepStrictEqual(did, ['save ', 'gave up saving '])
  }],
  ['leaving the state gives up what it was making, and entering it again makes nothing', async () => {
    const { send, now, making, did, steps } = wired()
    send({ type: 'ADD', id: 'a' })
    await turns(1)
    steps.length = 0
    send({ type: 'TURN', on: false })
    deepStrictEqual(making(), { run: {}, save: false })
    // Whoever reads what it is making is told that it changed.
    deepStrictEqual(steps.map((step) => step.making), [true])
    send({ type: 'TURN', on: true })
    await turns(12)
    // A write was said once. It is not said again by the state being the case again, as a read would be.
    deepStrictEqual({ did, done: now().done }, { did: ['run a', 'gave up a'], done: [] })
  }],
  ['a handler that throws has still said what it said: what it told to be made is made', async () => {
    const { send, now, did, defects } = wired()
    send({ type: 'BREAK', id: 'a' })
    await turns(12)
    strictEqual(defects.length, 1)
    deepStrictEqual({ did, done: now().done }, { did: ['run a'], done: ['a done'] })
  }],
]

// ── the commit surface's writes, under every ordering ───────────────────────────────────────────────────────────────

const repository = (schedule: Schedule) => {
  const backend = system({ side: 'backend', later: schedule.later })
  const code = backend.start('code', git((what) => schedule.work(what, null)))
  const window = system({ side: 'window', later: schedule.later })
  window.connect(backend)
  const surface = window.start('commit', commit)
  return { send: (event: CommitEvent): void => window.send(surface, event), now: () => window.read(surface).data, making: () => window.read(surface).making, held: () => backend.read(code).data }
}
const staging = (schedule: Schedule): (() => void) => {
  const it = repository(schedule)
  schedule.does('the user', ['stages a', () => it.send({ type: 'commit.STAGE_FILE', path: 'a.ts' })], ['stages b', () => it.send({ type: 'commit.STAGE_FILE', path: 'b.ts' })])
  return () => {
    deepStrictEqual(it.held().staged.sort(), ['a.ts', 'b.ts'])
    deepStrictEqual({ making: it.making(), error: it.now().gitError }, { making: { stage: {}, unstage: {}, push: false }, error: null })
    // What is shown is what the repository holds: the last read was made after the last write.
    deepStrictEqual({ ...it.now().gitStatus, staged: [...it.now().gitStatus!.staged].sort() }, { staged: ['a.ts', 'b.ts'], unstaged: ['c.ts'], ahead: 2 })
  }
}
const pushing = (schedule: Schedule): (() => void) => {
  const it = repository(schedule)
  schedule.does('the user', ['pushes', () => it.send({ type: 'commit.PUSH_BRANCH' })], ['stops', () => it.send({ type: 'commit.STOP_PUSH' })])
  return () => {
    deepStrictEqual({ push: it.making().push, phase: it.now().pushPhase, error: it.now().gitError }, { push: false, phase: null, error: null })
    // It was either pushed or it was not: nothing in between is shown.
    strictEqual(it.now().gitStatus?.ahead, it.held().ahead)
  }
}

// What must not compile.
state<Jobs, JobsEvent>()({
  data: { text: '', saved: null, done: [], heard: [], tries: {}, problem: null },
  start: 'on',
  on: {
    // @ts-expect-error a save is made by a state inside, so only a handler there can say to make one
    SAVE: (_, { make }) => { make('save') },
  },
  states: {
    on: {
      makes: ({ one, each }) => ({
        run: each('worker', 'RUN', { args: (id) => ({ id }), ended: () => {} }),
        save: one('worker', 'SAVE', { args: (data) => ({ text: data.text }), ended: () => {} }),
      }),
      on: {
        // @ts-expect-error a job is one of many, so making one takes its key
        ADD: (_, { make }) => { make('run') },
        // @ts-expect-error there is one save at a time, so it takes no key
        STOP_SAVING: (_, { drop }) => { drop('save', 'a') },
        // @ts-expect-error it makes no such thing
        DROP: (_, { make }) => { make('print') },
      },
    },
    off: {},
  },
})
state<Jobs, JobsEvent>()({
  data: { text: '', saved: null, done: [], heard: [], tries: {}, problem: null },
  start: 'on',
  states: {
    on: {
      makes: ({ one, each }) => ({
        // @ts-expect-error a job is one for each of many, so it is made with `each`
        run: one('worker', 'RUN', { args: () => ({ id: '' }), ended: () => {} }),
        // @ts-expect-error what a save answers is a string, so it cannot be put where the list goes
        save: one('worker', 'SAVE', { args: (data) => ({ text: data.text }), ended: (outcome) => (outcome.ok ? { data: { done: outcome.value } } : undefined) }),
      }),
    },
    off: {},
  },
})
// @ts-expect-error a state whose shape says it makes these has to say how
state<Jobs, JobsEvent>()({ data: { text: '', saved: null, done: [], heard: [], tries: {}, problem: null }, start: 'on', states: { on: {}, off: {} } })

await run(checks, async (tally) => {
  await tally.every('two files staged at once are both staged, nothing is left under way, and the status shown is the last', () => sample(staging, { seed: 1, runs: 3_000 }), 'sampled')
  await tally.every('a push stopped at any moment leaves no push under way and reports no failure', () => sample(pushing, { seed: 1, runs: 3_000 }), 'sampled')
  void explore
  void ok
})
