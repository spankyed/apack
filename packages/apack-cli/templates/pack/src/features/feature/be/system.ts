import { state } from '#generated/state.ts';
// broadcast is typed with the events each of this pack's surfaces receives
import { broadcast } from '#generated/events.ts';
import type { IncomingOnlyEventsOf } from '@apackdev/sdk/events';
import type { HostLifecycleEvents, StateMatchesContract } from '@apackdev/sdk/framework';
import type { Contract } from './contract.ts';

type __PASCAL__Event =
  | IncomingOnlyEventsOf<Contract>
  | Extract<HostLifecycleEvents, { type: 'SEND_STATE' }>;

function sendConnectedData() {
  broadcast('__NAME__', {
    type: '__CONNECTED_EVENT__',
    data: {},
  });
}

export const __CAMEL__System = state<{}, __PASCAL__Event>()({
  on: {
    // The app asks every system for its state whenever anything could have changed it — a client
    // connected, a pack changed, the data was replaced. Answer with what your surface starts from, and
    // you are correct for every one of those without handling any of them
    SEND_STATE: () => {
      sendConnectedData();
    },
    // A contract's `incoming` says what may be sent; the bus routes an event to a system only if its
    // state handles it, so an event declared and never handled here is ignored
    __REFRESH_EVENT__: () => {
      sendConnectedData();
    },
  },
});

const _contractMatches: StateMatchesContract<typeof __CAMEL__System, Contract> = true;
void _contractMatches;

// The manifest loads this default export. Nothing to annotate: the events come from the contract above, and the
// generated pack entry checks that this state matches the contract apack.json names.
export default __CAMEL__System;
