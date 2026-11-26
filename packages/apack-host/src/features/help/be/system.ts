import type { IncomingOnlyEventsOf } from '@apackdev/sdk/events';
import { getPackHelp, onPackCatalogChanged } from '@apackdev/sdk/framework';
import { hostState } from '../../../state.ts';

import type { HelpOutgoing } from '../../event-contracts.ts';

export type Contract = {
  context: Record<string, never>;
  incoming: { type: 'GET_HELP' } | { type: 'CLIENT_CONNECTED' };
  internal: { type: 'CATALOG_CHANGED' };
  outgoing: HelpOutgoing;
};

type HelpShape = {
  internal: { type: 'CATALOG_CHANGED' };
};

export const helpSystem = hostState<
  HelpShape,
  IncomingOnlyEventsOf<Contract>,
  {}
>()({
  run: ({ send, signal, onExit }) => new Promise<void>((resolve) => {
    // Keep `run` active until state exit so `send` stays alive for catalog change callbacks.
    onExit(onPackCatalogChanged(() => send({ type: 'CATALOG_CHANGED' })));
    signal.addEventListener('abort', () => resolve(), { once: true });
  }),
  failed: () => {},
  on: {
    GET_HELP: (_event, { broadcast }) => {
      broadcast('settings', { type: 'HELP_CATALOG', catalog: getPackHelp() });
    },
    CLIENT_CONNECTED: (_event, { broadcast }) => {
      broadcast('settings', { type: 'HELP_CATALOG', catalog: getPackHelp() });
    },
  },
  internal: {
    CATALOG_CHANGED: (_event, { broadcast }) => {
      broadcast('settings', { type: 'HELP_CATALOG', catalog: getPackHelp() });
    },
  },
});
