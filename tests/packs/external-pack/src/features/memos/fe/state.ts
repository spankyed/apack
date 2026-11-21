import type { OpenEntity } from '@apackdev/sdk/events';
import type { Contract, MemosContext, MemosInbox } from './contract.ts';
import { setup, assign, type ActorRefFrom } from 'xstate';
import { entityIs, safeEvents } from '@apackdev/sdk/fe';
import { tell } from '#generated/events.ts';
import type { OutgoingMemosEvents } from '../be/types.ts';

export const id = 'memos' as const;

type UIEvents = { type: 'MEMOS.ADD'; text: string } | { type: 'MEMOS.ADD_NOTE'; text: string };
/** What another feature may send this surface, which `fe/surface.ts` declares as its inbox */
export type { MemosInbox } from './contract.ts';
export type MemosEvents = OpenEntity | UIEvents | MemosInbox | OutgoingMemosEvents;

const typeOf = safeEvents<MemosEvents>();

const memosState = setup({
  types: {
    context: {} as MemosContext,
    events: {} as MemosEvents,
  },
  guards: { entityIs: entityIs<Contract['opens']> },
  actions: {
    setMemos: assign({
      memos: ({ event }) => typeOf('MEMOS_CONNECTED', event).memos,
    }),
    addMemo: assign({
      memos: ({ context, event }) => {
        const memo = typeOf('MEMO_ADDED', event).memo;
        return context.memos.some(m => m.id === memo.id) ? context.memos : [...context.memos, memo];
      },
    }),
    sendAdd: ({ event }) => {
      tell('memos', { type: 'ADD_MEMO', text: typeOf('MEMOS.ADD', event).text });
    },
    addNote: assign({
      notes: ({ context, event }) => {
        const { text, note } = typeOf('MEMO_NOTE_ADDED', event);
        return [...context.notes, { text, note }];
      },
    }),
    sendAddNote: ({ event }) => {
      tell('memos', { type: 'ADD_MEMO_NOTE', text: typeOf('MEMOS.ADD_NOTE', event).text });
    },
    highlight: assign({
      highlighted: ({ event }) => typeOf('MEMO.HIGHLIGHT', event).memoId,
    }),
  },
}).createMachine({
  id,
  context: { memos: [], notes: [], highlighted: null },
  on: {
    OPEN_ENTITY: { guard: { type: 'entityIs', params: { entity: 'Memo' } }, actions: assign({ highlighted: ({ event }) => event.id }) },
    MEMOS_CONNECTED: { actions: 'setMemos' },
    MEMO_ADDED: { actions: 'addMemo' },
    'MEMOS.ADD': { actions: 'sendAdd' },
    MEMO_NOTE_ADDED: { actions: 'addNote' },
    'MEMOS.ADD_NOTE': { actions: 'sendAddNote' },
    'MEMO.HIGHLIGHT': { actions: 'highlight' },
  },
});

export type MemosState = ActorRefFrom<typeof memosState>;

export default memosState;
