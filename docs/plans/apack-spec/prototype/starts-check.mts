// The states a state starts. They are declared, and which of them run follows from the data: nothing starts or
// stops one by hand. So starting is part of a change, in its step, and what runs cannot disagree with the data.
//
//   npx tsx docs/plans/apack-spec/prototype/starts-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { explore, type Schedule } from './schedule.mts'
import { answered, each, given, one, reaching, system, type Each } from './state.mts'

const state = reaching()
const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

// ── a card: one for each item on the board ──────────────────────────────────────────────────────────────────────────

type CardEvent = { type: 'BUMP' }
type CardAsks = { LABEL: { args: {}; answer: string }; SLOWLY: { args: {}; answer: string } }
type Card = {
  data: { id: string; label: string; bumps: number }
  /** What it tells the board, which started it. */
  reports: { type: 'CARD_BUMPED'; bumps: number }
}
const card = (log: string[]) => state<Card, CardEvent, CardAsks>()({
  // Which card it is and what it says are given by whoever starts it. How often it was bumped is its own.
  data: { id: given, label: given, bumps: 0 },
  run({ data, use }) { const { id } = data; log.push(`started ${id}`); use(() => { log.push(`stopped ${id}`) }) },
  on: {
    BUMP: (_, { data, report }) => { report({ type: 'CARD_BUMPED', bumps: data.bumps + 1 }); return { data: { bumps: data.bumps + 1 } } },
  },
  asks: {
    LABEL: (_, { data }) => data.label,
    SLOWLY: async (_, { data }) => { await turns(20); return data.label },
  },
})

/** Started by the board only while it is open, and given the board's title as it is then. */
const helper = (log: string[]) => state<{ data: { title: string } }, never>()({
  data: { title: given },
  run({ data, use }) { log.push(`started helper for ${data.title}`); use(() => { log.push('stopped helper') }) },
})

// ── the board ───────────────────────────────────────────────────────────────────────────────────────────────────────

type BoardEvent =
  | { type: 'ADD'; id: string; label: string }
  | { type: 'REMOVE'; id: string }
  | { type: 'RETITLE'; title: string }
  | { type: 'BUMP'; id: string }
  | { type: 'CLOSE' }
  | { type: 'OPEN' }
  | { type: 'ADD_THEN_BUMP'; id: string; label: string }
  // from a card it started
  | { type: 'CARD_BUMPED'; bumps: number; from: string }
type BoardAsks = {
  /** Adds an item once its work is done, and refuses if one is there by then. */
  ADD_LATER: { args: { id: string; label: string }; answer: 'added'; refuses: 'exists' }
  /** Asks the card for its label, and says how that went. */
  LABEL_OF: { args: { id: string }; answer: string }
  SLOWLY_OF: { args: { id: string }; answer: string }
}
type Board = {
  data: { title: string; items: Record<string, string>; lastBump: string | null }
  starts: { card: Each<ReturnType<typeof card>> }
  states: { open: { starts: { helper: ReturnType<typeof helper> } }; closed: {} }
}

const board = (log: string[], work: (label: string) => Promise<unknown> = () => turns(4)) => state<Board, BoardEvent, BoardAsks>()({
  data: { title: 'Board', items: {}, lastBump: null },
  start: 'open',

  starts: {
    // A card for each item, told which it is and what it says.
    card: each('items', card(log), (id, data) => ({ id, label: data.items[id]! })),
  },

  on: {
    ADD: ({ id, label }) => ({ data: (d) => { d.items[id] = label } }),
    REMOVE: ({ id }) => ({ data: (d) => { delete d.items[id] } }),
    RETITLE: ({ title }) => ({ data: { title } }),
    BUMP: ({ id }, { tell, child }) => { tell(child('card', id), { type: 'BUMP' }) },
    CLOSE: () => ({ at: 'closed' }),
    OPEN: () => ({ at: 'open' }),
    // Tells itself to add an item and then to bump it: two more things in the step this one is handled in.
    ADD_THEN_BUMP: ({ id, label }, { send }) => { send({ type: 'ADD', id, label }); send({ type: 'BUMP', id }) },
    CARD_BUMPED: ({ bumps, from }) => ({ data: { lastBump: `${from} to ${bumps}` } }),
  },

  asks: {
    ADD_LATER: async ({ id, label }, { refuse }) => {
      await work(`adding ${label}`)
      return answered('added' as const, {
        data: (d) => {
          if (id in d.items) throw refuse('exists', `There is already a ${id}.`)
          d.items[id] = label
        },
      })
    },
    LABEL_OF: async ({ id }, { ask, child }) => { const label = await ask(child('card', id), 'LABEL', {}); return label.ok ? label.value : label.failure.kind },
    SLOWLY_OF: async ({ id }, { ask, child }) => { const label = await ask(child('card', id), 'SLOWLY', {}); return label.ok ? label.value : label.failure.kind },
  },

  states: {
    open: { starts: { helper: one(helper(log), (data) => ({ title: data.title })) } },
    closed: {},
  },
})

const wired = () => {
  const log: string[] = []
  const defects: string[] = []
  const looked: string[] = []
  const sys = system({ side: 'backend', trace: (line) => { if (line.startsWith('DEFECT')) defects.push(line); if (line.includes('looked at')) looked.push(line) } })
  const it = sys.start('board', board(log))
  const steps: string[][] = []
  sys.subscribe((changed) => { steps.push([...changed].sort()) })
  const cards = (): Record<string, unknown> => Object.fromEntries(Object.entries(sys.snapshot()).filter(([ref]) => ref.startsWith('board/card/')).map(([ref, value]) => [ref.slice('board/card/'.length), (value as { data: unknown }).data]))
  return { sys, it, log, defects, looked, steps, cards, send: (event: BoardEvent): void => sys.send(it, event), now: () => sys.read(it) }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['a state it starts runs while it is the case, stops when it is left, and starts anew when it is entered again', async () => {
    const { log, send, sys } = wired()
    deepStrictEqual(log, ['started helper for Board'])
    send({ type: 'CLOSE' })
    deepStrictEqual(log, ['started helper for Board', 'stopped helper'])
    send({ type: 'OPEN' })
    deepStrictEqual(log, ['started helper for Board', 'stopped helper', 'started helper for Board'])
    sys.stop()
  }],
  ['a started state is given its data once, when it starts: a fact that changes is kept by whichever state owns it', async () => {
    const { log, send, sys } = wired()
    send({ type: 'RETITLE', title: 'Another' })
    deepStrictEqual((sys.snapshot()['board/helper'] as { data: unknown }).data, { title: 'Board' })
    send({ type: 'CLOSE' })
    send({ type: 'OPEN' })
    deepStrictEqual(log.at(-1), 'started helper for Another')
    sys.stop()
  }],
  ['a key the field gains starts its state in that step, given what the data holds for it', async () => {
    const { send, cards, steps, sys } = wired()
    steps.length = 0
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    deepStrictEqual(steps, [['board', 'board/card/a']])
    deepStrictEqual(cards(), { a: { id: 'a', label: 'Alpha', bumps: 0 } })
    sys.stop()
  }],
  ['a state started part-way through a step is there for what comes next in that step', async () => {
    const { send, cards, steps, sys } = wired()
    steps.length = 0
    send({ type: 'ADD_THEN_BUMP', id: 'a', label: 'Alpha' })
    deepStrictEqual(cards(), { a: { id: 'a', label: 'Alpha', bumps: 1 } })
    deepStrictEqual(steps, [['board', 'board/card/a']])
    sys.stop()
  }],
  ['a key the field loses stops its state: what it held is let go, and what it was answering is abandoned', async () => {
    const { send, cards, log, sys, it } = wired()
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    const slowly = sys.ask(it, 'SLOWLY_OF', { id: 'a' })
    await turns(3)
    send({ type: 'REMOVE', id: 'a' })
    deepStrictEqual(cards(), {})
    deepStrictEqual(log.filter((line) => line.endsWith(' a')), ['started a', 'stopped a'])
    deepStrictEqual(await slowly, { ok: true, value: 'abandoned' })
    sys.stop()
  }],
  ['a key that stays leaves its state as it is, whatever else changes', async () => {
    const { send, cards, log, sys } = wired()
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    send({ type: 'BUMP', id: 'a' })
    send({ type: 'BUMP', id: 'a' })
    send({ type: 'RETITLE', title: 'Another' })
    send({ type: 'ADD', id: 'b', label: 'Beta' })
    send({ type: 'CLOSE' })
    deepStrictEqual(cards(), { a: { id: 'a', label: 'Alpha', bumps: 2 }, b: { id: 'b', label: 'Beta', bumps: 0 } })
    deepStrictEqual(log.filter((line) => line.endsWith(' a')), ['started a'])
    sys.stop()
  }],
  ['which there are is looked at again only when that field changes', async () => {
    const { send, looked, sys } = wired()
    looked.length = 0
    send({ type: 'RETITLE', title: 'Another' })
    send({ type: 'RETITLE', title: 'And another' })
    deepStrictEqual(looked, [])
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    strictEqual(looked.length, 1)
    // The card changing is not the board's items changing.
    send({ type: 'BUMP', id: 'a' })
    strictEqual(looked.length, 1)
    sys.stop()
  }],
  ['a started state reports to the state that started it, which hears which one it was', async () => {
    const { send, now, sys } = wired()
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    send({ type: 'ADD', id: 'b', label: 'Beta' })
    send({ type: 'BUMP', id: 'b' })
    strictEqual(now().data.lastBump, 'b to 1')
    send({ type: 'BUMP', id: 'a' })
    send({ type: 'BUMP', id: 'a' })
    strictEqual(now().data.lastBump, 'a to 2')
    sys.stop()
  }],
  ['a state that is not running cannot be asked: the ask is answered `unavailable`', async () => {
    const { sys, it } = wired()
    deepStrictEqual(await sys.ask(it, 'LABEL_OF', { id: 'nobody' }), { ok: true, value: 'unavailable' })
    sys.stop()
  }],
  ['a key that could not name a state is reported, and starts nothing', async () => {
    const { send, cards, defects, sys } = wired()
    send({ type: 'ADD', id: 'a/b', label: 'Slashed' })
    strictEqual(defects.length, 1)
    ok(defects[0]!.includes('a key cannot hold a slash'))
    deepStrictEqual(cards(), {})
    sys.stop()
  }],
  ['stopping stops everything that was started, the last started first', async () => {
    const { send, log, sys } = wired()
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    send({ type: 'ADD', id: 'b', label: 'Beta' })
    log.length = 0
    sys.stop()
    deepStrictEqual(log, ['stopped b', 'stopped a', 'stopped helper'])
  }],
]

/** Two asks that each add the same item after work of their own. Checking and starting are one step: one card. */
const racing = (schedule: Schedule): (() => void) => {
  const log: string[] = []
  const sys = system({ side: 'backend', later: schedule.later })
  const it = sys.start('board', board(log, (label) => schedule.work(label, null)))
  const said: string[] = []
  for (const label of ['Alpha', 'Another']) void sys.ask(it, 'ADD_LATER', { id: 'a', label }).then((outcome) => { said.push(outcome.ok ? `${label} added` : `${label} ${outcome.failure.kind}`) })
  return () => {
    strictEqual(said.filter((each) => each.endsWith('added')).length, 1)
    strictEqual(said.filter((each) => each.endsWith('exists')).length, 1)
    // The card that runs is the one that was added, and it started once.
    deepStrictEqual(log.filter((line) => line.endsWith(' a')), ['started a'])
    const running = (sys.snapshot()['board/card/a'] as { data: Card['data'] }).data.label
    strictEqual(`${running} added`, said.find((each) => each.endsWith('added')))
  }
}

// What must not compile.
state<Board, BoardEvent, BoardAsks>()({
  data: { title: '', items: {}, lastBump: null },
  start: 'open',
  starts: { card: each('items', card([]), (id) => ({ id, label: '' })) },
  on: {
    // @ts-expect-error a card is one of many, so reaching one takes its key
    BUMP: (_, { tell, child }) => { tell(child('card'), { type: 'BUMP' }) },
    // @ts-expect-error there is no such state to reach
    ADD: (_, { child }) => { void child('deck') },
    // @ts-expect-error the helper is started by `open`, so only a handler inside `open` can reach it
    CLOSE: (_, { child }) => { void child('helper') },
    // @ts-expect-error the board declares nothing it reports, so it has nothing to report
    RETITLE: (_, { report }) => { report({ type: 'CARD_BUMPED', bumps: 1 }) },
  },
  states: {
    open: {
      starts: { helper: one(helper([]), () => ({ title: '' })) },
      // Inside `open` it can be reached, and there is one, so it takes no key.
      on: { OPEN: (_, { child }) => { void child('helper') } },
    },
    closed: {},
  },
})
// @ts-expect-error a state whose shape says it starts cards has to say which
state<Board, BoardEvent, BoardAsks>()({ data: { title: '', items: {}, lastBump: null }, start: 'open', states: { open: { starts: { helper: one(helper([]), () => ({ title: '' })) } }, closed: {} } })
state<Board, BoardEvent, BoardAsks>()({
  data: { title: '', items: {}, lastBump: null },
  start: 'open',
  starts: {
    // @ts-expect-error a title is neither a list nor keyed, so it cannot say which cards there are
    card: each('title', card([]), (id) => ({ id, label: '' })),
  },
  states: { open: { starts: { helper: one(helper([]), () => ({ title: '' })) } }, closed: {} },
})
state<Board, BoardEvent, BoardAsks>()({
  data: { title: '', items: {}, lastBump: null },
  start: 'open',
  starts: {
    // @ts-expect-error a card has to be given its label as well as which it is
    card: each('items', card([]), (id) => ({ id })),
  },
  states: {
    // @ts-expect-error the helper has to be given its title, so it cannot be named bare
    open: { starts: { helper: helper([]) } },
    closed: {},
  },
})

const unhandled: unknown[] = []
process.on('unhandledRejection', (reason) => { unhandled.push(reason) })

let failed = 0
for (const [name, check] of checks) {
  try { await check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n').slice(0, 8).join(' ')}`) }
}
{
  const name = 'under every ordering of two asks that add the same item after a wait, one is added, one is refused, and one card starts'
  const found = await explore(racing)
  try {
    ok(!found.failure, found.failure && `${String(found.failure.error).split('\n')[0]} after: ${found.failure.taken.join(' → ')}`)
    ok(found.complete && found.orderings > 1, `ran ${found.orderings} orderings, ${found.complete ? 'all' : 'not all'}`)
    console.log(`  ok    ${name}  (${found.orderings} orderings, all there are)`)
  } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n')[0]}`) }
}
await turns(30)
if (unhandled.length) { failed++; console.log(`  FAIL  nothing was left unhandled\n        ${String(unhandled[0])}`) } else console.log('  ok    none of it left a rejection unhandled')
console.log(`\n${checks.length + 2 - failed} of ${checks.length + 2} passed`)
if (failed) process.exitCode = 1
