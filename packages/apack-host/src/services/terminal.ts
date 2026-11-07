// services.terminal: terminal sessions, whose processes the broker owns rather than this one.
//
// **The app holds one broker and starts it on the first session**, not at boot: a run that opens no
// terminal should pay nothing for one, and a broker that failed to start must fail the thing that needed it
// rather than the boot.
//
// **Where the binary comes from is a development answer for now.** `APACK_TERMINAL_BINARY` names it; failing
// that, the linked checkout's debug build, which is what a contributor has. A packaged app ships a
// per-platform binary and resolves it from its resources — that, and the crash-restart and
// one-broker-per-data-dir that go with it, are the composition's to own when the broker ships, and the goal
// says so rather than leaving it to be discovered.
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import type { TerminalListeners, TerminalService, TerminalSession } from '@apackdev/sdk/services';
import { type Broker, startBroker } from '../broker/client.ts';

/** Where the broker's socket goes: beside the app's other runtime files, one per data dir */
const socketPath = (): string => path.join(resolveAppEnvironment().appDir, 'terminal-broker.sock');

/**
 * The broker binary this app runs.
 *
 * It refuses rather than guessing, naming both the variable and the build, because a missing broker is a
 * setup mistake with an exact remedy and a silent fallback to `node-pty` is the thing this phase removes.
 */
function brokerBinary(): string {
  const named = process.env.APACK_TERMINAL_BINARY;
  if (named) {
    if (existsSync(named)) return named;
    throw new Error(`APACK_TERMINAL_BINARY names ${named}, which does not exist`);
  }
  // The checkout `vendor/apack-terminal` links to, as `@apackdev/ears` finds elmdb's binding
  const checkout = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'vendor', 'apack-terminal');
  const built = path.join(checkout, 'target', 'debug', 'apack-terminal');
  if (existsSync(built)) return built;
  throw new Error(
    `No terminal broker: set APACK_TERMINAL_BINARY, or run \`cargo build\` in the apack-terminal checkout `
    + `(expected ${built}; \`npm run link:apack-terminal\` makes the link)`,
  );
}

/** Starts the broker the first time a session is wanted, and once per process thereafter */
export function createTerminalService(): TerminalService & { shutdown(): Promise<void> } {
  let broker: Promise<Broker> | undefined;

  const running = (): Promise<Broker> => {
    broker ??= startBroker({ binary: brokerBinary(), socket: socketPath() }).catch((error: unknown) => {
      // A failed start must not be remembered as a broker: the next session tries again, so a contributor
      // who builds the binary and retries is not told to restart the app
      broker = undefined;
      throw error;
    });
    return broker;
  };

  return {
    async open(options, listeners: TerminalListeners): Promise<TerminalSession> {
      const session = await (await running()).open(options, listeners);
      return {
        id: session.id,
        pid: session.pid,
        write: (data) => session.write(data),
        resize: (cols, rows) => session.resize(cols, rows),
        terminate: () => session.kill(),
      };
    },
    /** Ends the broker with the app. Host-only: no pack stops the process it shares with every other */
    async shutdown() {
      const started = broker;
      broker = undefined;
      if (started) await (await started.catch(() => undefined))?.close();
    },
  };
}
