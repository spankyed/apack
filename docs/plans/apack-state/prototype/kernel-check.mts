// What the kernel does with a change to data. Each check drives a running state and reads what came of it.
//
//   npx tsx docs/plans/apack-state/prototype/kernel-check.mts
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert'
import { run as runChecks, system } from './checks.mts'
import { given, reaching, said, WROTE_TO_WHAT_WAS_READ } from './state.mts'

class Repository { constructor(public directory: string) {} }

type Shape = {
  data: { titles: Record<string, string>; messages: Record<string, string[]>; count: number; repository: Repository; kept: { n: number } | null }
  states: {
    list: {}
    thread: { data: { threadId: string } }
  }
}
type Event =
  | { type: 'ADD'; id: string; title: string }
  | { type: 'RENAME'; id: string; title: string }
  | { type: 'NOTHING' }
  | { type: 'OPEN'; id: string }
  | { type: 'CLOSE_AND_COUNT' }
  | { type: 'ADD_A_FIELD' }
  | { type: 'RETURNS_A_VALUE' }
  | { type: 'IS_ASYNC' }
  | { type: 'EDITS_AN_INSTANCE' }
  | { type: 'WRITES_IN_PLACE' }
  | { type: 'KEEP'; item: { n: number } }
  | { type: 'WRITES_THROUGH_A_HELPER' }
  | { type: 'WRITES_FURTHER_IN'; id: string }
  | { type: 'THROWS_ITS_OWN' }
  | { type: 'REMOVES_A_FIELD' }
  | { type: 'ONE_BAD_WRITE' }
  | { type: 'GIVES_A_STRAY_FIELD' }
  | { type: 'MOVES_WITH_A_STRAY_FIELD' }
  | { type: 'MOVES_NOWHERE' }
  | { type: 'MOVES_WITHOUT_WHAT_IT_NEEDS' }
  | { type: 'EDITS_AND_MOVES_NOWHERE' }

/** A helper that writes to what it is given, and says so in its type. */
const bump = (item: { n: number }): void => { item.n++ }

const state = reaching()
const made = state<Shape, Event>()({
  data: { titles: {}, messages: {}, count: 0, repository: new Repository('/a'), kept: null },
  start: 'list',
  on: {
    ADD:     ({ id, title }) => ({ data: (d) => { d.titles[id] = title; d.messages[id] = []; d.count++ } }),
    RENAME:  ({ id, title }) => ({ data: (d) => { d.titles[id] = title } }),
    NOTHING: ()              => ({ data: (d) => { d.count = d.count } }),
    OPEN:    ({ id })        => ({ at: 'thread', data: { threadId: id } }),

    // Each of these is a mistake the kernel has to report and not act on.
    ADD_A_FIELD:       () => ({ data: (d) => { (d as Record<string, unknown>).extra = 1 } }),
    RETURNS_A_VALUE:   () => ({ data: ((d: Shape['data']) => ({ ...d, count: 99 })) as (d: Shape['data']) => void }),
    IS_ASYNC:          () => ({ data: (async (d: Shape['data']) => { await null; d.count = 99 }) as (d: Shape['data']) => void }),
    EDITS_AN_INSTANCE: () => ({ data: (d) => { d.repository.directory = '/b' } }),
    // Writes to what the state holds, where it should return a change.
    WRITES_IN_PLACE:   (_, { data }) => { (data.titles as Record<string, string>).written = 'in place' },
    KEEP:              ({ item }) => ({ data: { kept: item } }),
    // The compiler lets a read-only object be passed where one to write to is expected. Freezing is what stops it.
    WRITES_THROUGH_A_HELPER: (_, { data }) => { if (data.kept) bump(data.kept) },
    // A list inside what a field holds is typed as it was declared, so this compiles. It is frozen all the same.
    WRITES_FURTHER_IN: ({ id }, { data }) => { data.messages[id]?.push('written in place') },
    THROWS_ITS_OWN:    () => { throw new TypeError('not a write at all') },
    REMOVES_A_FIELD:   () => ({ data: (d) => { delete (d as Partial<Shape['data']>).count } }),
    // A good write, then a bad one: neither is made.
    ONE_BAD_WRITE:     () => ({ data: (d) => { d.count = 5; (d as Record<string, unknown>).extra = 1 } }),
    // The same mistakes made by giving fields. The types refuse each, which is why they are cast.
    GIVES_A_STRAY_FIELD:         () => ({ data: { count: 5, extra: 1 } }) as never,
    MOVES_WITH_A_STRAY_FIELD:    () => ({ at: 'thread', data: { threadId: 'a', count: 5, extra: 1 } }) as never,
    MOVES_NOWHERE:               () => ({ at: 'board', data: { count: 5 } }) as never,
    MOVES_WITHOUT_WHAT_IT_NEEDS: () => ({ at: 'thread', data: { count: 5 } }) as never,
    EDITS_AND_MOVES_NOWHERE:     () => ({ at: 'board', data: (d: Shape['data']) => { d.count = 5 } }) as never,
  },
  states: {
    list: {},
    thread: {
      data: { threadId: given },
      on: {
        // A move that edits a draft: the draft is the data here, the thread's id included, edited before the move.
        CLOSE_AND_COUNT: () => ({ at: 'list', data: (d) => { d.messages[d.threadId]?.push('closed'); d.count++ } }),
      },
    },
  },
})

const run = (): { send(event: Event): void; data(): Shape['data']; at(): string; notices: Array<readonly string[]>; defects: string[] } => {
  const notices: Array<readonly string[]> = []
  const defects: string[] = []
  const sys = system({ side: 'backend', trace: (line) => { if (line.startsWith('DEFECT')) defects.push(line) } })
  const handle = sys.start('s', made)
  sys.subscribe((_, fields) => { notices.push(fields.s ?? []) })
  return { send: (event) => sys.send(handle, event), data: () => sys.read(handle).data as Shape['data'], at: () => sys.read(handle).at, notices, defects }
}

const checks: Array<[string, () => void]> = [
  ['a draft edit changes the data and says which fields changed', () => {
    const it = run()
    it.send({ type: 'ADD', id: 'a', title: 'A' })
    deepStrictEqual(it.data().titles, { a: 'A' })
    deepStrictEqual(it.notices.at(-1), ['titles', 'messages', 'count'])
  }],
  ['what an edit did not touch is the same object afterwards', () => {
    const it = run()
    it.send({ type: 'ADD', id: 'a', title: 'A' })
    const messages = it.data().messages
    it.send({ type: 'RENAME', id: 'a', title: 'B' })
    strictEqual(it.data().messages, messages)
    deepStrictEqual(it.notices.at(-1), ['titles'])
  }],
  ['an edit that changes nothing tells nobody', () => {
    const it = run()
    const before = it.notices.length
    it.send({ type: 'NOTHING' })
    strictEqual(it.notices.length, before)
  }],
  ['a move can edit a draft, and the edit sees the data of the state being left', () => {
    const it = run()
    it.send({ type: 'ADD', id: 'a', title: 'A' })
    it.send({ type: 'OPEN', id: 'a' })
    strictEqual(it.at(), 'thread')
    it.send({ type: 'CLOSE_AND_COUNT' })
    strictEqual(it.at(), 'list')
    deepStrictEqual(it.data().messages, { a: ['closed'] })
    strictEqual(it.data().count, 2)
    ok(!('threadId' in it.data()))
  }],
  ['an edit cannot add a field: it is reported and the field is not there', () => {
    const it = run()
    it.send({ type: 'ADD_A_FIELD' })
    ok(!('extra' in it.data()))
    ok(it.defects.some((line) => line.includes('no field extra')))
  }],
  ['the report says which line of the handler tried', () => {
    const it = run()
    it.send({ type: 'ADD_A_FIELD' })
    ok(/There is no field extra to change \(kernel-check\.mts:\d+\)/.test(it.defects[0]!), it.defects[0])
  }],
  ['an edit cannot remove a field', () => {
    const it = run()
    it.send({ type: 'REMOVES_A_FIELD' })
    strictEqual(it.data().count, 0)
    ok(it.defects.some((line) => line.includes('The field count cannot be removed')))
  }],
  ['an edit is all of it or none: a good write before a bad one is not made', () => {
    const it = run()
    const before = it.notices.length
    it.send({ type: 'ONE_BAD_WRITE' })
    strictEqual(it.data().count, 0)
    strictEqual(it.notices.length, before)
    strictEqual(it.defects.length, 1)
  }],
  ['fields are all of them or none, as an edit is: a stray one is reported and the others are not taken', () => {
    const it = run()
    const before = it.notices.length
    it.send({ type: 'GIVES_A_STRAY_FIELD' })
    strictEqual(it.data().count, 0)
    strictEqual(it.notices.length, before)
    deepStrictEqual(it.defects, ['DEFECT: s has no field extra to change'])
  }],
  ['a move is refused before anything is left or entered', () => {
    for (const [type, why] of [
      ['MOVES_WITH_A_STRAY_FIELD', 'DEFECT: s will have no field extra at thread'],
      ['MOVES_NOWHERE', 'DEFECT: s has no state board to go to'],
      ['MOVES_WITHOUT_WHAT_IT_NEEDS', 'DEFECT: s cannot enter thread without threadId'],
      ['EDITS_AND_MOVES_NOWHERE', 'DEFECT: s has no state board to go to'],
    ] as const) {
      const it = run()
      const before = it.notices.length
      it.send({ type })
      strictEqual(it.at(), 'list', type)
      strictEqual(it.data().count, 0, type)
      ok(!('threadId' in it.data()), type)
      strictEqual(it.notices.length, before, type)
      deepStrictEqual(it.defects, [why])
    }
  }],
  ['an edit that returns a value is reported and changes nothing', () => {
    const it = run()
    it.send({ type: 'RETURNS_A_VALUE' })
    strictEqual(it.data().count, 0)
    ok(it.defects.some((line) => line.includes('returns nothing')))
  }],
  ['an async edit is reported and changes nothing', () => {
    const it = run()
    it.send({ type: 'IS_ASYNC' })
    strictEqual(it.data().count, 0)
    ok(it.defects.some((line) => line.includes('cannot be async')))
  }],
  ['what a state holds is frozen all the way down, and what is not plain data is left as it is', () => {
    const it = run()
    it.send({ type: 'ADD', id: 'a', title: 'A' })
    ok(Object.isFrozen(it.data()))
    ok(Object.isFrozen(it.data().titles))
    ok(Object.isFrozen(it.data().messages.a))
    strictEqual(Object.isFrozen(it.data().repository), false)
  }],
  ['a handler that writes to what the state holds, where it should return a change, changes nothing and is reported', () => {
    const it = run()
    const before = it.notices.length
    it.send({ type: 'WRITES_IN_PLACE' })
    deepStrictEqual(it.data().titles, {})
    strictEqual(it.notices.length, before)
    ok(it.defects.some((line) => line.includes('threw handling WRITES_IN_PLACE')), it.defects.join(' / '))
  }],
  ["an object a state is handed is the state's from then on: whoever kept it can no longer write to it", () => {
    const it = run()
    const item = { n: 1 }
    it.send({ type: 'KEEP', item })
    strictEqual(it.data().kept, item)
    throws(() => { item.n = 2 }, TypeError)
    strictEqual(it.data().kept!.n, 1)
  }],
  ['a write the compiler cannot see, through a helper that takes what it is given as writable, still changes nothing', () => {
    const it = run()
    it.send({ type: 'KEEP', item: { n: 1 } })
    it.send({ type: 'WRITES_THROUGH_A_HELPER' })
    strictEqual(it.data().kept!.n, 1)
    ok(it.defects.some((line) => line.includes('threw handling WRITES_THROUGH_A_HELPER')), it.defects.join(' / '))
  }],
  ['a write to what was read is reported with what happened and what to write, from a handler or a helper', () => {
    const it = run()
    it.send({ type: 'ADD', id: 'a', title: 'A' })
    it.send({ type: 'KEEP', item: { n: 1 } })
    for (const type of ['WRITES_IN_PLACE', 'WRITES_THROUGH_A_HELPER'] as const) it.send({ type })
    it.send({ type: 'WRITES_FURTHER_IN', id: 'a' })
    deepStrictEqual(it.data().messages.a, [])
    for (const type of ['WRITES_IN_PLACE', 'WRITES_THROUGH_A_HELPER', 'WRITES_FURTHER_IN']) {
      const line = it.defects.find((defect) => defect.includes(`threw handling ${type}`))
      ok(line?.includes(WROTE_TO_WHAT_WAS_READ), `${type}: ${line}`)
    }
  }],
  ['an error that is not such a write is reported as it was thrown', () => {
    const it = run()
    it.send({ type: 'THROWS_ITS_OWN' })
    const line = it.defects.find((defect) => defect.includes('threw handling THROWS_ITS_OWN'))
    ok(line?.endsWith('not a write at all'), line)
  }],
  ['every kind of write to something frozen is one the kernel knows for a write', () => {
    const writes: Array<[string, (held: { n: number; list: number[]; byId: Record<string, number> }) => void]> = [
      ['a field assigned', (held) => { held.n = 2 }],
      ['a key added', (held) => { held.byId.b = 2 }],
      ['a key removed', (held) => { delete held.byId.a }],
      ['an item assigned', (held) => { held.list[0] = 9 }],
      ['push', (held) => { held.list.push(4) }],
      ['unshift', (held) => { held.list.unshift(0) }],
      ['pop', (held) => { held.list.pop() }],
      ['shift', (held) => { held.list.shift() }],
      ['splice', (held) => { held.list.splice(0, 1) }],
      ['sort', (held) => { held.list.sort((a, b) => b - a) }],
      ['reverse', (held) => { held.list.reverse() }],
      ['fill', (held) => { held.list.fill(0) }],
      ['a length set', (held) => { held.list.length = 0 }],
    ]
    for (const [name, write] of writes) {
      const held = { n: 1, list: Object.freeze([1, 2, 3]) as number[], byId: Object.freeze({ a: 1 }) as Record<string, number> }
      Object.freeze(held)
      let thrown: unknown
      try { write(held) } catch (error) { thrown = error }
      ok(thrown instanceof TypeError, `${name} did not throw`)
      ok(said(thrown).endsWith(WROTE_TO_WHAT_WAS_READ), `${name}: ${(thrown as Error).message}`)
    }
  }],
  ['editing a value that is not plain is reported and the value is untouched', () => {
    const it = run()
    it.send({ type: 'EDITS_AN_INSTANCE' })
    strictEqual(it.data().repository.directory, '/a')
    ok(it.defects.some((line) => line.includes('repository is not plain data')))
  }],
]

// What must not compile: a field of what a handler is handed, or of what is read from a state, cannot be assigned
// at any depth, and a field that is a list cannot be changed in place. What the types leave is a list further in
// changed in place: that compiles, and is what freezing is for (the checks above on a write in place, and on one
// through a helper).
{
  type Shelf = { data: { items: string[]; count: number; byId: Record<string, string[]>; books: { title: string; tags: string[] }[] } }
  type ShelfEvent = { type: 'ASSIGN' } | { type: 'PUSH' } | { type: 'SORT' } | { type: 'KEYED' } | { type: 'DEEP' } | { type: 'FURTHER_IN' }
  state<Shelf, ShelfEvent>()({
    data: { items: [], count: 0, byId: {}, books: [] },
    on: {
      // @ts-expect-error a field is changed by returning a change
      ASSIGN: (_, { data }) => { data.count = 1 },
      // @ts-expect-error a list a field holds is not changed in place
      PUSH: (_, { data }) => { data.items.push('pushed') },
      // @ts-expect-error nor sorted in place
      SORT: (_, { data }) => { data.items.sort() },
      // @ts-expect-error nor is an entry of a record a field holds assigned
      KEYED: (_, { data }) => { data.byId.a = [] },
      // @ts-expect-error nor a field of an object, however far in
      DEEP: (_, { data }) => { const book = data.books[0]; if (book) book.title = 'renamed' },
      // This compiles, and throws when it runs: the list is inside what a field holds, and is typed as it was declared.
      FURTHER_IN: (_, { data }) => { data.byId.a?.push('further in') },
    },
  })
  const read = undefined as unknown as import('./state.mts').Value<Shelf>
  // What is read is handed on as its declared type wherever that only asks for an object: read-only fields ask
  // nothing of a helper, and a string marked as a kind of id is still that string.
  type BookId = string & { readonly book: true }
  type Book = { id: BookId; title: string; tags: string[] }
  const held = undefined as unknown as import('./state.mts').Value<{ data: { open: Book; byId: Record<string, Book> } }>
  const takes = (_book: Book, _id: BookId): void => {}
  if (false) { takes(held.data.open, held.data.open.id); takes(held.data.byId.a!, held.data.byId.a!.id) }
  // @ts-expect-error what is read from a state cannot be assigned
  if (false) read.data.count = 1
  // @ts-expect-error and a list it holds cannot be changed in place
  if (false) read.data.items.sort()
}

// What is read can be handed on as it is: sent, told, reported as progress, given as an answer, and given back as a
// change. None of these is a write, so none asks for a copy. Nothing here is run: it has to compile.
{
  type Shelf = { data: { items: string[]; picked: string[] }; internal: { type: 'TAKEN'; items: string[] } }
  type ShelfEvent = { type: 'TAKE'; items: string[] } | { type: 'PASS_ON' }
  type ShelfAsks = { LIST: { args: {}; progress: string[]; answer: string[] }; LIST_LATER: { args: {}; answer: string[] } }
  state<Shelf, ShelfEvent, ShelfAsks>()({
    data: { items: [], picked: [] },
    on: {
      TAKE: ({ items }) => ({ data: { picked: items } }),
      PASS_ON: (_, { data, send }) => {
        send({ type: 'TAKE', items: data.items })
        send({ type: 'TAKEN', items: data.items })
        return { data: { picked: data.items } }
      },
    },
    internal: {
      // The one place a read value is not taken as it is: a field of a draft, which is typed as what may be written
      // to. It would be safe, since what is read is the state's own and frozen. TypeScript cannot give a field one
      // type to read and another to assign, so here it is copied, or given as a field as `PASS_ON` does.
      // @ts-expect-error a draft's field is typed writable, and what is read is not
      TAKEN: (_, { data }) => ({ data: (d) => { d.picked = data.items } }),
    },
    asks: {
      LIST: (_, { data, progress }) => { progress(data.items); return data.items },
      LIST_LATER: async (_, { data }) => data.items,
    },
  })
}

await runChecks(checks)
