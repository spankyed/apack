// What the Vue binding rests on. A reader is handed the state's own values, a field at a time, and runs again when
// the state replaces a field it read. `effect` here stands for a component's render.
//
//   npx tsx docs/plans/apack-spec/prototype/binding-check.mts
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert'
import { computed, effect } from '@vue/reactivity'
import { mirror } from './mirror.mts'
import { run, system } from './checks.mts'
import { given, reaching, type Each, type Value } from './state.mts'
import { windowFrame } from './window-frame.mts'

/** Not plain data: handed over as it is, and never frozen. */
class Repository { constructor(public directory: string) {} where(): string { return this.directory } }
interface Item { id: string }

type Shape = {
  data: { titles: Record<string, string>; messages: Record<string, string[]>; count: number; known: Item[]; result: { ok: boolean }; repository: Repository }
  states: { list: {}; thread: { data: { threadId: string } } }
}
type Event =
  | { type: 'ADD'; id: string; title: string }
  | { type: 'RENAME'; id: string; title: string }
  | { type: 'SAY'; id: string; text: string }
  | { type: 'FORGET'; id: string }
  | { type: 'TRIM'; id: string }
  | { type: 'OPEN'; id: string }
  | { type: 'CLOSE' }
  | { type: 'COUNT' }
  | { type: 'KNOW'; item: Item }
  | { type: 'DROP'; item: Item }
  | { type: 'RESULT' }

const state = reaching()
const threads = state<Shape, Event>()({
  data: { titles: {}, messages: {}, count: 0, known: [], result: { ok: true }, repository: new Repository('/a') },
  start: 'list',
  on: {
    ADD:    ({ id, title }) => ({ data: (d) => { d.titles[id] = title; d.messages[id] = [] } }),
    RENAME: ({ id, title }) => ({ data: (d) => { d.titles[id] = title } }),
    SAY:    ({ id, text })  => ({ data: (d) => { d.messages[id]?.push(text) } }),
    FORGET: ({ id })        => ({ data: (d) => { delete d.titles[id]; delete d.messages[id] } }),
    TRIM:   ({ id })        => ({ data: (d) => { d.messages[id]?.splice(0, 1) } }),
    OPEN:   ({ id })        => ({ at: 'thread', data: { threadId: id } }),
    CLOSE:  ()              => ({ at: 'list' }),
    COUNT:  (_, { data })   => ({ data: { count: data.count + 1 } }),
    KNOW:   ({ item }, { data }) => ({ data: { known: [...data.known, item] } }),
    // Drops the very one it is handed, as code that keeps a list of what it was told does.
    DROP:   ({ item }, { data }) => ({ data: { known: data.known.filter((each) => each !== item) } }),
    // A result that is the same as the one before, and is another.
    RESULT: ()              => ({ data: { result: { ok: true } } }),
  },
  states: { list: {}, thread: { data: { threadId: given } } },
})

/** A running state, mirrored, with readers that each count how often they ran. */
const watched = () => {
  const sys = system({ side: 'window' })
  const handle = sys.start('threads', threads)
  const send = (event: Event): void => sys.send(handle, event)
  send({ type: 'ADD', id: 'a', title: 'A' })
  send({ type: 'ADD', id: 'b', title: 'B' })
  const held = mirror<Value<Shape>>(sys, handle)
  const runs = { messagesOfA: 0, messagesOfB: 0, titleOfA: 0, where: 0, count: 0, result: 0, partA: 0, partB: 0, partTitleA: 0 }
  const seen: { messagesOfA?: string[]; where?: string } = {}
  effect(() => { runs.messagesOfA++; seen.messagesOfA = [...(held.value.data.messages.a ?? [])] })
  effect(() => { runs.messagesOfB++; void held.value.data.messages.b?.length })
  effect(() => { runs.titleOfA++; void held.value.data.titles.a })
  effect(() => { runs.where++; seen.where = held.value.at })
  effect(() => { runs.count++; void held.value.data.count })
  effect(() => { runs.result++; void held.value.data.result })
  // A reader of one part of a field, through a computed: what the part is is worked out again when the field is
  // replaced, and the reader runs only if it came out another.
  const partA = computed(() => held.value.data.messages.a)
  const partB = computed(() => held.value.data.messages.b)
  const partTitleA = computed(() => held.value.data.titles.a)
  effect(() => { runs.partA++; void partA.value })
  effect(() => { runs.partB++; void partB.value })
  effect(() => { runs.partTitleA++; void partTitleA.value })
  const since = { ...runs }
  /** Which readers ran since the last time this was asked */
  const ran = (): string[] => { const names = (Object.keys(runs) as Array<keyof typeof runs>).filter((name) => runs[name] !== since[name]); Object.assign(since, runs); return names }
  return { send, held, ran, seen, sys, handle }
}

// ── one of many: a card for each item, read from outside ────────────────────────────────────────────────────────────

type Card = { data: { id: string; label: string; bumps: number } }
const card = state<Card, { type: 'BUMP' }>()({
  data: { id: given, label: given, bumps: 0 },
  on: { BUMP: (_, { data }) => ({ data: { bumps: data.bumps + 1 } }) },
})
type Board = { data: { items: Record<string, string> }; starts: { card: Each<typeof card> } }
type BoardEvent = { type: 'ADD'; id: string; label: string } | { type: 'REMOVE'; id: string } | { type: 'BUMP'; id: string }
const board = state<Board, BoardEvent>()({
  data: { items: {} },
  starts: (start) => ({ card: start(card, { each: 'items', given: (id, data) => ({ id, label: data.items[id]! }) }) }),
  on: {
    ADD: ({ id, label }) => ({ data: (d) => { d.items[id] = label } }),
    REMOVE: ({ id }) => ({ data: (d) => { delete d.items[id] } }),
    BUMP: ({ id }, { tell, child }) => { tell(child('card', id), { type: 'BUMP' }) },
  },
})

/** A board with two cards, and a reader of each card, of a third that is not there yet, and of which there are. */
const boarded = () => {
  const sys = system({ side: 'window' })
  const handle = sys.start('board', board)
  const send = (event: BoardEvent): void => sys.send(handle, event)
  send({ type: 'ADD', id: 'a', label: 'Alpha' })
  send({ type: 'ADD', id: 'b', label: 'Beta' })
  // A card is reached from outside by the name it is declared under and its key: what a component would do.
  const held = { board: mirror<Value<Board>>(sys, handle), a: mirror(sys, sys.child(handle, 'card', 'a')), b: mirror(sys, sys.child(handle, 'card', 'b')), c: mirror(sys, sys.child(handle, 'card', 'c')) }
  const runs = { which: 0, a: 0, b: 0, c: 0 }
  const seen: { which?: string[]; a?: number; c?: string } = {}
  effect(() => { runs.which++; seen.which = Object.keys(held.board.value.data.items) })
  effect(() => { runs.a++; seen.a = held.a.value?.data.bumps })
  effect(() => { runs.b++; void held.b.value?.data.bumps })
  effect(() => { runs.c++; seen.c = held.c.value?.data.label })
  const since = { ...runs }
  const ran = (): string[] => { const names = (Object.keys(runs) as Array<keyof typeof runs>).filter((name) => runs[name] !== since[name]); Object.assign(since, runs); return names }
  return { send, ran, seen, sys, handle }
}

// What must not compile: reaching a started state from outside is checked against what its starter declares.
{
  const sys = system({ side: 'window' })
  const handle = sys.start('typed', board)
  // @ts-expect-error a card is one of many, so reaching one takes its key
  void sys.child(handle, 'card')
  // @ts-expect-error the board starts no such state
  void sys.child(handle, 'deck', 'a')
  sys.stop()
}

const checks: Array<[string, () => void]> = [
  ['a change inside a field runs every reader of that field, and no reader of another', () => {
    const it = watched()
    it.send({ type: 'SAY', id: 'a', text: 'hello' })
    deepStrictEqual(it.ran(), ['messagesOfA', 'messagesOfB', 'partA'])
    deepStrictEqual(it.seen.messagesOfA, ['hello'])
    it.send({ type: 'RENAME', id: 'b', title: 'B2' })
    deepStrictEqual(it.ran(), ['titleOfA'])
  }],
  ['a reader of one part, through a computed, runs only when that part was replaced', () => {
    const it = watched()
    it.send({ type: 'SAY', id: 'a', text: 'hello' })
    deepStrictEqual(it.ran().filter((name) => name.startsWith('part')), ['partA'])
    it.send({ type: 'SAY', id: 'b', text: 'other' })
    deepStrictEqual(it.ran().filter((name) => name.startsWith('part')), ['partB'])
    it.send({ type: 'RENAME', id: 'b', title: 'B2' })
    deepStrictEqual(it.ran().filter((name) => name.startsWith('part')), [])
    it.send({ type: 'RENAME', id: 'a', title: 'A2' })
    deepStrictEqual(it.ran().filter((name) => name.startsWith('part')), ['partTitleA'])
  }],
  ['a field replaced whole runs only its reader', () => {
    const it = watched()
    it.send({ type: 'COUNT' })
    deepStrictEqual(it.ran(), ['count'])
  }],
  ['a move runs the reader of where it is, and the mirror gains and loses the fields the states do', () => {
    const it = watched()
    it.send({ type: 'OPEN', id: 'a' })
    deepStrictEqual(it.ran(), ['where'])
    strictEqual(it.seen.where, 'thread')
    strictEqual((it.held.value.data as { threadId?: string }).threadId, 'a')
    it.send({ type: 'CLOSE' })
    strictEqual(it.seen.where, 'list')
    strictEqual('threadId' in it.held.value.data, false)
  }],
  ['removing from the front of a list, and deleting a key, reach the reader', () => {
    const it = watched()
    it.send({ type: 'SAY', id: 'a', text: 'one' })
    it.send({ type: 'SAY', id: 'a', text: 'two' })
    it.ran()
    it.send({ type: 'TRIM', id: 'a' })
    deepStrictEqual(it.seen.messagesOfA, ['two'])
    it.send({ type: 'FORGET', id: 'a' })
    deepStrictEqual(it.seen.messagesOfA, [])
    strictEqual('a' in it.held.value.data.titles, false)
  }],

  // ── what a reader is handed ──────────────────────────────────────────────────────────────────────────────────────

  ["a reader is handed the state's own values, and what a change did not touch is the same object after it", () => {
    const it = watched()
    const titles = it.held.value.data.titles
    strictEqual(titles, it.sys.read(it.handle).data.titles)
    it.send({ type: 'SAY', id: 'a', text: 'hello' })
    strictEqual(it.held.value.data.titles, titles)
    strictEqual(it.held.value.data.messages, it.sys.read(it.handle).data.messages)
  }],
  ['an object read from a state is the one the state finds when it is sent back', () => {
    const it = watched()
    it.send({ type: 'KNOW', item: { id: 'one' } })
    it.send({ type: 'KNOW', item: { id: 'two' } })
    const first = it.held.value.data.known[0]!
    ok(it.sys.read(it.handle).data.known.includes(first))
    it.send({ type: 'DROP', item: first })
    deepStrictEqual(it.held.value.data.known, [{ id: 'two' }])
  }],
  ['what is read can be cloned', () => {
    const it = watched()
    it.send({ type: 'SAY', id: 'a', text: 'hello' })
    deepStrictEqual(structuredClone(it.held.value.data.messages), { a: ['hello'], b: [] })
  }],
  ['a value that is not plain data is handed over as it is, and is not frozen', () => {
    const it = watched()
    const repository = it.held.value.data.repository
    ok(repository instanceof Repository)
    strictEqual(repository.where(), '/a')
    strictEqual(Object.isFrozen(repository), false)
    strictEqual(repository, it.sys.read(it.handle).data.repository)
  }],
  ['a field replaced by a value equal to the one before runs its reader: replaced is changed', () => {
    const it = watched()
    it.send({ type: 'RESULT' })
    deepStrictEqual(it.ran(), ['result'])
    it.send({ type: 'RESULT' })
    deepStrictEqual(it.ran(), ['result'])
  }],
  ['nothing a reader is handed can be written: a field is not set, and a write inside one throws', () => {
    const it = watched()
    const warn = console.warn
    console.warn = () => {}
    try { (it.held.value.data as { count: number }).count = 99 } finally { console.warn = warn }
    strictEqual(it.held.value.data.count, 0)
    strictEqual(it.sys.read(it.handle).data.count, 0)
    throws(() => { (it.held.value.data.messages.a as string[]).push('written') }, TypeError)
    throws(() => { (it.held.value.data.titles as Record<string, string>).a = 'written' }, TypeError)
    deepStrictEqual(it.sys.read(it.handle).data.messages, { a: [], b: [] })
  }],

  // ── a frame, in a window ──────────────────────────────────────────────────────────────────────────────────────────

  ['a change in one of many runs only the reader of that one', () => {
    const it = boarded()
    it.send({ type: 'BUMP', id: 'a' })
    deepStrictEqual(it.ran(), ['a'])
    strictEqual(it.seen.a, 1)
    it.send({ type: 'BUMP', id: 'b' })
    deepStrictEqual(it.ran(), ['b'])
  }],
  ['one that is not running reads as nothing, and its reader runs when it starts and when it stops', () => {
    const it = boarded()
    strictEqual(it.seen.c, undefined)
    it.send({ type: 'ADD', id: 'c', label: 'Gamma' })
    deepStrictEqual(it.ran(), ['which', 'c'])
    strictEqual(it.seen.c, 'Gamma')
    deepStrictEqual(it.seen.which, ['a', 'b', 'c'])
    it.send({ type: 'REMOVE', id: 'c' })
    deepStrictEqual(it.ran(), ['which', 'c'])
    strictEqual(it.seen.c, undefined)
  }],
  ['one that stops and starts again is read afresh, and the readers of the others do not run', () => {
    const it = boarded()
    it.send({ type: 'BUMP', id: 'a' })
    it.send({ type: 'REMOVE', id: 'a' })
    it.ran()
    strictEqual(it.seen.a, undefined)
    it.send({ type: 'ADD', id: 'a', label: 'Alpha again' })
    deepStrictEqual(it.ran(), ['which', 'a'])
    strictEqual(it.seen.a, 0)
  }],
  ['a showing window waits for its next paint', () => {
    const page = fakePage()
    const ran: string[] = []
    page.frame(() => ran.push('one'))
    page.turn()
    deepStrictEqual(ran, [])
    page.paint()
    deepStrictEqual(ran, ['one'])
  }],
  ['a hidden window takes the next turn, since no paint is coming', () => {
    const page = fakePage()
    page.hide()
    const ran: string[] = []
    page.frame(() => ran.push('one'))
    page.turn()
    deepStrictEqual(ran, ['one'])
  }],
  ['what was waiting for a paint when the window was hidden is handed over then, once', () => {
    const page = fakePage()
    const ran: string[] = []
    page.frame(() => ran.push('one'))
    page.hide()
    page.turn()
    deepStrictEqual(ran, ['one'])
    page.show()
    page.paint()
    deepStrictEqual(ran, ['one'])
  }],
]

/** A window whose paints and turns come when the check says so. */
function fakePage() {
  let hidden = false
  const paints: Array<() => void> = []
  const turns: Array<() => void> = []
  const hiddenListeners: Array<() => void> = []
  const frame = windowFrame({
    hidden: () => hidden,
    frame: (run) => { paints.push(run) },
    later: (run) => { turns.push(run) },
    onHidden: (listener) => { hiddenListeners.push(listener) },
  })
  return {
    frame,
    paint: () => { if (!hidden) for (const run of paints.splice(0)) run() },
    turn: () => { for (const run of turns.splice(0)) run() },
    hide: () => { hidden = true; for (const listener of hiddenListeners) listener() },
    show: () => { hidden = false },
  }
}

await run(checks)
