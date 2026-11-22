// The API's log output: every log event on the root event bus (from @apackdev/sdk/logger, error reports and captured
// console calls) is printed once to the original console, and streamed to the client by the logs system
import { formatWithOptions, type InspectOptions } from 'node:util';
import type { LogEvent, LogLevel } from '@apackdev/sdk/logger';
import { rootEvents } from '../transport/emitter.ts';
import { errorMessage, redactSecretText } from '@apackdev/sdk/utils/pure';

// Store original console methods
export const originalConsole = {
  log: console.log,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

/** The console method each level prints with */
const PRINT_METHOD: Record<LogLevel, keyof typeof originalConsole> = { debug: 'debug', info: 'log', warn: 'warn', error: 'error' };

/** The console's own formatting, without colors: the text also goes to the log sinks */
const INSPECT_OPTIONS: InspectOptions = { colors: false };

/**
 * The arguments as the console prints them, with API keys redacted. The arguments are only read, never copied or
 * changed, and formatting never throws out of a console call.
 */
function formatArgs(args: unknown[]): string {
  try {
    return redactSecretText(formatWithOptions(INSPECT_OPTIONS, ...args));
  } catch (error) {
    // A getter or custom inspect that throws, say
    return `[console arguments that couldn't be formatted: ${redactSecretText(errorMessage(error))}]`;
  }
}

/** Prints a log event: `[source] message meta`, as its logger was called (already redacted) */
function printLogEvent(event: LogEvent): void {
  originalConsole[PRINT_METHOD[event.level]](
    ...(event.source === undefined ? [] : [`[${event.source}]`]),
    event.message,
    ...(event.meta === undefined ? [] : [event.meta]),
  );
}

let stopPrinting: (() => void) | undefined;

/** Prints every log event on the root event bus to the original console, once each; safe to call again */
export function printLogEvents(): void {
  stopPrinting ??= rootEvents.onLog(printLogEvent);
}

/** Turns console calls into log events (which printLogEvents prints) */
export function initializeLogCapture() {
  printLogEvents();
  const captureLog = (level: LogLevel) => {
    return function (...args: unknown[]) {
      // Every sink (the console, log events, app-events.log) gets the same redacted text
      rootEvents.emitLog({ level, message: formatArgs(args) });
    };
  };

  console.log = captureLog('info');
  console.debug = captureLog('debug');
  console.info = captureLog('info');
  console.warn = captureLog('warn');
  console.error = captureLog('error');
}

// Restore original console methods (useful for testing)
export function restoreConsole() {
  console.log = originalConsole.log;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
