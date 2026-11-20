export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source?: string;
  meta?: Record<string, any>;
  stack?: string;
}

export interface LogsState {
  logs: LogEntry[];
  maxLogs: number;
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type LogsSettings = import('#generated/settings.ts').SettingsOf<'logs'>;

export type IncomingLogEvents = { type: 'CLEAR_LOGS' };

/** What the logs system answers: the buffer as the settings filter it, and the settings, for a window as it starts */
export type LogsAsks = {
  GET_LOGS: { answer: { logs: LogEntry[]; settings: LogsSettings } };
};

export type LogsInternalEvents =
  | {
    type: 'ADD_LOG';
    log: Omit<LogEntry, 'id' | 'timestamp'>;
  };

/** What the logs system sends every window: each entry as it is logged — a feed — and that the buffer was cleared */
export type OutgoingLogsEvents =
  | { type: 'LOG_ADDED'; log: LogEntry }
  | { type: 'LOGS_CLEARED' };

export interface LogsContext {
  logs: LogEntry[];
}
