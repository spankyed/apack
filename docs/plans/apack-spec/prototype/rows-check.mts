// A step is one unit of the database. What a handler writes is kept with the data it changed and what it sent, or
// none of the three is. Every check is run twice: against rows kept in memory, and against the app's engine, elmdb,
// on a temporary database. The kernel is given the `transact` of each and nothing else.
//
//   npx tsx docs/plans/apack-spec/prototype/rows-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { rest, run, system } from './checks.mts'
import { explore, type Schedule } from './schedule.mts'
import { answered, given, reaching } from './state.mts'
import { memory, WROTE_OUTSIDE_A_STEP, type Rows } from './store.mts'
import { elmdb } from './store-elmdb.mts'

type Asks = {
  CREATE: { args: { id: string; topic: string; parent?: string }; answer: { id: string }; refuses: 'no-parent' | 'taken' }
  CREATE_CHECKED: { args: { id: string }; answer: { id: string }; refuses: 'taken' }
  IMPORT: { args: { id: string; path: string; fail?: boolean }; answer: { id: string }; refuses: 'unreadable'; progress: string }
  STRAY: { args: { id: string }; answer: string }
  FORK: { args: { from: string; id: string; fail?: boolean }; answer: { id: string }; refuses: 'no-such' }
}
type Events =
  | { type: 'NOTE'; id: string }
  | { type: 'NOTE_THEN_BREAK'; id: string }
  | { type: 'BOTH'; kept: string; broken: string }
  | { type: 'TOUCH' }
  | { type: 'LOAD'; id: string; how: 'at once' | 'writes after waiting' | 'returns its write' | 'breaks, and so does failed' }
  | { type: 'BACK' }
  | { type: 'JOIN'; from: string; to: string }
  | { type: 'JOIN_AHEAD'; from: string; to: string }
const state = reaching()

type Threads = {
  data: { count: number; touched: number; problem: string | null }
  states: { idle: {}; loading: { data: { id: string; how: 'at once' | 'writes after waiting' | 'returns its write' | 'breaks, and so does failed' } } }
}

/** A system that keeps threads as rows and how many there are as data: the two a step has to keep in step. */
/**
 * A repository's command, as the app's are written: it is a unit of its own, so that it is whole wherever it is
 * called from. Inside a step it joins the step's.
 */
const commands = (store: Rows) => ({
  fork: (from: string, id: string): void => store.transact(() => {
    store.put('thread', id, { topic: `fork of ${from}` })
    store.join(from, id)
  }),
})

const threads = (store: Rows, read: (path: string) => Promise<string> = async (path) => `read ${path}`) => state<Threads, Events, Asks>()({
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
    // A join, which both threads have to be there for.
    JOIN: ({ from, to }) => { store.join(from, to) },
    // In one step: the join first, and the thread it joins to after.
    JOIN_AHEAD: ({ from, to }, { send }) => { send({ type: 'JOIN', from, to }); send({ type: 'NOTE', id: to }) },
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
    // Two commands, each a unit of its own, and then perhaps a refusal.
    FORK: ({ from, id, fail }, { data, refuse }) => {
      commands(store).fork(from, id)
      commands(store).fork(from, `${id}-again`)
      if (fail) throw refuse('no-such', 'Refused after both commands returned')
      return answered({ id }, { data: { count: data.count + 2 } })
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
        if (data.how === 'breaks, and so does failed') return Promise.reject(new Error('broke later'))
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
      failed: (error, { data }) => {
        // Writes that it failed, and then fails itself.
        if (data.how === 'breaks, and so does failed') { store.put('thread', `failed-${data.id}`, { topic: 'noted the failure' }); throw new Error('failed broke as well') }
        return { at: 'idle', data: { problem: error instanceof Error ? error.message : String(error) } }
      },
    },
  },
})

/**
 * Waits until every watch has delivered. The engine's own timers do not keep a process alive, so while this waits
 * something else has to: with nothing else under way the process would end with the check unfinished.
 */
const settled = async (store: ReturnType<typeof elmdb>): Promise<void> => {
  const alive = setInterval(() => {}, 1_000)
  try { await store.engine.admin.watchesSettled() } finally { clearInterval(alive) }
}

type Kept = readonly [name: string, open: () => Rows]
const stores: readonly Kept[] = [['in memory', memory], ['in elmdb', elmdb]]
/** The store of the scenario before this one, closed as the next is made. */
let before: Rows | undefined

const made = (open: () => Rows, later?: Schedule['later'], read?: (path: string) => Promise<string>) => {
  before?.close()
  const store = before = open()
  const traced: string[] = []
  const sys = system({ side: 'backend', transact: store.transact, trace: (line) => { traced.push(line) }, ...(later ? { later } : {}) })
  const handle = sys.start('threads', threads(store, read))
  return { store, sys, handle, traced, defects: () => traced.filter((line) => line.startsWith('DEFECT')) }
}

const checks = ([kept, open]: Kept): Array<readonly [string, () => void | Promise<void>]> => ([
  ['a row and the data that counts it are kept together, and whoever is told of the step can read the row', async () => {
    const { store, sys, handle } = made(open)
    const seen: Array<{ count: number; row: unknown; writing: boolean }> = []
    sys.subscribe(() => { seen.push({ count: sys.read(handle).data.count, row: store.get('thread', 'a'), writing: store.writing }) })
    sys.send(handle, { type: 'NOTE', id: 'a' })
    deepStrictEqual(seen, [{ count: 1, row: { topic: 'noted' }, writing: false }])
  }],
  ['a step that writes nothing never takes the writer', async () => {
    const { store, sys, handle } = made(open)
    sys.send(handle, { type: 'TOUCH' })
    sys.send(handle, { type: 'TOUCH' })
    strictEqual(sys.read(handle).data.touched, 2)
    strictEqual(store.opened, 0)
    strictEqual(store.commits, 0)
  }],
  ['a handler that throws after two writes leaves neither row', async () => {
    const { store, sys, handle, defects } = made(open)
    sys.send(handle, { type: 'NOTE_THEN_BREAK', id: 'a' })
    strictEqual(store.get('thread', 'a'), undefined)
    strictEqual(store.get('link', 'a'), undefined)
    strictEqual(store.get('thread', 'a'), undefined)
    strictEqual(defects().length, 1)
  }],
  ['in one step, the handler that throws loses its rows and the one beside it keeps its own, in one keeping', async () => {
    const { store, sys, handle } = made(open)
    sys.send(handle, { type: 'BOTH', kept: 'a', broken: 'b' })
    deepStrictEqual(store.get('thread', 'a'), { topic: 'noted' })
    strictEqual(store.get('thread', 'b'), undefined)
    strictEqual(store.get('link', 'b'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
    strictEqual(store.commits, 1)
  }],
  ['an ask refused after it wrote has written nothing, and its data is as it was', async () => {
    const { store, sys, handle } = made(open)
    const outcome = await sys.ask(handle, 'CREATE', { id: 'a', topic: 'orphan', parent: 'missing' })
    ok(!outcome.ok && outcome.failure.kind === 'no-parent')
    strictEqual(store.get('thread', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 0)
    // And one that is not refused keeps both rows and the count.
    ok((await sys.ask(handle, 'CREATE', { id: 'p', topic: 'parent' })).ok)
    ok((await sys.ask(handle, 'CREATE', { id: 'c', topic: 'child', parent: 'p' })).ok)
    deepStrictEqual(store.get('link', 'p>c'), { kind: 'parent_of' })
    strictEqual(sys.read(handle).data.count, 2)
  }],
  ['a change that refuses takes back the rows it wrote and the rows the handler wrote before it', async () => {
    const { store, sys, handle } = made(open)
    ok((await sys.ask(handle, 'CREATE_CHECKED', { id: 'a' })).ok)
    const second = await sys.ask(handle, 'CREATE_CHECKED', { id: 'b' })
    ok(!second.ok && second.failure.kind === 'taken')
    deepStrictEqual(store.get('thread', 'a'), { topic: 'unchecked' })
    strictEqual(store.get('thread', 'b'), undefined)
    strictEqual(store.get('link', 'b'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
  }],
  ['a change the kernel will not make takes the handler\'s rows with it, and the ask is not answered as made', async () => {
    const { store, sys, handle } = made(open)
    const outcome = await sys.ask(handle, 'STRAY', { id: 'a' })
    ok(!outcome.ok && outcome.failure.kind === 'failed')
    strictEqual(store.get('thread', 'a'), undefined)
  }],
  ['an ask that waits: the row it wrote first is kept by the time its progress is heard, and the rest with its answer', async () => {
    const { store, sys, handle } = made(open)
    const heard: Array<{ what: string; writing: boolean; marked: unknown }> = []
    const asked = sys.ask(handle, 'IMPORT', { id: 'a', path: 'a.md' }, (updates) => { for (const what of updates) heard.push({ what, writing: store.writing, marked: store.get('import', 'a') }) })
    const outcome = await asked
    ok(outcome.ok)
    deepStrictEqual(heard, [{ what: 'reading', writing: false, marked: { state: 'reading' } }])
    deepStrictEqual(store.get('thread', 'a'), { topic: 'read a.md' })
    strictEqual(store.get('import', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
  }],
  ['what an ask wrote before it waited is kept when it is refused after: it was a step of its own, as what it sent was', async () => {
    const { store, sys, handle } = made(open)
    const outcome = await sys.ask(handle, 'IMPORT', { id: 'a', path: 'a.md', fail: true })
    ok(!outcome.ok && outcome.failure.kind === 'unreadable')
    deepStrictEqual(store.get('import', 'a'), { state: 'reading' })
    strictEqual(store.get('thread', 'a'), undefined)
  }],
  ['work that throws at once has written nothing, and goes where its state says', async () => {
    const { store, sys, handle } = made(open)
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'at once' })
    strictEqual(store.get('import', 'a'), undefined)
    strictEqual(sys.read(handle).at, 'idle')
    strictEqual(sys.read(handle).data.problem, 'broke at once')
  }],
  ['where work goes when it fails is a handler too: one that writes and then throws has written nothing', async () => {
    const { store, sys, handle, defects } = made(open)
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'breaks, and so does failed' })
    await rest()
    strictEqual(store.get('thread', 'failed-a'), undefined)
    // What its work wrote as it began was a step of its own, and is kept.
    deepStrictEqual(store.get('import', 'a'), { state: 'reading' })
    ok(defects().some((line) => line.includes('failed broke as well')))
  }],
  ['a write after an await is outside a step and is refused on the line that made it', async () => {
    const { store, sys, handle } = made(open)
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'writes after waiting' })
    await rest()
    strictEqual(sys.read(handle).data.problem, WROTE_OUTSIDE_A_STEP)
    strictEqual(store.get('thread', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 0)
  }],
  ['after an await the writes are in the change that is returned, and are kept with it', async () => {
    const { store, sys, handle } = made(open)
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'returns its write' })
    await rest()
    deepStrictEqual(store.get('thread', 'a'), { topic: 'loaded' })
    strictEqual(store.get('import', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 1)
    strictEqual(sys.read(handle).data.problem, null)
  }],
  ['work that was left before it returned writes nothing: its change is not made', async () => {
    let finish!: (text: string) => void
    const { store, sys, handle } = made(open, undefined, () => new Promise((resolve) => { finish = resolve }))
    sys.send(handle, { type: 'LOAD', id: 'a', how: 'returns its write' })
    sys.send(handle, { type: 'BACK' })
    finish('late')
    await rest()
    strictEqual(store.get('thread', 'a'), undefined)
    strictEqual(sys.read(handle).data.count, 0)
  }],
  ['rows that cannot be kept: whoever asked is told it failed, nobody is told of the change, and the system stops with every state ended', async () => {
    const { store, sys, handle, defects } = made(open)
    const told: Array<{ count: number | undefined }> = []
    sys.subscribe(() => { told.push({ count: sys.read(handle)?.data.count }) })
    store.failNext('the disk is full')
    const outcome = await sys.ask(handle, 'CREATE', { id: 'a', topic: 'lost' })
    ok(!outcome.ok && outcome.failure.kind === 'failed')
    strictEqual(store.get('thread', 'a'), undefined)
    // What subscribers hear is that the state is gone, and never the count the lost step had made.
    deepStrictEqual(told, [{ count: undefined }])
    ok(defects().some((line) => line.includes('the disk is full')))
    sys.send(handle, { type: 'TOUCH' })
    strictEqual(sys.read(handle), undefined)
  }],
  ['rows that cannot be kept: an ask that was being answered, one waiting to be taken, and one made after are each told, and none waits', async () => {
    let finish!: (text: string) => void
    const { store, sys, handle } = made(open, undefined, () => new Promise((resolve) => { finish = resolve }))
    // Being answered: its handler wrote, and is waiting on a file.
    const importing = sys.ask(handle, 'IMPORT', { id: 'a', path: 'a.md' })
    // It cannot come to rest while it waits on its file, so this is a turn and no more.
    await new Promise((resolve) => { setImmediate(resolve) })
    deepStrictEqual(store.get('import', 'a'), { state: 'reading' })
    store.failNext('the disk is full')
    const lost = await sys.ask(handle, 'CREATE', { id: 'b', topic: 'lost' })
    ok(!lost.ok && lost.failure.kind === 'failed')
    const answering = await importing
    ok(!answering.ok && answering.failure.kind === 'abandoned')
    // Its file arrives after the system stopped: nothing takes it, and nothing is written.
    finish('late')
    await rest()
    strictEqual(store.get('thread', 'a'), undefined)
    const after = await sys.ask(handle, 'CREATE', { id: 'c', topic: 'after' })
    ok(!after.ok && after.failure.kind === 'unavailable')
    strictEqual(store.get('thread', 'c'), undefined)
    strictEqual(store.writing, false)
  }],
  ['a command that is a unit of its own joins the step: two of them and the count are kept in one keeping', async () => {
    const { store, sys, handle } = made(open)
    ok((await sys.ask(handle, 'CREATE', { id: 'a', topic: 'first' })).ok)
    const commits = store.commits
    ok((await sys.ask(handle, 'FORK', { from: 'a', id: 'b' })).ok)
    strictEqual(store.commits, commits + 1)
    deepStrictEqual(store.get('thread', 'b-again'), { topic: 'fork of a' })
    ok(store.joined('a', 'b') && store.joined('a', 'b-again'))
    strictEqual(sys.read(handle).data.count, 3)
  }],
  ['a handler that refuses after its commands returned takes back what they wrote', async () => {
    const { store, sys, handle } = made(open)
    ok((await sys.ask(handle, 'CREATE', { id: 'a', topic: 'first' })).ok)
    const outcome = await sys.ask(handle, 'FORK', { from: 'a', id: 'b', fail: true })
    ok(!outcome.ok && outcome.failure.kind === 'no-such')
    strictEqual(store.get('thread', 'b'), undefined)
    strictEqual(store.get('thread', 'b-again'), undefined)
    ok(!store.joined('a', 'b'))
    strictEqual(sys.read(handle).data.count, 1)
  }],
  ['outside any step a command is still whole, and a bare write is refused: what a flow action does', async () => {
    const { store } = made(open)
    store.transact(() => { store.put('thread', 'a', { topic: 'by an action' }) })
    commands(store).fork('a', 'b')
    ok(store.joined('a', 'b'))
    let threw = ''
    try { store.put('thread', 'c', { topic: 'bare' }) } catch (error) { threw = (error as Error).message }
    strictEqual(threw, WROTE_OUTSIDE_A_STEP)
    strictEqual(store.get('thread', 'c'), undefined)
  }],
  ['a join to a thread written later in the step is refused where it is written: its handler fails alone, and the thread is still made', async () => {
    const { store, sys, handle, defects } = made(open)
    sys.send(handle, { type: 'NOTE', id: 'a' })
    sys.send(handle, { type: 'JOIN_AHEAD', from: 'a', to: 'b' })
    ok(!store.joined('a', 'b'))
    deepStrictEqual(store.get('thread', 'b'), { topic: 'noted' })
    strictEqual(sys.read(handle).data.count, 2)
    strictEqual(defects().length, 1)
  }],
  ['a join to nothing fails its handler, and the step and the system go on', async () => {
    const { store, sys, handle, defects } = made(open)
    sys.send(handle, { type: 'NOTE', id: 'a' })
    sys.send(handle, { type: 'JOIN', from: 'a', to: 'nowhere' })
    ok(!store.joined('a', 'nowhere'))
    strictEqual(defects().length, 1)
    deepStrictEqual(store.get('thread', 'a'), { topic: 'noted' })
    sys.send(handle, { type: 'TOUCH' })
    strictEqual(sys.read(handle).data.touched, 1)
  }],
])

await run([...stores.flatMap((kept) => checks(kept).map(([name, body]) => [`${kept[0]}: ${name}`, body] as const)),
  ['in elmdb: a view of the rows is delivered after the step that wrote them, and whoever was answered can already read them', async () => {
    const store = elmdb()
    before?.close()
    before = store
    const sys = system({ side: 'backend', transact: store.transact })
    const handle = sys.start('threads', threads(store))
    const seen: Array<{ rows: number; count: number; commit: number }> = []
    const watching = store.engine.watch(() => store.count('thread'), (rows, commit) => { seen.push({ rows, count: sys.read(handle).data.count, commit }) })
    await settled(store)
    const answer = await sys.ask(handle, 'CREATE', { id: 'a', topic: 'watched' })
    ok(answer.ok)
    // Whoever was answered reads the row at once, before any view has been delivered again.
    deepStrictEqual(store.get('thread', 'a'), { topic: 'watched' })
    await settled(store)
    watching.stop()
    // The view saw no rows, and then one: and by then the state that counts them had counted it.
    deepStrictEqual(seen.map(({ rows, count }) => ({ rows, count })), [{ rows: 0, count: 0 }, { rows: 1, count: 1 }])
    strictEqual(seen[1]!.commit, store.engine.lastCommit())
  }],
], async (tally) => {
  // Two windows' worth of asks and a file that finishes when the schedule says: whatever the order, the count a state
  // holds is the number of thread rows, and no import is left marked as being read.
  for (const [kept, open] of stores) await tally.every(`${kept}: under every ordering the count held is the number of rows kept`, () => explore((schedule) => {
    const files = new Map<string, Promise<string>>()
    const { store, sys, handle } = made(open, schedule.later, (path) => files.get(path) ?? Promise.resolve(`read ${path}`))
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
      strictEqual(sys.read(handle).data.count, store.count('thread'))
      // The link is there exactly when its thread is: c is made only if a had been by then.
      strictEqual(store.get('link', 'a>c') !== undefined, store.get('thread', 'c') !== undefined)
      strictEqual(store.get('thread', 'e'), undefined)
      strictEqual(store.get('import', 'a'), undefined)
      strictEqual(store.writing, false)
    }
  }))
})
