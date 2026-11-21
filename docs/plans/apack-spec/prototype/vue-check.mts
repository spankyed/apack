// `useState`, checked by rendering. These are real Vue components, mounted with Vue's own runtime into a tree of
// plain objects in place of a page, so that what is counted is what Vue did: how often each component rendered.
//
//   npx tsx docs/plans/apack-spec/prototype/vue-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { createRenderer, defineComponent, h, nextTick, ref, type Component } from '@vue/runtime-core'
import { mirrors } from './mirror.mts'
import { each, given, reaching, system, type Each } from './state.mts'
import { vueBinding } from './vue.mts'

// ── what is rendered into ───────────────────────────────────────────────────────────────────────────────────────────

interface Node { type: string; text: string; children: Node[]; parent: Node | undefined }
const node = (type: string, text = ''): Node => ({ type, text, children: [], parent: undefined })
const { createApp } = createRenderer<Node, Node>({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (of, text) => { of.text = text },
  setElementText: (of, text) => { of.children = [Object.assign(node('#text', text), { parent: of })] },
  insert: (child, parent, anchor) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child)
  },
  remove: (child) => { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = undefined },
  parentNode: (of) => of.parent ?? null,
  nextSibling: (of) => { const among = of.parent?.children ?? []; return among[among.indexOf(of) + 1] ?? null },
  patchProp: () => {},
})
const shown = (of: Node): string => (of.type === '#text' ? of.text : of.type === '#comment' ? '' : of.children.map(shown).join(of.type === 'ul' ? ' | ' : ''))

// ── the states ──────────────────────────────────────────────────────────────────────────────────────────────────────

const state = reaching()
type Card = { data: { id: string; label: string; bumps: number } }
const card = state<Card, { type: 'BUMP' }>()({
  data: { id: given, label: given, bumps: 0 },
  on: { BUMP: (_, { data }) => ({ data: { bumps: data.bumps + 1 } }) },
})
type Board = {
  data: { title: string; items: Record<string, string>; told: number }
  starts: { card: Each<typeof card> }
  states: { open: {}; closed: {} }
}
type BoardEvent =
  | { type: 'ADD'; id: string; label: string }
  | { type: 'REMOVE'; id: string }
  | { type: 'BUMP'; id: string }
  | { type: 'RETITLE'; title: string }
  | { type: 'CLOSE' }
const board = state<Board, BoardEvent>()({
  data: { title: 'Board', items: {}, told: 0 },
  start: 'open',
  starts: { card: each('items', card, (id, data) => ({ id, label: data.items[id]! })) },
  on: {
    ADD: ({ id, label }) => ({ data: (d) => { d.items[id] = label } }),
    REMOVE: ({ id }) => ({ data: (d) => { delete d.items[id] } }),
    // Tells the card and counts that it did, in one step: the two numbers are never apart once it has committed.
    BUMP: ({ id }, { data, tell, child }) => { tell(child('card', id), { type: 'BUMP' }); return { data: { told: data.told + 1 } } },
    RETITLE: ({ title }) => ({ data: { title } }),
    CLOSE: () => ({ at: 'closed' }),
  },
  states: { open: {}, closed: {} },
})

const { provide, useState } = vueBinding<{ board: typeof board }>()

// ── the components ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A board on a page: the components, how often each rendered, and what each saw. */
const mounted = (parts: Array<'title' | 'where' | 'list' | 'pair' | 'picked'> = ['title', 'where', 'list']) => {
  const sys = system({ side: 'window' })
  const handle = sys.start('board', board)
  const send = (event: BoardEvent): void => sys.send(handle, event)
  send({ type: 'ADD', id: 'a', label: 'Alpha' })
  send({ type: 'ADD', id: 'b', label: 'Beta' })

  const renders: Record<string, number> = {}
  const rendered = (name: string): void => { renders[name] = (renders[name] ?? 0) + 1 }
  /** Every card component that rendered while its card was not running. */
  const sawNothing: string[] = []
  /** What `Pair` saw at each render: how often the board told card a, and how often card a was bumped. */
  const pairs: Array<[number, number | undefined]> = []
  const picked = ref('a')

  const Title = defineComponent(() => { const it = useState('board'); return () => { rendered('title'); return h('h1', it.state.value.data.title) } })
  const Where = defineComponent(() => { const it = useState('board'); return () => { rendered('where'); return h('p', it.state.value.at) } })
  const CardView = defineComponent({
    props: { id: { type: String, required: true } },
    setup(props) {
      const it = useState('board')
      // One of many, by the prop: when the prop changes, this reads the other card.
      const one = useState(() => it.child('card', props.id))
      return () => {
        rendered(`card ${props.id}`)
        const now = one.state.value
        if (!now) { sawNothing.push(props.id); return h('li', 'nothing') }
        return h('li', `${now.data.label} ${now.data.bumps}`)
      }
    },
  })
  const List = defineComponent(() => {
    const it = useState('board')
    return () => { rendered('list'); return h('ul', Object.keys(it.state.value.data.items).map((id) => h(CardView, { id, key: id }))) }
  })
  const Pair = defineComponent(() => {
    const it = useState('board')
    const a = useState(() => it.child('card', 'a'))
    return () => { rendered('pair'); pairs.push([it.state.value.data.told, a.state.value?.data.bumps]); return h('p', `${it.state.value.data.told}`) }
  })
  const Picked = defineComponent(() => () => h(CardView, { id: picked.value }))
  const all: Record<string, Component> = { title: Title, where: Where, list: List, pair: Pair, picked: Picked }

  const page = node('page')
  const app = createApp(defineComponent(() => () => parts.map((part) => h(all[part]!))))
  provide(app, sys)
  app.mount(page)
  const since: Record<string, number> = { ...renders }
  /** Which components rendered since this was last asked, once Vue has done what it had waiting. */
  const ran = async (): Promise<string[]> => {
    await nextTick()
    const names = Object.keys(renders).filter((name) => renders[name] !== since[name]).sort()
    Object.assign(since, renders)
    return names
  }
  return { sys, send, ran, renders, page, picked, sawNothing, pairs, shows: (): string => shown(page), unmount: (): void => app.unmount(), mirrored: (): number => mirrors(sys).size }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['it renders what the state holds', async () => {
    const it = mounted()
    strictEqual(it.shows(), 'BoardopenAlpha 0 | Beta 0')
    it.unmount()
  }],
  ['a change renders only the components that read the place that changed', async () => {
    const it = mounted()
    it.send({ type: 'RETITLE', title: 'Another' })
    deepStrictEqual(await it.ran(), ['title'])
    it.send({ type: 'CLOSE' })
    deepStrictEqual(await it.ran(), ['where'])
    strictEqual(it.shows(), 'AnotherclosedAlpha 0 | Beta 0')
    it.unmount()
  }],
  ['a change in one of many renders that one, and neither the others nor the list', async () => {
    const it = mounted()
    it.send({ type: 'BUMP', id: 'b' })
    deepStrictEqual(await it.ran(), ['card b'])
    strictEqual(it.shows(), 'BoardopenAlpha 0 | Beta 1')
    it.unmount()
  }],
  ['one added renders the list and the new one, and not the ones that were there', async () => {
    const it = mounted()
    it.send({ type: 'ADD', id: 'c', label: 'Gamma' })
    deepStrictEqual(await it.ran(), ['card c', 'list'])
    strictEqual(it.shows(), 'BoardopenAlpha 0 | Beta 0 | Gamma 0')
    deepStrictEqual(it.sawNothing, [])
    it.unmount()
  }],
  ['one removed is gone without its component ever rendering with nothing to show', async () => {
    const it = mounted()
    it.send({ type: 'REMOVE', id: 'a' })
    deepStrictEqual(await it.ran(), ['list'])
    strictEqual(it.shows(), 'BoardopenBeta 0')
    deepStrictEqual(it.sawNothing, [])
    it.unmount()
  }],
  ['many changes before Vue renders are one render of each component they touch', async () => {
    const it = mounted()
    for (let bump = 0; bump < 50; bump++) it.send({ type: 'BUMP', id: 'a' })
    it.send({ type: 'RETITLE', title: 'One' })
    it.send({ type: 'RETITLE', title: 'Two' })
    const before = { ...it.renders }
    deepStrictEqual(await it.ran(), ['card a', 'title'])
    strictEqual(it.renders['card a'], before['card a']! + 1)
    strictEqual(it.renders.title, before.title! + 1)
    strictEqual(it.shows(), 'TwoopenAlpha 50 | Beta 0')
    it.unmount()
  }],
  ['a component reading two states never sees one ahead of the other', async () => {
    const it = mounted(['pair'])
    for (let round = 0; round < 5; round++) { it.send({ type: 'BUMP', id: 'a' }); await it.ran() }
    it.send({ type: 'BUMP', id: 'a' })
    it.send({ type: 'BUMP', id: 'a' })
    await it.ran()
    ok(it.pairs.length >= 7, `it rendered ${it.pairs.length} times`)
    for (const [told, bumps] of it.pairs) strictEqual(told, bumps)
    // And a step that changed both was one render, not one for each.
    strictEqual(it.pairs.length, 7)
    it.unmount()
  }],
  ['a handle that follows a prop reads the other state when the prop changes', async () => {
    const it = mounted(['picked'])
    it.send({ type: 'BUMP', id: 'b' })
    await it.ran()
    strictEqual(it.shows(), 'Alpha 0')
    it.picked.value = 'b'
    await it.ran()
    strictEqual(it.shows(), 'Beta 1')
    // The card it left is no longer mirrored: only the board and the card it reads now.
    strictEqual(it.mirrored(), 2)
    it.send({ type: 'BUMP', id: 'a' })
    deepStrictEqual(await it.ran(), [])
    it.unmount()
  }],
  ['one that is not running renders as nothing, and renders again when it starts', async () => {
    const it = mounted(['picked'])
    it.picked.value = 'z'
    await it.ran()
    strictEqual(it.shows(), 'nothing')
    it.send({ type: 'ADD', id: 'z', label: 'Zed' })
    deepStrictEqual(await it.ran(), ['card z'])
    strictEqual(it.shows(), 'Zed 0')
    it.unmount()
  }],
  ['with three hundred of them, a change in one still renders one', async () => {
    const it = mounted(['list'])
    for (let index = 0; index < 300; index++) it.send({ type: 'ADD', id: `n${index}`, label: `N${index}` })
    await it.ran()
    it.send({ type: 'BUMP', id: 'n170' })
    deepStrictEqual(await it.ran(), ['card n170'])
    it.send({ type: 'REMOVE', id: 'n20' })
    deepStrictEqual(await it.ran(), ['list'])
    it.send({ type: 'ADD', id: 'last', label: 'Last' })
    deepStrictEqual(await it.ran(), ['card last', 'list'])
    // The board, and a card for each of them: one mirror each, however many components there are.
    strictEqual(it.mirrored(), 1 + 2 + 300)
    it.unmount()
    strictEqual(it.mirrored(), 0)
  }],
  ['a state is mirrored once however many components read it, and not at all once none does', async () => {
    const it = mounted(['title', 'where', 'list', 'pair'])
    // The board is read by four components and each card component, card a by two: three mirrors in all.
    strictEqual(it.mirrored(), 3)
    it.unmount()
    strictEqual(it.mirrored(), 0)
    // With nobody reading, a change mirrors nothing.
    it.send({ type: 'BUMP', id: 'a' })
    it.send({ type: 'ADD', id: 'c', label: 'Gamma' })
    strictEqual(it.mirrored(), 0)
  }],
]

// What must not compile.
defineComponent(() => {
  const it = useState('board')
  // @ts-expect-error the window runs no such state
  useState('deck')
  // @ts-expect-error the board takes no such event
  it.send({ type: 'SHUFFLE' })
  // @ts-expect-error a card is one of many, so reaching one takes its key
  it.child('card')
  const one = useState(() => it.child('card', 'a'))
  // @ts-expect-error a card may not be running, so what it holds cannot be read without saying what if it is not
  void one.state.value.data.bumps
  void one.state.value?.data.bumps
  // @ts-expect-error a component sends; it does not ask
  void it.ask
  return () => null
})

let failed = 0
for (const [name, check] of checks) {
  try { await check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n').slice(0, 8).join(' ')}`) }
}
console.log(`\n${checks.length - failed} of ${checks.length} passed`)
if (failed) process.exitCode = 1
