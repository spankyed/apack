import type { OpenEntity } from '@apackdev/sdk/events';
import { entityIs } from '@apackdev/sdk/fe';
import { state } from '#generated/state.ts';
import type { Contract, MemosContext, MemosInbox } from './contract.ts';
import type { OutgoingMemosEvents } from '../be/types.ts';

export const id = 'memos' as const;

type UIEvents = { type: 'MEMOS.ADD'; text: string } | { type: 'MEMOS.ADD_NOTE'; text: string };
/** What another feature may send this surface, which `fe/surface.ts` declares as its inbox */
export type { MemosInbox } from './contract.ts';
export type MemosEvents = OpenEntity | UIEvents | MemosInbox | OutgoingMemosEvents;

const isMemoEntity = entityIs<Contract['opens']>;

const memosState = state<{ data: MemosContext }, MemosEvents>()({
  data: { memos: [], notes: [], highlighted: null },
  on: {
    OPEN_ENTITY: (event) => {
      if (!isMemoEntity({ event }, { entity: 'Memo' })) return;
      return { data: { highlighted: event.id } };
    },
    MEMOS_CONNECTED: (event) => ({
      data: { memos: event.memos },
    }),
    MEMO_ADDED: (event, { data }) => ({
      data: {
        memos: data.memos.some(m => m.id === event.memo.id) ? data.memos : [...data.memos, event.memo],
      },
    }),
    'MEMOS.ADD': (event, { tell }) => {
      tell('memos', { type: 'ADD_MEMO', text: event.text });
    },
    MEMO_NOTE_ADDED: (event, { data }) => ({
      data: {
        notes: [...data.notes, { text: event.text, note: event.note }],
      },
    }),
    'MEMOS.ADD_NOTE': (event, { tell }) => {
      tell('memos', { type: 'ADD_MEMO_NOTE', text: event.text });
    },
    'MEMO.HIGHLIGHT': (event) => ({
      data: { highlighted: event.memoId },
    }),
  },
});

export default memosState;
