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
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
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
 * The broker binary this app runs.
 *
 * It refuses rather than guessing, naming both the variable and the build, because a missing broker is a
 * setup mistake with an exact remedy and a silent fallback to `node-pty` is the thing this phase removes.
 */
/**
 * Where a built broker would be, without asking whether it is there.
 *
 * **Separate from the lookup because the name is the part worth checking.** `cargo` writes
 * `apack-terminal` on POSIX and `apack-terminal.exe` on Windows, and looking for the extensionless name
 * there finds nothing — so a caller is told to run `cargo build` in a checkout where it has already been
 * run, and the terminal never starts. That is what Windows did until an end-to-end run on 2026-11-08.
 * A function that throws unless the file exists cannot be asked what it was looking for.
 */
export function brokerBinaryPath(
  packagesDir = process.env.SHIPPED_PACKS_DIR,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  // The checkout is found from `SHIPPED_PACKS_DIR`, which names `packages/`, so its parent is the root
  return packagesDir
    ? path.join(path.dirname(packagesDir), 'vendor', 'apack-terminal', 'target', 'debug',
      platform === 'win32' ? 'apack-terminal.exe' : 'apack-terminal')
    : undefined;
}

/**
 * The broker's binary, refusing when there is none.
 *
 * `cargo` writes `apack-terminal` on POSIX and `apack-terminal.exe` on Windows. Looking for the
 * extensionless name there finds nothing, and what the caller gets is this function's own refusal saying
 * to run `cargo build` — in a checkout where `cargo build` has already been run. The terminal then never
 * starts at all, which is what it did on Windows until an end-to-end run on 2026-11-08.
 *
 * `platform` is an argument for the reason `socketPath`'s is: the answer is about the file's name, not
 * about where this code happens to be running, so a case can say so from either.
 */
export function brokerBinary(
  packagesDir = process.env.SHIPPED_PACKS_DIR,
  platform: NodeJS.Platform = process.platform,
): string {
  const named = process.env.APACK_TERMINAL_BINARY;
  if (named) {
    if (existsSync(named)) return named;
    throw new Error(`APACK_TERMINAL_BINARY names ${named}, which does not exist`);
  }
  // **The checkout is found from `SHIPPED_PACKS_DIR`, not from this module's path.** This file is bundled
  // into the API's build, so `import.meta.dirname` is `packages/api/dist` at runtime and a path relative to
  // it resolved one directory above the checkout — which the refusal below reported exactly, and is how this
  // was found. That variable names `packages/`, so its parent is the checkout root.
  // Taken as an argument so that a caller which knows where `packages/` is can say so: the API has it in
  // its environment, and Electron main computes it to *give* the API, so main would otherwise be reading a
  // variable it sets for somebody else
  const built = brokerBinaryPath(packagesDir, platform);
  if (built && existsSync(built)) return built;
  throw new Error(
    `No terminal broker: set APACK_TERMINAL_BINARY, or run \`cargo build\` in the apack-terminal checkout `
    + `(${built ? `expected ${built}` : 'and SHIPPED_PACKS_DIR is unset, so there is no checkout to look in'}; `
    + '`npm run link:apack-terminal` makes the link)',
  );
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
export function holdTerminalSessions(options: { packagesDir: string }): Promise<{ close(): void }> {
  return holdBrokerSessions({
    binary: brokerBinary(options.packagesDir),
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
      const session = await (await running()).open(options, listeners);
      return {
        id: session.id,
        pid: session.pid,
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
