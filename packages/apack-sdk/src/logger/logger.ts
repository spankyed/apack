import { _boundBackendHost, _isBackendHostBound } from '../runtime/backend-port.ts';
import { redactSecrets, redactSecretText } from '../utils/redact.ts';

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface LoggerOptions {
  /** Log `debug` messages only while the source's debug toggle is on (`setDebugEnabled`). It starts on outside production. */
  debug?: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEvent = {
  level: LogLevel;
  message: string;
  source?: string;
  meta?: Record<string, unknown>;
  stack?: string;
}

const debugEnabled = new Map<string, boolean>();

/** Turns a source's gated `debug` messages on or off (loggers created with `{ debug: true }`) */
export function setDebugEnabled(source: string, enabled: boolean): void {
  debugEnabled.set(source, enabled);
}

/** Whether a source's gated `debug` messages are logged */
export function isDebugEnabled(source: string): boolean {
  return debugEnabled.get(source) ?? process.env.NODE_ENV !== 'production';
}

/**
 * A copy of `value` that JSON can hold: a BigInt becomes its digits, and a repeated object, a function and
 * `undefined` become markers.
 *
 * `[Repeated]` covers an object that holds itself as well as one that merely appears twice, a seen-set having
 * no path to tell them apart. That branch is what makes this function **total over any input**, which is the
 * claim worth keeping: its one caller redacts first, and redaction cuts a loop and copies a repeat, so in
 * practice nothing reaches here twice — but that is a fact about a caller, where totality is a fact about the
 * function, and only one of the two survives somebody moving the call.
 *
 * The BigInt branch is what stops this throwing. `JSON.stringify` refuses one, and nothing caught that — so
 * `logger.info('a row', { count: 42n })` threw from inside the logger, on data this app's own database
 * returns.
 */
function serializable(value: unknown): unknown {
  const seen = new WeakSet<object>();
  return JSON.parse(JSON.stringify(value, (_key, field: unknown) => {
    if (typeof field === 'bigint') return field.toString();
    if (typeof field === 'object' && field !== null) {
      if (seen.has(field)) return '[Repeated]';
      seen.add(field);
    }
    if (typeof field === 'function') return '[Function]';
    if (field === undefined) return '[Undefined]';
    return field;
  }) ?? 'null');
}

/** The stack an error entry carries: the reported error's, else where it was logged */
function errorStack(meta: unknown, message: string): string | undefined {
  const error = meta !== null && typeof meta === 'object' ? (meta as { error?: unknown }).error : undefined;
  if (error === undefined) return new Error(message).stack;
  if (typeof error === 'string') return new Error(error).stack;
  if (error !== null && typeof error === 'object' && typeof (error as { stack?: unknown }).stack === 'string') {
    return (error as { stack: string }).stack;
  }
  return undefined;
}

/**
 * One log entry. With an app bound it goes onto the app's bus as a log event (the app prints and streams those);
 * without one, to the console. Either way key-shaped strings are redacted first.
 */
function log(level: LogLevel, source: string | undefined, args: unknown[]): void {
  if (!_isBackendHostBound()) {
    console[level](...(source === undefined ? [] : [`[${source}]`]), ...args.map((arg) => redactSecrets(arg)));
    return;
  }
  const [rawMessage, rawMeta] = args;
  const message = redactSecretText(typeof rawMessage === 'string' ? rawMessage : String(rawMessage));
  // Errors become plain objects here, keeping their name, message and stack
  const meta = rawMeta === undefined ? undefined : redactSecrets(rawMeta);
  const stack = level === 'error' ? errorStack(meta, message) : undefined;
  _boundBackendHost().transport.rootEvents.emitLog({
    level,
    message,
    source,
    ...(meta !== undefined && { meta: serializable(meta) as Record<string, unknown> }),
    ...(stack !== undefined && { stack: redactSecretText(stack) }),
  });
}

/** A logger whose entries carry `source`; with `{ debug: true }` its `debug` messages follow the source's debug toggle */
export function createLogger(source?: string, options: LoggerOptions = {}): Logger {
  const gate = options.debug && source !== undefined ? source : undefined;
  return {
    debug: (...args) => { if (gate === undefined || isDebugEnabled(gate)) log('debug', source, args); },
    info: (...args) => log('info', source, args),
    warn: (...args) => log('warn', source, args),
    error: (...args) => log('error', source, args),
  };
}

/** Calls `callback` with every log entry the app records; returns the unsubscribe (backend only) */
export function onLog(callback: (event: LogEvent) => void): () => void {
  return _boundBackendHost().transport.rootEvents.onLog(callback);
}
