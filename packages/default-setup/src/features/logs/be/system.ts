import { featureSettings } from '#generated/settings.ts';

import { broadcastToSurface } from '#generated/events.ts';
import { assign, setup, fromCallback, spawnChild } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';

import type { Contract } from './contract.ts';
import type { LogEntry } from './types.ts';
import { randomId } from '@apackdev/sdk/utils';
import { onLog, type LogEvent } from '@apackdev/sdk/logger';
import type { LogsSettings } from '#generated/types.ts';
import { isSourceExcluded, filterLogsByExcludedSources } from './utils.ts';

// Resolve the effective exclusion list: when showAppEvents is falsy, treat 'app-events' as excluded.
function effectiveExcludedSources(settings: LogsSettings | undefined): string[] {
  const base = settings?.excludedSources ?? [];
  return settings?.showAppEvents ? base : [...base, 'app-events'];
}

export const logsSpec = defineSystem<Contract>();

export const logsSystem = setup({
  types: logsSpec.types,
  actors: {
    setupEventListeners: fromCallback(({ sendBack }) => {
      const logHandler = (event: LogEvent) => {
        sendBack({
          type: 'ADD_LOG',
          log: event
        });
      };

      // The app delivers this early system its messages and client connections as the bus does the others'
      return onLog(logHandler);
    }),
  },
  actions: logsSpec.actions({
    setupEventListeners: spawnChild('setupEventListeners'),
    clearLogs: assign({ logs: () => [] }),
    addLog: assign({
      logs: ({ context, event }) => {
        const { log } = logsSpec.typeOf('ADD_LOG', event);
        
        const newLog: LogEntry = {
          ...log,
          id: randomId(),
          timestamp: Date.now(),
        };
        
        const updatedLogs = [newLog, ...context.logs];
        
        // Keep only the last maxLogs entries
        const settings = featureSettings.forFeature('logs').get();

        if (updatedLogs.length > (settings?.maxLogs || 1000)) {
          return updatedLogs.slice(0, settings?.maxLogs || 1000);
        }
        
        return updatedLogs;
      }
    }),
    /** The buffer as the settings filter it, answered to the window that asked */
    sendLogs: ({ context, reply }) => {
      const settings = featureSettings.forFeature('logs').get();
      const filteredLogs = filterLogsByExcludedSources(context.logs, effectiveExcludedSources(settings));
      reply?.({
        type: 'LOGS_READ',
        logs: filteredLogs,
        settings: settings ?? { maxLogs: 1000, excludedSources: [], showAppEvents: false },
      });
    },
    broadcastNewLog: ({ context }) => {
      const newLog = context.logs[0];

      // Get current settings from repository
      const settings = featureSettings.forFeature('logs').get();
      const excludedSources = effectiveExcludedSources(settings);

      // Check if new log should be excluded
      if (isSourceExcluded(newLog.source, excludedSources)) {
        return; // Don't broadcast excluded logs
      }

      broadcastToSurface('logs', {
        type: 'LOG_ADDED',
        log: newLog,
      });
    },
    broadcastLogsCleared: () => {
      broadcastToSurface('logs', {
        type: 'LOGS_CLEARED',
      })
    },
    truncateLogsIfNeeded: assign({
      logs: ({ context }) => {
        // If logs exceed new maxLogs, truncate
        const settings = featureSettings.forFeature('logs').get();
        if (context.logs.length > (settings?.maxLogs || 1000)) {
          return context.logs.slice(context.logs.length - (settings?.maxLogs || 1000));
        }
        return context.logs;
      }
    }),
  }),
}).createMachine({
  id: 'logs',
  initial: 'active',
  context: () => {
    return {
      logs: [],
    };
  },
  entry: ['setupEventListeners'],
  on: {
    // Each window showing the logs asks for them again, filtered by what the settings now say
    FEATURE_SETTINGS_UPDATED: {
      actions: ['truncateLogsIfNeeded'],
    },
  },
  states: {
    active: {
      on: {
        'ADD_LOG': {
          actions: ['addLog', 'broadcastNewLog'],
        },
        CLEAR_LOGS: {
          actions: ['clearLogs', 'broadcastLogsCleared'],
        },
        GET_LOGS: {
          actions: ['truncateLogsIfNeeded', 'sendLogs'],
        },
      },
    },
  },
});

const logsEntry = { spec: logsSpec, machine: logsSystem };

export default logsEntry;