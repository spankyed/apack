export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  id: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  source?: string;
  stack?: string;
  timestamp: number;
};

export type LogsSettings = {
  excludedSources: string[];
  maxLogs: number;
  showAppEvents?: boolean;
};

export type LogsSurfaceState = {
  copied?: boolean;
  contextMenu?: {
    source: string;
    visible: boolean;
    x: number;
    y: number;
  };
  expandedContent: Record<string, 'meta' | 'stack' | undefined>;
  filterLevel: 'all' | LogLevel;
  logs: LogEntry[];
  searchTerm: string;
  settings: LogsSettings;
};
