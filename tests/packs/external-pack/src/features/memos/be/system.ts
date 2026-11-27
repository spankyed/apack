import type { Contract } from './contract.ts';
import { broadcast } from '#generated/events.ts';
import { state } from '#generated/state.ts';
import type { IncomingOnlyEventsOf } from '@apackdev/sdk/events';
import type { HostLifecycleEvents, StateMatchesContract } from '@apackdev/sdk/framework';

import { repository } from '#generated/repository.ts';
import { addMemoNote } from './memo-notes.ts';

type MemosEvent =
  | IncomingOnlyEventsOf<Contract>
  | Extract<HostLifecycleEvents, { type: 'SEND_STATE' }>;

export const memosSystem = state<{}, MemosEvent>()({
  on: {
    SEND_STATE: () => {
      broadcast('memos', { type: 'MEMOS_CONNECTED', memos: repository.memoQueries.all() });
    },
    ADD_MEMO: ({ text }) => {
      broadcast('memos', { type: 'MEMO_ADDED', memo: repository.memoCommands.add(text) });
    },
    // A send to a dependency's surface, named as code names another pack's feature; that surface declares it takes it
    ANNOUNCE_MEMO: ({ text }) => {
      broadcast('default-setup/logs', {
        type: 'LOG_ADDED',
        log: { id: `memo-${Date.now()}`, timestamp: Date.now(), level: 'info', message: text, source: 'memos' },
      });
    },
    ADD_MEMO_NOTE: ({ text }) => {
      broadcast('memos', { type: 'MEMO_NOTE_ADDED', text, note: addMemoNote(text) });
    },
  },
});

const _contractMatches: StateMatchesContract<typeof memosSystem, Contract> = true;
void _contractMatches;

export default memosSystem;
