// The views a state follows. They are declared, and which are followed, and what each is asked for, come from the
// data: nothing follows or stops following one by hand. What a view delivers goes to a handler.
//
//   npx tsx docs/plans/apack-spec/prototype/follows-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { reaching, system, type ViewHost, type ViewUpdate } from './state.mts'

type App = {
  systems: {}
  surfaces: {}
  views: {
    shop: {
      total: { args: { currency: string }; result: number }
      price: { args: { id: string }; result: number }
    }
  }
}
const state = reaching<App>()

type ShopEvent =
  | { type: 'SET_CURRENCY'; currency: string }
  | { type: 'SET_NOTE'; note: string }
  | { type: 'WATCH'; ids: string[] }
  | { type: 'GO_AWAY' }
  | { type: 'COME_BACK' }
type Shop = {
  data: { currency: string; total: number | null; watching: string[]; prices: Record<string, number>; note: string; problem: string | null }
  states: { browsing: {}; away: {} }
}

const shop = state<Shop, ShopEvent>()({
  data: { currency: 'EUR', total: null, watching: [], prices: {}, note: '', problem: null },
  start: 'browsing',

  follows: (follow) => ({
    // Asked for the currency the data holds. A change of currency follows it again; a change of anything else does not.
    total: follow('shop', 'total', {
      from: ['currency'],
      args: ({ currency }) => ({ currency }),
      heard: (update) => (update.ok ? { data: { total: update.value } } : { data: { problem: update.error } }),
    }),
    // One for each item being watched.
    price: follow('shop', 'price', {
      each: 'watching',
      args: (id) => ({ id }),
      heard: (update, { key }) => {
        if (!update.ok) return { data: { problem: `${key}: ${update.error}` } }
        if (update.value < 0) throw new Error('a price below nothing')
        return { data: (d) => { d.prices[key] = update.value } }
      },
    }),
  }),

  on: {
    SET_CURRENCY: ({ currency }) => ({ data: { currency } }),
    SET_NOTE: ({ note }) => ({ data: { note } }),
    WATCH: ({ ids }) => ({ data: { watching: ids } }),
    GO_AWAY: () => ({ at: 'away' }),
    COME_BACK: () => ({ at: 'browsing' }),
  },

  states: {
    browsing: {},
    away: {
      follows: (follow) => ({
        // What it hears changes the note, and the note is what it asks for: it would follow itself round for good.
        echo: follow('shop', 'total', {
          from: ['note'],
          args: ({ note }) => ({ currency: note }),
          heard: (update) => (update.ok ? { data: { note: `heard ${update.value}` } } : undefined),
        }),
      }),
    },
  },
})

// ── two views, each asked for what the other delivers ───────────────────────────────────────────────────────────────

type PairEvent = { type: 'SET_LEFT'; currency: string }
type Pair = { data: { left: string; right: string } }
const pair = state<Pair, PairEvent>()({
  data: { left: 'EUR', right: 'USD' },
  on: { SET_LEFT: ({ currency }) => ({ data: { left: currency } }) },
  follows: (follow) => ({
    // What `left` delivers says what `right` is asked for. One view leading another is how a list leads a detail.
    left: follow('shop', 'total', {
      from: ['left'],
      args: ({ left }) => ({ currency: left }),
      heard: (update) => (update.ok ? { data: { right: `R${update.value}` } } : undefined),
    }),
    // And what `right` delivers says what `left` is asked for, which closes the circle.
    right: follow('shop', 'total', {
      from: ['right'],
      args: ({ right }) => ({ currency: right }),
      heard: (update) => (update.ok ? { data: { left: `L${update.value}` } } : undefined),
    }),
  }),
})

/** Stands in for the view host: says what is followed, and delivers what a check tells it to. */
const wired = (which: 'shop' | 'pair' = 'shop') => {
  const calls: string[] = []
  const everFollowed = new Map<string, (update: ViewUpdate<unknown>) => void>()
  const following = new Set<string>()
  const views: ViewHost = (_feature, view, args, heard) => {
    const id = `${view}${JSON.stringify(args)}`
    everFollowed.set(id, heard)
    following.add(id)
    calls.push(`follow ${id}`)
    return () => { following.delete(id); calls.push(`stop ${id}`) }
  }
  const defects: string[] = []
  const looked: string[] = []
  const sys = system({ side: 'window', views, trace: (line) => { if (line.startsWith('DEFECT')) defects.push(line); if (line.includes('looked at')) looked.push(line) } })
  const it = sys.start('shop', shop)
  const pairOf = which === 'pair' ? sys.start('pair', pair) : undefined
  return {
    setLeft: (currency: string): void => sys.send(pairOf!, { type: 'SET_LEFT', currency }),
    pair: () => sys.read(pairOf!).data,
    sys, calls, defects, looked,
    following: (): string[] => [...following].sort(),
    send: (event: ShopEvent): void => sys.send(it, event),
    data: () => sys.read(it).data,
    /** Delivers to whatever followed under this id, whether or not it still does. */
    deliver: (id: string, update: ViewUpdate<unknown>): void => everFollowed.get(id)!(update),
  }
}
const eur = 'total{"currency":"EUR"}'
const usd = 'total{"currency":"USD"}'

const checks: Array<[string, () => void]> = [
  ['a view is followed from the moment its state is the case, asked for what the data holds', () => {
    const { following, sys } = wired()
    deepStrictEqual(following(), [eur])
    sys.stop()
  }],
  ['what a view delivers goes to its handler, which changes the data', () => {
    const { deliver, data, sys } = wired()
    deliver(eur, { ok: true, value: 12 })
    strictEqual(data().total, 12)
    deliver(eur, { ok: false, error: 'no such currency' })
    strictEqual(data().problem, 'no such currency')
    sys.stop()
  }],
  ['a change to what it asks for follows it again, and stops the one before', () => {
    const { send, calls, following, sys } = wired()
    send({ type: 'SET_CURRENCY', currency: 'USD' })
    deepStrictEqual(calls, [`follow ${eur}`, `stop ${eur}`, `follow ${usd}`])
    deepStrictEqual(following(), [usd])
    sys.stop()
  }],
  ['what the one before delivers afterwards is not heard', () => {
    const { send, deliver, data, sys } = wired()
    send({ type: 'SET_CURRENCY', currency: 'USD' })
    deliver(eur, { ok: true, value: 99 })
    strictEqual(data().total, null)
    deliver(usd, { ok: true, value: 14 })
    strictEqual(data().total, 14)
    sys.stop()
  }],
  ['a change to anything else leaves it followed as it is', () => {
    const { send, calls, deliver, sys } = wired()
    send({ type: 'SET_NOTE', note: 'a note' })
    send({ type: 'WATCH', ids: ['a'] })
    deliver(eur, { ok: true, value: 12 })
    deepStrictEqual(calls.filter((call) => call.includes('total')), [`follow ${eur}`])
    sys.stop()
  }],
  ['one is followed for each item of a list, and stops when its item goes', () => {
    const { send, calls, following, sys } = wired()
    send({ type: 'WATCH', ids: ['a', 'b'] })
    deepStrictEqual(following(), ['price{"id":"a"}', 'price{"id":"b"}', eur])
    send({ type: 'WATCH', ids: ['b', 'c'] })
    deepStrictEqual(following(), ['price{"id":"b"}', 'price{"id":"c"}', eur])
    // The one that stayed was not followed again.
    deepStrictEqual(calls.filter((call) => call.includes('"b"')), ['follow price{"id":"b"}'])
    sys.stop()
  }],
  ['which there are is looked at again only when that list changes', () => {
    const { send, deliver, looked, sys } = wired()
    looked.length = 0
    send({ type: 'SET_NOTE', note: 'a note' })
    send({ type: 'SET_CURRENCY', currency: 'USD' })
    deliver(usd, { ok: true, value: 3 })
    deepStrictEqual(looked, [])
    send({ type: 'WATCH', ids: ['a'] })
    strictEqual(looked.length, 1)
    sys.stop()
  }],
  ['each of many hears with its own key', () => {
    const { send, deliver, data, sys } = wired()
    send({ type: 'WATCH', ids: ['a', 'b'] })
    deliver('price{"id":"b"}', { ok: true, value: 5 })
    deliver('price{"id":"a"}', { ok: true, value: 3 })
    deepStrictEqual(data().prices, { a: 3, b: 5 })
    sys.stop()
  }],
  ['a handler that throws changes nothing and is reported, and the view goes on being followed', () => {
    const { send, deliver, data, defects, following, sys } = wired()
    send({ type: 'WATCH', ids: ['a'] })
    deliver('price{"id":"a"}', { ok: true, value: -1 })
    deepStrictEqual(data().prices, {})
    strictEqual(defects.length, 1)
    ok(defects[0]!.includes('threw hearing price/a'))
    deliver('price{"id":"a"}', { ok: true, value: 4 })
    deepStrictEqual(data().prices, { a: 4 })
    ok(following().includes('price{"id":"a"}'))
    sys.stop()
  }],
  ['a view declared by a state inside is followed only while that state is the case', () => {
    const { send, following, sys } = wired()
    send({ type: 'SET_NOTE', note: 'GBP' })
    send({ type: 'GO_AWAY' })
    deepStrictEqual(following(), [eur, 'total{"currency":"GBP"}'])
    send({ type: 'COME_BACK' })
    deepStrictEqual(following(), [eur])
    sys.stop()
  }],
  ['what a view delivers may not change what that view is asked for: it is reported, and goes on as it was', () => {
    const { send, deliver, data, defects, calls, following, sys } = wired()
    send({ type: 'SET_NOTE', note: 'GBP' })
    send({ type: 'GO_AWAY' })
    calls.length = 0
    deliver('total{"currency":"GBP"}', { ok: true, value: 7 })
    // The handler's change is made: it is the following again that is refused.
    strictEqual(data().note, 'heard 7')
    strictEqual(defects.length, 1)
    ok(defects[0]!.includes('shop#echo delivered changed a field it is itself asked from'))
    deepStrictEqual(calls, [])
    deepStrictEqual(following(), [eur, 'total{"currency":"GBP"}'])
    sys.stop()
  }],
  ['one view may lead another: what the first delivers changes what the second is asked for', () => {
    const { deliver, following, defects, pair: now, sys } = wired('pair')
    deliver('total{"currency":"EUR"}', { ok: true, value: 1 })
    deepStrictEqual(now(), { left: 'EUR', right: 'R1' })
    ok(following().includes('total{"currency":"R1"}'))
    deepStrictEqual(defects, [])
    sys.stop()
  }],
  ['but not round in a circle: where it closes, the view goes on as it was, and it is reported', () => {
    const { deliver, following, defects, calls, pair: now, sys } = wired('pair')
    deliver('total{"currency":"EUR"}', { ok: true, value: 1 })
    calls.length = 0
    deliver('total{"currency":"R1"}', { ok: true, value: 2 })
    // The handler's change is made. Following `left` again, which is what led here, is what is refused.
    deepStrictEqual(now(), { left: 'L2', right: 'R1' })
    deepStrictEqual(calls, [])
    ok(following().includes('total{"currency":"EUR"}') && !following().includes('total{"currency":"L2"}'))
    strictEqual(defects.length, 1)
    ok(defects[0]!.includes('pair#left is what led to pair#right being asked'))
    sys.stop()
  }],
  ['a change from anywhere else follows a view again as before, and it leads the other again', () => {
    const { deliver, following, defects, setLeft, sys } = wired('pair')
    deliver('total{"currency":"EUR"}', { ok: true, value: 1 })
    setLeft('GBP')
    ok(following().includes('total{"currency":"GBP"}'))
    deliver('total{"currency":"GBP"}', { ok: true, value: 3 })
    ok(following().includes('total{"currency":"R3"}'))
    deepStrictEqual(defects, [])
    sys.stop()
  }],
  ['stopping the state stops everything it followed', () => {
    const { send, following, sys } = wired()
    send({ type: 'WATCH', ids: ['a', 'b'] })
    sys.stop()
    deepStrictEqual(following(), [])
  }],
]

// What must not compile.
state<Shop, ShopEvent>()({
  data: { currency: '', total: null, watching: [], prices: {}, note: '', problem: null },
  start: 'browsing',
  follows: (follow) => ({
    // @ts-expect-error there is no such view
    stock: follow('shop', 'stock', { from: [], args: () => ({}), heard: () => {} }),
    // @ts-expect-error the total is asked for a currency, not an id
    total: follow('shop', 'total', { from: ['currency'], args: ({ currency }) => ({ id: currency }), heard: () => {} }),
    // @ts-expect-error a currency is neither a list nor keyed, so it cannot say which prices to follow
    price: follow('shop', 'price', { each: 'currency', args: (id) => ({ id }), heard: () => {} }),
    // @ts-expect-error it reads the note, which it did not name: a field it does not name is not there to read
    noted: follow('shop', 'total', { from: ['currency'], args: ({ note }) => ({ currency: note }), heard: () => {} }),
    // @ts-expect-error the shop has no such field to read from
    missing: follow('shop', 'total', { from: ['locale'], args: () => ({ currency: '' }), heard: () => {} }),
  }),
  states: { browsing: {}, away: {} },
})
state<Shop, ShopEvent>()({
  data: { currency: '', total: null, watching: [], prices: {}, note: '', problem: null },
  start: 'browsing',
  follows: (follow) => ({
    // @ts-expect-error a price is a number, so it cannot be put where the note goes
    price: follow('shop', 'price', { each: 'watching', args: (id) => ({ id }), heard: (update) => (update.ok ? { data: { note: update.value } } : undefined) }),
  }),
  states: { browsing: {}, away: {} },
})

let failed = 0
for (const [name, check] of checks) {
  try { check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n').slice(0, 8).join(' ')}`) }
}
console.log(`\n${checks.length - failed} of ${checks.length} passed`)
if (failed) process.exitCode = 1
