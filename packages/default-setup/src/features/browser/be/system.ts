import { repository } from '#generated/repository.ts';
import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
import type { Contract } from './contract.ts';
import { createLogger } from '@apackdev/sdk/logger';

const logger = createLogger('browser');


export const browserSpec = defineSystem<Contract>();

export const answers = browserSpec.answers({
  GET_SAVED_SESSION: () => {
    const savedTabs = repository.browserQueries.allTabs();
    const savedBookmarks = repository.browserQueries.allBookmarks();
    logger.info('Sending browser restore payload', {
      savedTabCount: savedTabs.length,
      savedBookmarkCount: savedBookmarks.length,
    });
    return { savedTabs, savedBookmarks };
  },
});

export const browserSystem = setup({
  types: browserSpec.types,
  actions: {
    ...answers.actions,
    ...browserSpec.actions({
    syncTabs: ({ event }) => {
      const ev = browserSpec.typeOf('SYNC_TABS', event);
      repository.browserCommands.syncTabs(ev.tabs);
    },
    syncBookmarks: ({ event }) => {
      const ev = browserSpec.typeOf('SYNC_BOOKMARKS', event);
      repository.browserCommands.syncBookmarks(ev.bookmarks);
    },
  }),
  },
}).createMachine({
  id: 'browser',
  initial: 'active',
  context: {},
  on: {
    ...answers.on,
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
