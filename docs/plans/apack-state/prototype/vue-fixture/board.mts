// The states the component files in this folder read, and the `useState` typed for them. In the app a pack's
// generated facade would give both.
import { given, reaching, type Each } from '../state.mts'
import { vueBinding } from '../vue.mts'

const state = reaching()

type Card = { data: { id: string; label: string; bumps: number } }
export const card = state<Card, { type: 'BUMP' }>()({
  data: { id: given, label: given, bumps: 0 },
  on: { BUMP: (_, { data }) => ({ data: { bumps: data.bumps + 1 } }) },
})

type Board = {
  data: { title: string; items: Record<string, string> }
  starts: { card: Each<typeof card> }
  states: { list: {}; open: { data: { openId: string } } }
}
export type BoardEvent =
  | { type: 'ADD'; id: string; label: string }
  | { type: 'RETITLE'; title: string }
  | { type: 'OPEN'; id: string }
  | { type: 'CLOSE' }
export const board = state<Board, BoardEvent>()({
  data: { title: 'Board', items: {} },
  start: 'list',
  starts: (start) => ({ card: start(card, { each: 'items', given: (id, data) => ({ id, label: data.items[id]! }) }) }),
  on: {
    ADD: ({ id, label }) => ({ data: (d) => { d.items[id] = label } }),
    RETITLE: ({ title }) => ({ data: { title } }),
    OPEN: ({ id }) => ({ at: 'open', data: { openId: id } }),
    CLOSE: () => ({ at: 'list' }),
  },
  states: { list: {}, open: { data: { openId: given } } },
})

export const { provide, useState } = vueBinding<{ board: typeof board }>()
