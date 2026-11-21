// The states a state starts. They are declared, and which of them run follows from the data: nothing starts or
// stops one by hand. So starting is part of a change, in its step, and what runs cannot disagree with the data.
//
//   npx tsx docs/plans/apack-spec/prototype/starts-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { explore, type Schedule } from './schedule.mts'
import { answered, each, reaching, system, type Each } from './state.mts'

const state = reaching()
const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

// ── a card: one for each item on the board ──────────────────────────────────────────────────────────────────────────

type CardEvent = { type: 'BUMP' }
type CardAsks = { LABEL: { args: {}; answer: string }; SLOWLY: { args: {}; answer: string } }
type Card = { data: { label: string; bumps: number } }
const card = (id: string, label: string, log: string[]) => state<Card, CardEvent, CardAsks>()({
  data: { label, bumps: 0 },
  run({ use }) { log.push(`started ${id}`); use(() => { log.push(`stopped ${id}`) }) },
  on: { BUMP: (_, { data }) => ({ data: { bumps: data.bumps + 1 } }) },
  asks: {
    LABEL: (_, { data }) => data.label,
    SLOWLY: async (_, { data }) => { await turns(20); return data.label },
  },
})

/** Started by the board only while it is open. */
const helper = (log: string[]) => state<{}, never>()({
  run({ use }) { log.push('started helper'); use(() => { log.push('stopped helper') }) },
})

// ── the board ───────────────────────────────────────────────────────────────────────────────────────────────────────

type BoardEvent =
  | { type: 'ADD'; id: string; label: string }
  | { type: 'REMOVE'; id: string }
  | { type: 'RETITLE'; title: string }
  | { type: 'BUMP'; id: string }
  | { type: 'CLOSE' }
  | { type: 'OPEN' }
  | { type: 'BREAK' }
  | { type: 'ADD_THEN_BUMP'; id: string; label: string }
type BoardAsks = {
  /** Adds an item once its work is done, and refuses if one is there by then. */
  ADD_LATER: { args: { id: string; label: string }; answer: 'added'; refuses: 'exists' }
  /** Asks the card for its label, and says how that went. */
  LABEL_OF: { args: { id: string }; answer: string }
  SLOWLY_OF: { args: { id: string }; answer: string }
}
type Board = {
  data: { title: string; items: Record<string, string>; broken: boolean }
  starts: { card: Each<ReturnType<typeof card>> }
  states: { open: { starts: { helper: ReturnType<typeof helper> } }; closed: {} }
}

const board = (log: string[], work: (label: string) => Promise<unknown> = () => turns(4)) => state<Board, BoardEvent, BoardAsks>()({
  data: { title: 'Board', items: {}, broken: false },
  start: 'open',

  starts: {
    // The data says which cards there are, and a card is given its label from the data when it starts.
    card: each(
      (data) => { if (data.broken) throw new Error('the keys cannot be read'); return Object.keys(data.items) },
      (id, data) => card(id, data.items[id]!, log),
    ),
  },

  on: {
    ADD: ({ id, label }) => ({ data: (d) => { d.items[id] = label } }),
    REMOVE: ({ id }) => ({ data: (d) => { delete d.items[id] } }),
    RETITLE: ({ title }) => ({ data: { title } }),
    BUMP: ({ id }, { tell, child }) => { tell(child('card', id), { type: 'BUMP' }) },
    CLOSE: () => ({ at: 'closed' }),
    OPEN: () => ({ at: 'open' }),
    BREAK: () => ({ data: { broken: true } }),
    // Tells itself to add an item and then to bump it: two more things in the step this one is handled in.
    ADD_THEN_BUMP: ({ id, label }, { send }) => { send({ type: 'ADD', id, label }); send({ type: 'BUMP', id }) },
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
    open: { starts: { helper: helper(log) } },
    closed: {},
  },
})

const wired = () => {
  const log: string[] = []
  const traced: string[] = []
  const sys = system({ side: 'backend', trace: (line) => { if (line.startsWith('DEFECT')) traced.push(line) } })
  const it = sys.start('board', board(log))
  const steps: string[][] = []
  sys.subscribe((changed) => { steps.push([...changed].sort()) })
  const cards = (): Record<string, unknown> => Object.fromEntries(Object.entries(sys.snapshot()).filter(([ref]) => ref.startsWith('board/card/')).map(([ref, value]) => [ref.slice('board/card/'.length), (value as { data: unknown }).data]))
  return { sys, it, log, traced, steps, cards, send: (event: BoardEvent): void => sys.send(it, event) }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['a state it starts runs while it is the case, stops when it is left, and starts anew when it is entered again', async () => {
    const { log, send, sys } = wired()
    deepStrictEqual(log, ['started helper'])
    send({ type: 'CLOSE' })
    deepStrictEqual(log, ['started helper', 'stopped helper'])
    send({ type: 'OPEN' })
    deepStrictEqual(log, ['started helper', 'stopped helper', 'started helper'])
    sys.stop()
  }],
  ['a key the data gains starts its state in that step, given what the data holds for it', async () => {
    const { send, cards, steps, sys } = wired()
    steps.length = 0
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    deepStrictEqual(steps, [['board', 'board/card/a']])
    deepStrictEqual(cards(), { a: { label: 'Alpha', bumps: 0 } })
    sys.stop()
  }],
  ['a state started part-way through a step is there for what comes next in that step', async () => {
    const { send, cards, steps, sys } = wired()
    steps.length = 0
    send({ type: 'ADD_THEN_BUMP', id: 'a', label: 'Alpha' })
    deepStrictEqual(cards(), { a: { label: 'Alpha', bumps: 1 } })
    deepStrictEqual(steps, [['board', 'board/card/a']])
    sys.stop()
  }],
  ['a key the data loses stops its state: what it held is let go, and what it was answering is abandoned', async () => {
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
    deepStrictEqual(cards(), { a: { label: 'Alpha', bumps: 2 }, b: { label: 'Beta', bumps: 0 } })
    deepStrictEqual(log.filter((line) => line.endsWith(' a')), ['started a'])
    sys.stop()
  }],
  ['a state that is not running cannot be asked: the ask is answered `unavailable`', async () => {
    const { sys, it } = wired()
    deepStrictEqual(await sys.ask(it, 'LABEL_OF', { id: 'nobody' }), { ok: true, value: 'unavailable' })
    sys.stop()
  }],
  ['keys that cannot be read are reported, and what was running goes on running', async () => {
    const { send, cards, traced, log, sys } = wired()
    send({ type: 'ADD', id: 'a', label: 'Alpha' })
    send({ type: 'BREAK' })
    strictEqual(traced.length, 1)
    ok(traced[0]!.includes('could not say which card to start'))
    deepStrictEqual(Object.keys(cards()), ['a'])
    deepStrictEqual(log.filter((line) => line.endsWith(' a')), ['started a'])
    sys.stop()
  }],
  ['stopping the state stops everything it started, the last started first', async () => {
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
  data: { title: '', items: {}, broken: false },
  start: 'open',
  starts: { card: each((data) => Object.keys(data.items), (id) => card(id, '', [])) },
  on: {
    // @ts-expect-error a card is one of many, so reaching one takes its key
    BUMP: (_, { tell, child }) => { tell(child('card'), { type: 'BUMP' }) },
    // @ts-expect-error there is no such state to reach
    ADD: (_, { child }) => { void child('deck') },
    // @ts-expect-error the helper is started by `open`, so only a handler inside `open` can reach it
    CLOSE: (_, { child }) => { void child('helper') },
  },
  states: {
    open: {
      starts: { helper: helper([]) },
      // Inside `open` it can be reached, and there is one, so it takes no key.
      on: { OPEN: (_, { child }) => { void child('helper') } },
    },
    closed: {},
  },
})
// @ts-expect-error a state whose shape says it starts cards has to say which
state<Board, BoardEvent, BoardAsks>()({ data: { title: '', items: {}, broken: false }, start: 'open', states: { open: { starts: { helper: helper([]) } }, closed: {} } })

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
