// What the kernel does with a change to data. Each check drives a running state and reads what came of it.
//
//   npx tsx docs/plans/apack-spec/prototype/kernel-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { given, reaching, system } from './state.mts'

class Repository { constructor(public directory: string) {} }

type Shape = {
  data: { titles: Record<string, string>; messages: Record<string, string[]>; count: number; repository: Repository }
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

const state = reaching()
const made = state<Shape, Event>()({
  data: { titles: {}, messages: {}, count: 0, repository: new Repository('/a') },
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
  ['editing a value that is not plain is reported and the value is untouched', () => {
    const it = run()
    it.send({ type: 'EDITS_AN_INSTANCE' })
    strictEqual(it.data().repository.directory, '/a')
    ok(it.defects.some((line) => line.includes('repository is not plain data')))
  }],
]

let failed = 0
for (const [name, check] of checks) {
  try { check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n')[0]}`) }
}
console.log(`\n${checks.length - failed} of ${checks.length} passed`)
if (failed) process.exitCode = 1
