import { state } from '#generated/state.ts';
import type { ContractAsks, IncomingOnlyEventsOf, NormalizeAsks } from '@apackdev/sdk/events';
import { repository } from '#generated/repository.ts';
import type { Contract } from './contract.ts';
import { createLogger } from '@apackdev/sdk/logger';

const logger = createLogger('browser');

export const browserSystem = state<
  {},
  IncomingOnlyEventsOf<Contract>,
  NormalizeAsks<ContractAsks<Contract>>
>()({
  on: {
    SYNC_TABS: (ev) => {
      repository.browserCommands.syncTabs(ev.tabs);
    },
    SYNC_BOOKMARKS: (ev) => {
      repository.browserCommands.syncBookmarks(ev.bookmarks);
    },
  },
  answers: {
    GET_SAVED_SESSION: () => {
      const savedTabs = repository.browserQueries.allTabs();
      const savedBookmarks = repository.browserQueries.allBookmarks();
      logger.info('Sending browser restore payload', {
        savedTabCount: savedTabs.length,
        savedBookmarkCount: savedBookmarks.length,
      });
      return { savedTabs, savedBookmarks };
    },
  },
});

export default browserSystem;
