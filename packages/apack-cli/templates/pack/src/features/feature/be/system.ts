import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
// broadcast is typed with the events each of this pack's surfaces receives
import { broadcast } from '#generated/events.ts';
import type { Contract } from './contract.ts';

export const __CAMEL__Spec = defineSystem<Contract>();

export const __CAMEL__System = setup({
  types: __CAMEL__Spec.types,
  // Each handler is handed `reply` — the answer for the message it is handling, absent when that message
  // named no sender. A handler that answers an ask uses it; one that publishes, like this, does not.
  actions: __CAMEL__Spec.actions({
    sendConnectedData: () => {
      broadcast('__NAME__', {
        type: '__CONNECTED_EVENT__',
        data: {},
      });
    },
  }),
}).createMachine({
  id: '__NAME__',
  initial: 'idle',
  states: {
    idle: {
      on: {
        // The app asks every system for its state whenever anything could have changed it — a client
        // connected, a pack changed, the data was replaced. Answer with what your surface starts from, and
        // you are correct for every one of those without handling any of them
        SEND_STATE: { actions: 'sendConnectedData' },
        // A contract's `incoming` says what may be sent; the bus routes an event to a system only if its
        // machine names it, so an event declared and never handled here is dropped
        __REFRESH_EVENT__: { actions: 'sendConnectedData' },
      },
    },
  },
});

// The manifest loads this default export. Nothing to annotate: the events come from the contract above, and the
// generated pack entry checks that this spec was built from the one apack.json names.
export default { spec: __CAMEL__Spec, machine: __CAMEL__System };
