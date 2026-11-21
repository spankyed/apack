import { setup, fromCallback } from 'xstate';
import { defineSystem, getPackHelp, onPackCatalogChanged } from '@apackdev/sdk/framework';
import { broadcast } from '../../../events.ts';

import type { HelpOutgoing } from '../../event-contracts.ts';
export type Contract = {
  context: Record<string, never>;
  incoming: { type: 'GET_HELP' } | { type: 'CLIENT_CONNECTED' };
  internal: { type: 'CATALOG_CHANGED' };
  outgoing: HelpOutgoing;
};
const spec = defineSystem<Contract>();
export const helpSystem = setup({
  types: spec.types,
  actors: { catalog: fromCallback(({ sendBack }) => onPackCatalogChanged(() => sendBack({ type: 'CATALOG_CHANGED' }))) },
  actions: { sendCatalog: () => broadcast('settings', { type: 'HELP_CATALOG', catalog: getPackHelp() }) },
}).createMachine({
  id: 'help', context: {},
  invoke: { src: 'catalog' },
  on: {
    GET_HELP: { actions: 'sendCatalog' },
    CLIENT_CONNECTED: { actions: 'sendCatalog' },
    CATALOG_CHANGED: { actions: 'sendCatalog' },
  },
});
