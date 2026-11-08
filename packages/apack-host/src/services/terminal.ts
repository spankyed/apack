// services.terminal: terminal sessions, whose processes the broker owns rather than this one.
//
// **The app holds one broker and starts it on the first session**, not at boot: a run that opens no
// terminal should pay nothing for one, and a broker that failed to start must fail the thing that needed it
// rather than the boot.
//
// **The binary comes from the `apack-terminal` package**, which answers for its own: a packaged app resolves
// it as it resolves every other dependency, and `APACK_TERMINAL_BINARY` overrides it for a build of your
// own. The crash-restart and the one-broker-per-data-dir that belong beside this are still the
// composition's to own.
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveAppEnvironment, withoutAppProcessEnv } from '@apackdev/sdk/env';
import type { TerminalListeners, TerminalService, TerminalSession } from '@apackdev/sdk/services';
import { type Broker, holdBrokerSessions, startBroker } from '../broker/client.ts';

/**
 * The longest a Unix socket path may be, conservatively.
 *
 * `sockaddr_un.sun_path` is 104 bytes on macOS and the BSDs and 108 on Linux, and the whole path has to fit
 * — a limit that belongs to the address structure and not to the filesystem, so a path a `mkdir` is perfectly
 * happy with is one `bind` refuses. 100 leaves room for the terminator and for the shorter of the two.
 */
const SOCKET_PATH_MAX = 100;

/**
 * Where the broker's socket goes: a private directory in the temporary one, named for the data dir it serves.
 *
 * **Not beside the app's other runtime files, and the reason is a hard limit rather than a preference.** It
 * was in `appDir`, and a data dir deep enough makes every terminal in the app fail — found by driving the app
 * under a disposable profile, where the broker exited with elmdb-style directness: *local socket name length
 * exceeds capacity of sun_path of sockaddr_un*. A user whose data dir sits under a long home directory, a
 * synced folder or a profile name would have hit the same wall, and nothing in the path was ours to shorten.
 *
 * So the name is derived instead: one broker per data dir is the rule, and a hash of the data dir says which
 * one without carrying its length. The directory is created 0700 — the socket lets whoever connects start a
 * shell, so it is not a thing to leave in a world-writable place — and the temporary directory is per-user on
 * macOS already. A path that still does not fit is refused here, naming the limit, rather than left to the
 * broker's `bind`.
 */
export function socketPath(platform: NodeJS.Platform = process.platform, dataDir = resolveAppEnvironment().userDataDir): string {
  const name = createHash('sha256').update(dataDir).digest('hex').slice(0, 12);
  // **Windows has no Unix socket here, it has a named pipe**, and the transport refuses a filesystem path
  // outright — *expected a named pipe path*, which is what the broker's own suite got on its first Windows
  // run, in place of a broker. A pipe name is one flat namespace for the machine, so the data dir's hash is
  // what keeps one app's broker apart from another's, exactly as the directory does below.
  if (platform === 'win32') return `\\\\.\\pipe\\apack-terminal-${name}`;

  const directory = path.join(os.tmpdir(), `apack-term-${name}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const socket = path.join(directory, 't.sock');
  if (Buffer.byteLength(socket) > SOCKET_PATH_MAX) {
    throw new Error(
      `The terminal broker's socket path is ${Buffer.byteLength(socket)} bytes, past the ${SOCKET_PATH_MAX} a `
      + `Unix socket address holds: ${socket}. Set TMPDIR to a shorter directory.`,
    );
  }
  return socket;
}

/**
 * The broker's binary, or absence.
 *
 * **Two answers: `APACK_TERMINAL_BINARY`, then the `apack-terminal` package.** The package is asked rather
 * than a path derived, because the package is what knows — the binary's name differs by platform, `cargo`
 * writing `apack-terminal.exe` on Windows, and it sits beside that package's own file wherever Node
 * resolved it from. A path built here was wrong about exactly that: `existsSync` answered false on Windows
 * and the caller got a refusal telling it to run `cargo build` in a checkout where `cargo build` had just
 * succeeded, so the terminal never started there at all.
 *
 * The override is how a contributor runs a build of their own — a debug broker, with its assertions and its
 * symbols — and is the reason there is no second path to guess at. It was the linked checkout's
 * `target/debug` build, derived from `SHIPPED_PACKS_DIR`, before the package existed.
 */
export function findBrokerBinary(): string | undefined {
  const named = process.env.APACK_TERMINAL_BINARY;
  if (named) {
    if (existsSync(named)) return named;
    throw new Error(`APACK_TERMINAL_BINARY names ${named}, which does not exist`);
  }
  return packagedBrokerBinary();
}

/**
 * The broker's binary, refusing when there is none.
 *
 * Separate from `findBrokerBinary` because a caller that must have one wants the refusal, and a caller that
 * is asking *whether* there is one — the lifetime suite, which drives the real binary — cannot ask a
 * function that throws.
 */
export function brokerBinary(): string {
  const found = findBrokerBinary();
  if (found) return found;
  throw new Error(
    'No terminal broker: run `cargo xtask package` in the apack-terminal checkout to stage its binary into '
    + 'the apack-terminal package (`npm run link:apack-terminal` makes the link), or set '
    + 'APACK_TERMINAL_BINARY to a build of your own',
  );
}

/**
 * The broker the `apack-terminal` package ships, or absence.
 *
 * **Asked of the package rather than derived from a path**, because the package is what knows: the binary's
 * name differs by platform — `cargo` writes `apack-terminal.exe` on Windows — and it sits beside that
 * package's own file wherever Node resolved it from. A packaged app therefore finds it the way it finds
 * every other dependency, with no rule of its own, which is the arrangement elmdb's binding has here.
 *
 * Resolved from `import.meta.url` rather than from a path of ours: this module is bundled into the API's
 * build, so its directory at runtime is `packages/api/dist`, and Node's lookup walks up from there to the
 * app's `node_modules` — the same place the checkout's hoisted copy is.
 *
 * A package that isn't installed is an absence, and anything else it throws is a real failure worth
 * seeing rather than one more silent `undefined`.
 */
export function packagedBrokerBinary(): string | undefined {
  try {
    const shipping = createRequire(import.meta.url)('apack-terminal') as typeof import('apack-terminal');
    return shipping.brokerBinary();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

/**
 * The environment the broker is started with, and so the one every shell it spawns inherits.
 *
 * **This is where the app's identity stops**, and it is here rather than in the pack because the spawn is
 * here: the pack had a strip of its own, written for its own `spawn`, and it was left with no caller the
 * moment the broker took the spawn over — so for the length of that change a user's shell inherited all ten
 * variables again. Hygiene lives where the spawn is.
 */
export function brokerEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...withoutAppProcessEnv(env),
    // **`TERM` is declared, not inherited** (X13). A terminal tells its programs what it is, and nothing
    // else here does: `portable-pty` sets no `TERM`, so the shell took whatever this process happened to
    // have — which is the shell the app was *launched* from in development, and nothing at all in a
    // packaged app opened from the Dock. A shell with no `TERM` gives `less`, `vim` and `top` their dumb
    // fallbacks, and nothing about that failure names the app. xterm.js is what draws it, so this is what
    // it is.
    TERM: 'xterm-256color',
    TERM_PROGRAM: 'apack',
    COLORTERM: 'truecolor',
  };
}

/**
 * Holds every terminal session open for as long as the calling process lives, and ends them when it dies.
 *
 * **Electron main calls this, and only Electron main.** A session has to outlive the API — restarting it
 * must not take a user's shells down — so the backstop has to be held by something that outlives the API,
 * and in the app that is the process whose lifetime *is* the app's. It is a hold and not a handler: the
 * descriptor closes on process death however the process died, so a crash reaps the shells as a clean quit
 * does.
 *
 * A process that never calls it loses nothing: the broker ends its sessions when the last client leaves,
 * which is what a dev run, a test and the CLI rely on.
 */
export function holdTerminalSessions(): Promise<{ close(): void }> {
  return holdBrokerSessions({
    binary: brokerBinary(),
    socket: socketPath(),
    env: brokerEnvironment(),
  });
}

/** Starts the broker the first time a session is wanted, and once per process thereafter */
export function createTerminalService(): TerminalService & { shutdown(): Promise<void> } {
  let broker: Promise<Broker> | undefined;

  const running = (): Promise<Broker> => {
    broker ??= startBroker({ binary: brokerBinary(), socket: socketPath(), env: brokerEnvironment() })
      .catch((error: unknown) => {
      // A failed start must not be remembered as a broker: the next session tries again, so a contributor
      // who builds the binary and retries is not told to restart the app
      broker = undefined;
      throw error;
    });
    return broker;
  };

  return {
    async open(options, listeners: TerminalListeners): Promise<TerminalSession> {
      const held = await running();
      const session = await held.open(options, listeners);
      return {
        id: session.id,
        pid: session.pid,
        // The broker's own, from its handshake, rather than a number this process also keeps
        scrollback: held.history,
        write: (data) => session.write(data),
        resize: (cols, rows) => session.resize(cols, rows),
        terminate: () => session.kill(),
      };
    },
    /**
     * Leaves the broker. **It does not end it, and must not**: the sessions outlive this process so that
     * restarting it does not take a user's shells down. What ends them is whoever holds them —
     * `holdTerminalSessions` in the app, and otherwise the broker's own rule that the last client out ends
     * them, which is what stops a dev run or a test leaving anything behind.
     */
    async shutdown() {
      const started = broker;
      broker = undefined;
      if (started) await (await started.catch(() => undefined))?.close();
    },
  };
}
