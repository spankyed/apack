// What the kernel does with a change to data. Each check drives a running state and reads what came of it.
//
//   npx tsx docs/plans/apack-spec/prototype/kernel-check.mts
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert'
import { run as runChecks, system } from './checks.mts'
import { given, reaching } from './state.mts'

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
  | { type: 'REMOVES_A_FIELD' }
  | { type: 'ONE_BAD_WRITE' }
  | { type: 'GIVES_A_STRAY_FIELD' }
  | { type: 'MOVES_WITH_A_STRAY_FIELD' }
  | { type: 'MOVES_NOWHERE' }
  | { type: 'MOVES_WITHOUT_WHAT_IT_NEEDS' }
  | { type: 'EDITS_AND_MOVES_NOWHERE' }

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
  ['editing a value that is not plain is reported and the value is untouched', () => {
    const it = run()
    it.send({ type: 'EDITS_AN_INSTANCE' })
    strictEqual(it.data().repository.directory, '/a')
    ok(it.defects.some((line) => line.includes('repository is not plain data')))
  }],
]

await runChecks(checks)
