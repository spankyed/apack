import { repository } from '#generated/repository.ts';
import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
import type { Contract } from './contract.ts';
import { createLogger } from '@apackdev/sdk/logger';

const logger = createLogger('browser');


export const browserSpec = defineSystem<Contract>();

export const browserSystem = setup({
  types: browserSpec.types,
  actions: browserSpec.actions({
    sendSavedSession: ({ reply }) => {
      const savedTabs = repository.browserQueries.allTabs();
      const savedBookmarks = repository.browserQueries.allBookmarks();
      logger.info('Sending browser restore payload', {
        savedTabCount: savedTabs.length,
        savedBookmarkCount: savedBookmarks.length,
      });
      reply?.({
        type: 'SAVED_SESSION_READ',
        savedTabs,
        savedBookmarks,
      });
    },
    syncTabs: ({ event }) => {
      const ev = browserSpec.typeOf('SYNC_TABS', event);
      repository.browserCommands.syncTabs(ev.tabs);
    },
    syncBookmarks: ({ event }) => {
      const ev = browserSpec.typeOf('SYNC_BOOKMARKS', event);
      repository.browserCommands.syncBookmarks(ev.bookmarks);
    },
  }),
}).createMachine({
  id: 'browser',
  initial: 'active',
  context: {},
  on: {
    GET_SAVED_SESSION: {
      actions: ['sendSavedSession'],
    },
    SYNC_TABS: {
      actions: ['syncTabs'],
    },
    SYNC_BOOKMARKS: {
      actions: ['syncBookmarks'],
    },
  },
  states: {
    active: {},
  },
});

const browserEntry = { spec: browserSpec, machine: browserSystem };

export default browserEntry;
