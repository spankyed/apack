// What a draft has to get right. Each check is a way a hand-built one goes wrong.
//
//   npx tsx docs/plans/apack-spec/prototype/draft-check.mts
import { deepStrictEqual, notStrictEqual, ok, strictEqual, throws } from 'node:assert'
import { produce } from './draft.mts'

const freeze = <T,>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) { Object.freeze(value); for (const inner of Object.values(value)) freeze(inner) }
  return value
}
const paths = (touched: ReadonlyArray<ReadonlyArray<string>>): string[] => touched.map((path) => path.join('.')).sort()

const checks: Array<[string, () => void]> = [
  ['a nested edit makes a new value and leaves the old one alone', () => {
    const base = freeze({ titles: { a: 'A' }, messages: { a: ['one'] }, count: 1 })
    const { value } = produce(base, (draft) => { draft.titles.a = 'B' })
    deepStrictEqual(value, { titles: { a: 'B' }, messages: { a: ['one'] }, count: 1 })
    strictEqual(base.titles.a, 'A')
  }],
  ['what was not edited is the same object as before', () => {
    const base = freeze({ titles: { a: 'A' }, messages: { a: ['one'] } })
    const { value } = produce(base, (draft) => { draft.titles.a = 'B' })
    strictEqual(value.messages, base.messages)
    notStrictEqual(value.titles, base.titles)
    notStrictEqual(value, base)
  }],
  ['an edit that changes nothing returns the very same value', () => {
    const base = freeze({ titles: { a: 'A' }, list: [1, 2] })
    const same = produce(base, (draft) => { draft.titles.a = 'A'; void draft.list[0] })
    strictEqual(same.value, base)
    deepStrictEqual(same.touched, [])
  }],
  ['reading the same place twice gives the same draft', () => {
    produce({ a: { b: { c: 1 } } }, (draft) => { strictEqual(draft.a, draft.a); strictEqual(draft.a.b, draft.a.b) })
  }],
  ['an edit through one reading is seen through another', () => {
    const { value } = produce(freeze({ a: { n: 1 } }), (draft) => { const first = draft.a; const second = draft.a; first.n = 2; strictEqual(second.n, 2) })
    deepStrictEqual(value, { a: { n: 2 } })
  }],
  ['an edit deep inside reaches the top', () => {
    const base = freeze({ a: { b: { c: { d: 1 } } }, other: {} })
    const { value } = produce(base, (draft) => { draft.a.b.c.d = 2 })
    strictEqual(value.a.b.c.d, 2)
    strictEqual(value.other, base.other)
  }],
  ['arrays: push, index assignment, splice, sort and length', () => {
    const base = freeze({ list: [3, 1, 2], rows: [{ n: 1 }, { n: 2 }] })
    const { value } = produce(base, (draft) => {
      draft.list.push(4)
      draft.list[0] = 9
      draft.list.splice(1, 1)
      draft.list.sort()
      draft.rows[1]!.n = 5
      draft.rows.length = 2
    })
    deepStrictEqual(value.list, [2, 4, 9])
    deepStrictEqual(value.rows, [{ n: 1 }, { n: 5 }])
    strictEqual(value.rows[0], base.rows[0])
    deepStrictEqual(base.list, [3, 1, 2])
    ok(Array.isArray(value.list))
  }],
  ['array reading: map, filter, includes, spread and for-of see the edits', () => {
    produce(freeze({ list: [1, 2, 3] }), (draft) => {
      draft.list.push(4)
      deepStrictEqual(draft.list.map((n) => n * 2), [2, 4, 6, 8])
      deepStrictEqual(draft.list.filter((n) => n > 2), [3, 4])
      ok(draft.list.includes(4))
      deepStrictEqual([...draft.list], [1, 2, 3, 4])
      let sum = 0; for (const n of draft.list) sum += n
      strictEqual(sum, 10)
      ok(Array.isArray(draft.list))
    })
  }],
  ['adding and deleting keys, and Object.keys and `in` see it', () => {
    const base = freeze({ tabs: { a: 1, b: 2 } as Record<string, number> })
    const { value } = produce(base, (draft) => {
      draft.tabs.c = 3
      delete draft.tabs.a
      deepStrictEqual(Object.keys(draft.tabs), ['b', 'c'])
      ok(!('a' in draft.tabs) && 'c' in draft.tabs)
    })
    deepStrictEqual(value.tabs, { b: 2, c: 3 })
    deepStrictEqual(base.tabs, { a: 1, b: 2 })
  }],
  ['assigning a new object, and then editing it through the draft', () => {
    const { value } = produce(freeze({ a: { n: 1 } as { n: number; m?: number } }), (draft) => { draft.a = { n: 5 }; draft.a.m = 6 })
    deepStrictEqual(value, { a: { n: 5, m: 6 } })
  }],
  ['assigning one part of the draft to another place', () => {
    const base = freeze({ a: { n: 1 }, b: { n: 0 } })
    const { value } = produce(base, (draft) => { draft.a.n = 2; draft.b = draft.a })
    deepStrictEqual(value, { a: { n: 2 }, b: { n: 2 } })
  }],
  ['what is not plain reads as itself, runs its methods, and can be replaced', () => {
    class Repository { #opened = 0; constructor(readonly directory: string) {} open(): number { return ++this.#opened } }
    const first = new Repository('/a')
    const { value } = produce({ repository: first as Repository | null, other: null as Repository | null, when: new Date(0) }, (draft) => {
      ok(draft.repository instanceof Repository)
      strictEqual(draft.repository!.directory, '/a')
      strictEqual(draft.repository!.open(), 1)
      strictEqual(draft.when.getTime(), 0)
      draft.other = draft.repository
      draft.repository = new Repository('/b')
    })
    ok(value.repository instanceof Repository && value.repository.directory === '/b')
    strictEqual(value.other, first)
  }],
  ['what is not plain refuses to be edited', () => {
    class Repository { cache: string[] = []; constructor(public directory: string) {} }
    const first = new Repository('/a')
    throws(() => produce({ repository: first }, (draft) => { draft.repository.directory = '/b' }), /repository is not plain data/)
    throws(() => produce({ nested: { repository: first } }, (draft) => { draft.nested.repository.cache = [] }), /nested\.repository is not plain data/)
    strictEqual(first.directory, '/a')
  }],
  ['an edit that returns a value is refused', () => {
    const base = freeze({ count: 1 })
    throws(() => produce(base, ((draft: { count: number }) => ({ ...draft, count: 2 })) as (draft: { count: number }) => void), /returns nothing/)
  }],
  ['an async edit is refused', () => {
    const base = { count: 1 }
    throws(() => produce(base, (async (draft: { count: number }) => { await null; draft.count = 2 }) as (draft: { count: number }) => void), /cannot be async/)
  }],
  ['it reports each place that changed', () => {
    const { touched } = produce(freeze({ titles: { a: 'A' } as Record<string, string>, messages: { a: ['x'] }, count: 1, same: 1 }), (draft) => {
      draft.titles.b = 'B'
      draft.messages.a!.push('y')
      draft.count = 2
      draft.same = 1
    })
    deepStrictEqual(paths(touched), ['count', 'messages.a.1', 'titles.b'])
  }],
  ['a draft kept past its handler cannot be used', () => {
    let kept: { n: number } | undefined
    produce({ a: { n: 1 } }, (draft) => { kept = draft.a })
    throws(() => kept!.n, /after the handler/)
    throws(() => { kept!.n = 2 }, /after the handler/)
  }],
  ['an edit that throws leaves nothing behind', () => {
    const base = freeze({ a: { n: 1 } })
    throws(() => produce(base, (draft) => { draft.a.n = 2; throw new Error('no') }), /no/)
    strictEqual(base.a.n, 1)
  }],
]

let failed = 0
for (const [name, check] of checks) {
  try { check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n')[0]}`) }
}
console.log(`\n${checks.length - failed} of ${checks.length} passed`)
if (failed) process.exitCode = 1
