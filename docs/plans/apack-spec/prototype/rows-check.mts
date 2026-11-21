// A step is one unit of the store. What a handler writes is kept with the data it changed and what it sent, or none
// of the three is. Checked against rows in memory, which is everything the kernel knows of a store.
//
//   npx tsx docs/plans/apack-spec/prototype/rows-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { rest, run, system } from './checks.mts'
import { explore, type Schedule } from './schedule.mts'
import { answered, given, reaching } from './state.mts'
import { memory, WROTE_OUTSIDE_A_STEP, type MemoryStore } from './store.mts'

type Asks = {
  CREATE: { args: { id: string; topic: string; parent?: string }; answer: { id: string }; refuses: 'no-parent' | 'taken' }
  CREATE_CHECKED: { args: { id: string }; answer: { id: string }; refuses: 'taken' }
  IMPORT: { args: { id: string; path: string; fail?: boolean }; answer: { id: string }; refuses: 'unreadable'; progress: string }
  STRAY: { args: { id: string }; answer: string }
}
type Events =
  | { type: 'NOTE'; id: string }
  | { type: 'NOTE_THEN_BREAK'; id: string }
  | { type: 'BOTH'; kept: string; broken: string }
  | { type: 'TOUCH' }
  | { type: 'LOAD'; id: string; how: 'at once' | 'writes after waiting' | 'returns its write' }
  | { type: 'BACK' }
const state = reaching()

type Threads = {
  data: { count: number; touched: number; problem: string | null }
  states: { idle: {}; loading: { data: { id: string; how: 'at once' | 'writes after waiting' | 'returns its write' } } }
}

/** A system that keeps threads as rows and how many there are as data: the two a step has to keep in step. */
const threads = (store: MemoryStore, read: (path: string) => Promise<string> = async (path) => `read ${path}`) => state<Threads, Events, Asks>()({
  data: { count: 0, touched: 0, problem: null },
  start: 'idle',
  on: {
    NOTE: ({ id }, { data }) => { store.put('thread', id, { topic: 'noted' }); return { data: { count: data.count + 1 } } },
    // Two rows, and then it throws.
    NOTE_THEN_BREAK: ({ id }) => { store.put('thread', id, { topic: 'first' }); store.put('link', id, { to: 'nowhere' }); throw new Error('broke after writing') },
    // Tells itself two things in one step: one that writes and stays, one that writes and throws.
    BOTH: ({ kept, broken }, { send }) => { send({ type: 'NOTE', id: kept }); send({ type: 'NOTE_THEN_BREAK', id: broken }) },
    TOUCH: (_, { data }) => ({ data: { touched: data.touched + 1 } }),
    LOAD: ({ id, how }) => ({ at: 'loading', data: { id, how } }),
    BACK: () => ({ at: 'idle' }),
  },
  asks: {
    // The thread and its parent's link, and then the refusal: the link is looked for after the thread is written.
    CREATE: ({ id, topic, parent }, { data, refuse }) => {
      if (store.get('thread', id)) throw refuse('taken', `There is a thread ${id}`)
      store.put('thread', id, { topic })
      if (parent !== undefined) {
        if (!store.get('thread', parent)) throw refuse('no-parent', `No thread ${parent}`)
        store.put('link', `${parent}>${id}`, { kind: 'parent_of' })
      }
      return answered({ id }, { data: { count: data.count + 1 } })
    },
    // Writes as it answers, and checks in the change that came with the answer, which is where it can still refuse.
    CREATE_CHECKED: ({ id }, { refuse }) => {
      store.put('thread', id, { topic: 'unchecked' })
      return answered({ id }, {
        data: (draft) => {
          store.put('link', id, { kind: 'made in the change' })
          if (draft.count >= 1) throw refuse('taken', 'There is one already')
          draft.count += 1
        },
      })
    },
    // Marks it as being imported, waits for a file, and returns the rows that came of it.
    IMPORT: async ({ id, path, fail }, { refuse, progress }) => {
      store.put('import', id, { state: 'reading' })
      progress('reading')
      const text = await read(path)
      if (fail) throw refuse('unreadable', `Could not read ${path}`)
      return answered({ id }, {
        data: (draft) => {
          store.put('thread', id, { topic: text })
          store.remove('import', id)
          draft.count += 1
        },
      })
    },
    // Writes a row and returns a change to a field there is not.
    STRAY: ({ id }) => { store.put('thread', id, { topic: 'stray' }); return answered('made', { data: { nothing: 1 } } as never) },
  },
  states: {
    idle: {},
    loading: {
      data: { id: given, how: given },
      run({ data }) {
        store.put('import', data.id, { state: 'reading' })
        if (data.how === 'at once') throw new Error('broke at once')
        return (async () => {
          const text = await read(data.id)
          // Outside a step: this is the write the store refuses.
          if (data.how === 'writes after waiting') store.put('thread', data.id, { topic: text })
          return {
            at: 'idle' as const,
            data: (draft: Threads['data']) => {
              store.put('thread', data.id, { topic: 'loaded' })
              store.remove('import', data.id)
              draft.count += 1
            },
          }
        })()
      },
      failed: (error) => ({ at: 'idle', data: { problem: error instanceof Error ? error.message : String(error) } }),
    },
  },
})

const made = (later?: Schedule['later'], read?: (path: string) => Promise<string>) => {
  const store = memory()
  const traced: string[] = []
  const sys = system({ side: 'backend', store, trace: (line) => { traced.push(line) }, ...(later ? { later } : {}) })
  const handle = sys.start('threads', threads(store, read))
  return { store, sys, handle, traced, defects: () => traced.filter((line) => line.startsWith('DEFECT')) }
}

await run([
  ['a row and the data that counts it are kept together, and whoever is told of the step can read the row', async () => {
    const { store, sys, handle } = made()
    const seen: Array<{ count: number; row: unknown; writing: boolean }> = []
    sys.subscribe(() => { seen.push({ count: sys.read(handle).data.count, row: store.kept('thread', 'a'), writing: store.writing }) })
    sys.send(handle, { type: 'NOTE', id: 'a' })
    deepStrictEqual(seen, [{ count: 1, row: { topic: 'noted' }, writing: false }])
  }],
  ['a step that writes nothing never takes the writer', async () => {
    const { store, sys, handle } = made()
    sys.send(handle, { type: 'TOUCH' })
    sys.send(handle, { type: 'TOUCH' })
    strictEqual(sys.read(handle).data.touched, 2)
    strictEqual(store.opened, 0)
    strictEqual(store.commits, 0)
  }],
  ['a handler that throws after two writes leaves neither row', async () => {
    const { store, sys, handle, defects } = made()
    sys.send(handle, { type: 'NOTE_THEN_BREAK', id: 'a' })
    strictEqual(store.kept('thread', 'a'), undefined)
    strictEqual(store.kept('link', 'a'), undefined)
    strictEqual(store.get('thread', 'a'), undefined)
    strictEqual(defects().length, 1)
  }],
  ['in one step, the handler that throws loses its rows and the one beside it keeps its own, in one keeping', async () => {
    const { store, sys, handle } = made()
    sys.send(handle, { type: 'BOTH', kept: 'a', broken: 'b' })
    deepStrictEqual(store.kept('thread', 'a'), { topic: 'noted' })
    strictEqual(store.kept('thread', 'b'), undefined)
    strictEqual(store.kept('link', 'b'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
    strictEqual(store.commits, 1)
  }],
  ['an ask refused after it wrote has written nothing, and its data is as it was', async () => {
    const { store, sys, handle } = made()
    const outcome = await sys.ask(handle, 'CREATE', { id: 'a', topic: 'orphan', parent: 'missing' })
    ok(!outcome.ok && outcome.failure.kind === 'no-parent')
    strictEqual(store.kept('thread', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 0)
    // And one that is not refused keeps both rows and the count.
    ok((await sys.ask(handle, 'CREATE', { id: 'p', topic: 'parent' })).ok)
    ok((await sys.ask(handle, 'CREATE', { id: 'c', topic: 'child', parent: 'p' })).ok)
    deepStrictEqual(store.kept('link', 'p>c'), { kind: 'parent_of' })
    strictEqual(sys.read(handle).data.count, 2)
  }],
  ['a change that refuses takes back the rows it wrote and the rows the handler wrote before it', async () => {
    const { store, sys, handle } = made()
    ok((await sys.ask(handle, 'CREATE_CHECKED', { id: 'a' })).ok)
    const second = await sys.ask(handle, 'CREATE_CHECKED', { id: 'b' })
    ok(!second.ok && second.failure.kind === 'taken')
    deepStrictEqual(store.kept('thread', 'a'), { topic: 'unchecked' })
    strictEqual(store.kept('thread', 'b'), undefined)
    strictEqual(store.kept('link', 'b'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
  }],
  ['a change the kernel will not make takes the handler\'s rows with it, and the ask is not answered as made', async () => {
    const { store, sys, handle } = made()
    const outcome = await sys.ask(handle, 'STRAY', { id: 'a' })
    ok(!outcome.ok && outcome.failure.kind === 'failed')
    strictEqual(store.kept('thread', 'a'), undefined)
  }],
  ['an ask that waits: the row it wrote first is kept by the time its progress is heard, and the rest with its answer', async () => {
    const { store, sys, handle } = made()
    const heard: Array<{ what: string; writing: boolean; marked: unknown }> = []
    const asked = sys.ask(handle, 'IMPORT', { id: 'a', path: 'a.md' }, (updates) => { for (const what of updates) heard.push({ what, writing: store.writing, marked: store.kept('import', 'a') }) })
    const outcome = await asked
    ok(outcome.ok)
    deepStrictEqual(heard, [{ what: 'reading', writing: false, marked: { state: 'reading' } }])
    deepStrictEqual(store.kept('thread', 'a'), { topic: 'read a.md' })
    strictEqual(store.kept('import', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
  }],
  ['what an ask wrote before it waited is kept when it is refused after: it was a step of its own, as what it sent was', async () => {
    const { store, sys, handle } = made()
    const outcome = await sys.ask(handle, 'IMPORT', { id: 'a', path: 'a.md', fail: true })
    ok(!outcome.ok && outcome.failure.kind === 'unreadable')
    deepStrictEqual(store.kept('import', 'a'), { state: 'reading' })
    strictEqual(store.kept('thread', 'a'), undefined)
  }],
  ['work that throws at once has written nothing, and goes where its state says', async () => {
    const { store, sys, handle } = made()
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'at once' })
    strictEqual(store.kept('import', 'a'), undefined)
    strictEqual(sys.read(handle).at, 'idle')
    strictEqual(sys.read(handle).data.problem, 'broke at once')
  }],
  ['a write after an await is outside a step and is refused on the line that made it', async () => {
    const { store, sys, handle } = made()
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'writes after waiting' })
    await rest()
    strictEqual(sys.read(handle).data.problem, WROTE_OUTSIDE_A_STEP)
    strictEqual(store.kept('thread', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 0)
  }],
  ['after an await the writes are in the change that is returned, and are kept with it', async () => {
    const { store, sys, handle } = made()
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'returns its write' })
    await rest()
    deepStrictEqual(store.kept('thread', 'a'), { topic: 'loaded' })
    strictEqual(store.kept('import', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
    strictEqual(sys.read(handle).data.problem, null)
  }],
  ['work that was left before it returned writes nothing: its change is not made', async () => {
    let finish!: (text: string) => void
    const { store, sys, handle } = made(undefined, () => new Promise((resolve) => { finish = resolve }))
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'returns its write' })
    sys.send(handle, { type: 'BACK' })
    finish('late')
    await rest()
    strictEqual(store.kept('thread', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 0)
  }],
  ['rows that cannot be kept: whoever asked is told it failed, nobody is told of a change, and no more steps are taken', async () => {
    const { store, sys, handle, defects } = made()
    let told = 0
    sys.subscribe(() => { told++ })
    store.failNext('the disk is full')
    const outcome = await sys.ask(handle, 'CREATE', { id: 'a', topic: 'lost' })
    ok(!outcome.ok && outcome.failure.kind === 'failed')
    strictEqual(store.kept('thread', 'a'), undefined)
    strictEqual(told, 0)
    ok(defects().some((line) => line.includes('the disk is full')))
    sys.send(handle, { type: 'TOUCH' })
    strictEqual(sys.read(handle).data.touched, 0)
  }],
], async (tally) => {
  // Two windows' worth of asks and a file that finishes when the schedule says: whatever the order, the count a state
  // holds is the number of thread rows, and no import is left marked as being read.
  await tally.every('under every ordering the count held is the number of rows kept', () => explore((schedule) => {
    const files = new Map<string, Promise<string>>()
    const { store, sys, handle } = made(schedule.later, (path) => files.get(path) ?? Promise.resolve(`read ${path}`))
    files.set('a.md', schedule.work('a.md is read', 'from a'))
    files.set('b.md', schedule.work('b.md is read', 'from b'))
    const outcomes: boolean[] = []
    const asking = (id: string, args: () => Promise<{ ok: boolean }>): readonly [string, () => void] => [`asks for ${id}`, () => { void args().then((outcome) => { outcomes.push(outcome.ok) }) }]
    schedule.does('one window',
      asking('a', () => sys.ask(handle, 'IMPORT', { id: 'a', path: 'a.md' })),
      asking('c', () => sys.ask(handle, 'CREATE', { id: 'c', topic: 'made', parent: 'a' })),
    )
    schedule.does('another window',
      asking('b', () => sys.ask(handle, 'IMPORT', { id: 'b', path: 'b.md', fail: true })),
      ['notes d', () => sys.send(handle, { type: 'NOTE', id: 'd' })],
      ['breaks e', () => sys.send(handle, { type: 'NOTE_THEN_BREAK', id: 'e' })],
    )
    return () => {
      strictEqual(outcomes.length, 3)
      strictEqual(sys.read(handle).data.count, store.ids('thread').length)
      // The link is there exactly when its thread is: c is made only if a had been by then.
      strictEqual(store.kept('link', 'a>c') !== undefined, store.kept('thread', 'c') !== undefined)
      strictEqual(store.kept('thread', 'e'), undefined)
      strictEqual(store.kept('import', 'a'), undefined)
      strictEqual(store.writing, false)
    }
  }))
})
