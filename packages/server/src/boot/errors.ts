// This process's fatal errors. Anything uncaught here would otherwise die silently in a spawned process, so each is
// written to stderr as one JSON line that Electron main parses to show the user what happened
// (`packages/main/src/modules/api-server/process-manager.ts` matches `{"__fatal":`, so the shape is a contract).
// The renderer's counterpart is `boot/errors.ts` there, over the window's log.
import { errorMessage } from '@apackdev/sdk/utils/pure';

/** Writes one `__fatal` line for `error`, naming where it came from */
export function writeFatalError(error: unknown, source: string): void {
  const stack = error instanceof Error ? error.stack : undefined;
  process.stderr.write(JSON.stringify({ __fatal: true, message: errorMessage(error), stack, source }) + '\n');
}

/** Installs the process's catch-all handlers: an uncaught error is fatal, reported and then exited on */
export function installFatalErrorHandling(): void {
  process.on('uncaughtException', (error) => {
    writeFatalError(error, 'uncaughtException');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    writeFatalError(reason, 'unhandledRejection');
    process.exit(1);
  });
}
