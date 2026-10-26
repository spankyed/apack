import { setup, type ActorRefFrom, assign } from 'xstate';
import { safeEvents, type SurfaceLifecycleEvent } from '@apackdev/sdk/fe';
import { sendToSystem } from '#generated/events.ts';
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
  actions: {
    /** The buffer, which the system answers this window alone; asked in a delivery naming the surface */
    requestLogs: () => {
      sendToSystem(id, { type: 'GET_LOGS' });
    },
    setLogs: assign(({ event }) => {
      const ev = typeOf('LOGS_READ', event);
      return { logs: ev.logs, settings: ev.settings };
    }),
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
      sendToSystem(id, {
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
  states: {
    active: {
      on: {
        SURFACE_STARTED: {
          actions: 'requestLogs',
        },
        'LOGS_READ': {
          actions: 'setLogs',
        },
        'LOG_ADDED': {
          actions: 'addLog',
        },
        'LOGS_CLEARED': {
          actions: 'clearLogs',
        },
        SET_FILTER_LEVEL: {
          actions: 'setFilterLevel',
        },
        SET_SEARCH: {
          actions: 'setSearch',
        },
        CLEAR_LOGS: {
          actions: ['clearLogs', 'sendClearLogsToBackend'],
        },
        // The settings filter the buffer, so the surface asks for it again as they now filter it
        FEATURE_SETTINGS_UPDATED: {
          actions: ['updateSettings', 'requestLogs'],
        },
      },
    },
  },
}); 

export default logsState; 