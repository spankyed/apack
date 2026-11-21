import { setup, type ActorRefFrom, assign } from 'xstate';
import { safeEvents, type SurfaceLifecycleEvent } from '@apackdev/sdk/fe';
import { fromAsk, tell } from '#generated/events.ts';
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
  | SurfaceLifecycleEvent
  // The app's, when the logs surface's settings change; the canvas sends one itself to show a change at once
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: LogsSettings };

const typeOf = safeEvents<LogsEvents>();

export type LogsState = ActorRefFrom<typeof logsState>;

const logsState = setup({
  types: {
    context: {} as LogsContext,
    events: {} as LogsEvents,
  },
  actors: {
    /** The buffer, which the system answers this window alone */
    getLogs: fromAsk('logs', 'GET_LOGS'),
  },
  actions: {
    addLog: assign({
      logs: ({ context, event }) => {
        const newLog = typeOf('LOG_ADDED', event).log;
        return context.logs.some(log => log.id === newLog.id) 
          ? context.logs 
          : [newLog, ...context.logs];
      },
    }),
    clearLogs: assign({
      logs: () => [],
    }),
    sendClearLogsToBackend: () => {
      tell(id, {
        type: 'CLEAR_LOGS',
      });
    },
    setFilterLevel: assign({
      filter: ({ context, event }) => ({
        ...context.filter,
        level: typeOf('SET_FILTER_LEVEL', event).level,
      }),
    }),
    setSearch: assign({
      filter: ({ context, event }) => ({
        ...context.filter,
        search: typeOf('SET_SEARCH', event).search,
      }),
    }),
    updateSettings: assign({
      settings: ({ event }) => typeOf('FEATURE_SETTINGS_UPDATED', event).settings,
    }),
  },
}).createMachine({
  id,
  initial: 'active',
  context: {
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
  on: {
    // Asked where a delivery names the surface: as the shell starts it, and again as the settings that filter the
    // buffer change. Entering `reading` again gives up the read under way for this one
    SURFACE_STARTED: { target: '.reading', reenter: true },
    FEATURE_SETTINGS_UPDATED: { target: '.reading', reenter: true, actions: 'updateSettings' },
    LOG_ADDED: { actions: 'addLog' },
    LOGS_CLEARED: { actions: 'clearLogs' },
    SET_FILTER_LEVEL: { actions: 'setFilterLevel' },
    SET_SEARCH: { actions: 'setSearch' },
    CLEAR_LOGS: { actions: ['clearLogs', 'sendClearLogsToBackend'] },
  },
  states: {
    active: {},
    // The buffer is being read for exactly as long as this state is
    reading: {
      invoke: {
        src: 'getLogs',
        input: {},
        onDone: {
          target: 'active',
          // A buffer that could not be read leaves what is shown as it is
          actions: assign(({ event }) => (event.output.ok ? { logs: event.output.value.logs, settings: event.output.value.settings } : {})),
        },
      },
    },
  },
});

export default logsState; 