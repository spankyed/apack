import type { SurfaceLifecycleEvent } from '@apackdev/sdk/fe';
import { state } from '#generated/state.ts';
import type { LogsSettings } from '#generated/types.ts';
import type { LogsContext } from './contract.ts';
import type { OutgoingLogsEvents } from '#features/logs/be/types.ts';

export const id = 'logs' as const;

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  meta?: Record<string, any>;
  stack?: string;
}

type LogsEvents =
  | { type: 'SET_FILTER_LEVEL'; level: 'all' | 'debug' | 'info' | 'warn' | 'error' }
  | { type: 'SET_SEARCH'; search: string }
  | { type: 'CLEAR_LOGS' }
  | OutgoingLogsEvents
  | Extract<SurfaceLifecycleEvent, { type: 'SURFACE_STARTED' }>
  // The app's, when the logs surface's settings change; the canvas sends one itself to show a change at once
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: LogsSettings };

type LogsShape = {
  data: LogsContext;
  calls: {
    /** The buffer, which the system answers this window alone */
    getLogs: 'one';
  };
};

const logsState = state<LogsShape, LogsEvents>()({
  data: {
    logs: [],
    filter: {
      level: 'all',
      search: '',
    },
    settings: {
      maxLogs: 1000,
      excludedSources: [],
    },
  },
  calls: ({ one }) => ({
    getLogs: one('logs', 'GET_LOGS', {
      // A buffer that could not be read leaves what is shown as it is
      done: (outcome) =>
        outcome.ok
          ? { data: { logs: outcome.value.logs, settings: outcome.value.settings } }
          : undefined,
    }),
  }),
  on: {
    // Asked where a delivery names the surface: as the shell starts it, and again as the settings that filter the
    // buffer change. Cancelling first supersedes any read already in flight.
    SURFACE_STARTED: (_event, { call, cancel }) => {
      cancel('getLogs');
      call('getLogs');
    },
    FEATURE_SETTINGS_UPDATED: (event, { call, cancel }) => {
      cancel('getLogs');
      call('getLogs');
      return { data: { settings: event.settings } };
    },
    LOG_ADDED: (event, { data }) =>
      data.logs.some(log => log.id === event.log.id)
        ? undefined
        : { data: { logs: [event.log, ...data.logs] } },
    LOGS_CLEARED: () => ({ data: { logs: [] } }),
    SET_FILTER_LEVEL: (event, { data }) => ({
      data: { filter: { ...data.filter, level: event.level } },
    }),
    SET_SEARCH: (event, { data }) => ({
      data: { filter: { ...data.filter, search: event.search } },
    }),
    CLEAR_LOGS: (_event, { tell }) => {
      tell(id, { type: 'CLEAR_LOGS' });
      return { data: { logs: [] } };
    },
  },
});

export default logsState;
