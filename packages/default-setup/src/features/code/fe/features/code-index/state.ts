// The code index, as this surface asks it things: where a symbol is, and what the staged change did per definition.
// Each holds its latest ask, so an answer to one the user has since replaced is dropped. What the index holds and how
// far along it is are views, which the components read themselves (`SymbolSearch.vue`).
import { assign, enqueueActions, setup, type ActorRefFrom, type AnyActorRef } from 'xstate';
import { answersCall, newCall } from '@apackdev/sdk/events';
import { sendToSystem } from '#generated/events.ts';
import type { SemanticDiff } from '../../../be/code-index/semantic-diff.ts';
import { codeChild } from '../children.ts';
import { updateParentState } from '../../utils/parent-communication.ts';

export interface CodeIndexContext {
  locating: string | null
  diffAsk: string | null
  diff: SemanticDiff | null
  diffError: string | null
}

export type Event =
  | { type: 'codeIndex.TOGGLE'; enabled: boolean }
  | { type: 'codeIndex.OPEN_SYMBOL'; symbol: string }
  | { type: 'codeIndex.LOCATED'; data: { path: string; line: number; column: number } | null }
  | { type: 'codeIndex.LOAD_STAGED_DIFF' }
  | { type: 'codeIndex.SEMANTIC_DIFF_READY'; data: SemanticDiff }
  | { type: 'codeIndex.SEMANTIC_DIFF_FAILED'; data: { message: string } };

export const codeIndexState = setup({
  types: {
    context: {} as CodeIndexContext,
    events: {} as Event,
  },
  actions: {
    toggle: ({ event }) => {
      const { enabled } = event as Extract<Event, { type: 'codeIndex.TOGGLE' }>;
      sendToSystem('code', { type: 'codeIndex.SET_ENABLED', enabled });
    },
    // `enqueueActions`, so the ask is recorded before it is sent and an answer in the same turn finds it
    openSymbol: enqueueActions(({ event, enqueue }) => {
      const { symbol } = event as Extract<Event, { type: 'codeIndex.OPEN_SYMBOL' }>;
      const call = newCall();
      enqueue.assign({ locating: call });
      enqueue(() => sendToSystem('code', { type: 'codeIndex.LOCATE', symbol }, { call }));
    }),
    reveal: ({ event, self }) => {
      const { data } = event as Extract<Event, { type: 'codeIndex.LOCATED' }>;
      if (!data) return;
      const code = (self as unknown as { _parent: AnyActorRef })._parent;
      codeChild(code, 'explorer')?.send({ type: 'explorer.OPEN_FILE', path: data.path });
      updateParentState(self, { pendingRevealLine: { filePath: data.path, line: data.line, column: data.column } });
    },
    loadStagedDiff: enqueueActions(({ enqueue }) => {
      const call = newCall();
      enqueue.assign({ diffAsk: call, diffError: null });
      enqueue(() => sendToSystem('code', { type: 'codeIndex.SEMANTIC_DIFF', range: { staged: true } }, { call }));
    }),
  },
}).createMachine({
  id: 'codeIndex',
  context: { locating: null, diffAsk: null, diff: null, diffError: null },
  on: {
    'codeIndex.TOGGLE': { actions: 'toggle' },
    'codeIndex.OPEN_SYMBOL': { actions: 'openSymbol' },
    'codeIndex.LOCATED': {
      guard: ({ context, event }) => answersCall(event, context.locating),
      actions: [assign({ locating: null }), 'reveal'],
    },
    'codeIndex.LOAD_STAGED_DIFF': { actions: 'loadStagedDiff' },
    'codeIndex.SEMANTIC_DIFF_READY': {
      guard: ({ context, event }) => answersCall(event, context.diffAsk),
      actions: assign({ diffAsk: null, diff: ({ event }) => event.data }),
    },
    'codeIndex.SEMANTIC_DIFF_FAILED': {
      guard: ({ context, event }) => answersCall(event, context.diffAsk),
      actions: assign({ diffAsk: null, diffError: ({ event }) => event.data.message }),
    },
  },
});

export type CodeIndexActor = ActorRefFrom<typeof codeIndexState>;
