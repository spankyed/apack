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

export type IncomingLogEvents =
  | { type: 'CLEAR_LOGS' }
  /** The buffer as the settings filter it, and the settings: answered with \`LOGS_READ\` */
  | { type: 'GET_LOGS' };

export type LogsInternalEvents =
  | {
    type: 'ADD_LOG';
    log: Omit<LogEntry, 'id' | 'timestamp'>;
  };

/**
 * What the logs system sends: the buffer, to the window that asked for it (as it starts, and when the settings that
 * filter it change); and to every window, each entry as it is logged — a feed — and that the buffer was cleared.
 */
export type OutgoingLogsEvents =
  | { type: 'LOGS_READ'; logs: LogEntry[]; settings: LogsSettings }
  | { type: 'LOG_ADDED'; log: LogEntry }
  | { type: 'LOGS_CLEARED' };

export interface LogsContext {
  logs: LogEntry[];
}
