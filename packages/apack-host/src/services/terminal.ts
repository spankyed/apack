// services.terminal: terminal sessions, whose processes the broker owns rather than this one.
//
// **The app holds one broker and starts it on the first session**, not at boot: a run that opens no
// terminal should pay nothing for one, and a broker that failed to start must fail the thing that needed it
// rather than the boot.
//
// **The binary comes from the `apack-terminal` package**, which answers for its own: a packaged app resolves
// it as it resolves every other dependency, and `APACK_TERMINAL_BINARY` overrides it for a build of your
// own.
//
// **A broker that dies is recovered by forgetting it.** The connection closing reports every session exited
// (`broker/client.ts`) and tells this service, which drops the broker it had cached — so the next session
// starts a fresh one through the lazy path above, the one a first session takes anyway, rather than through a
// supervisor beside it. What bounds that is `START_ATTEMPTS`, counted over the binary a start was tried
// against. One broker per data dir is the start lock's (`ensureListening`), not this file's.
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveAppEnvironment, withoutAppProcessEnv } from '@apackdev/sdk/env';
import type { TerminalColor, TerminalColors, TerminalListeners, TerminalService, TerminalSession } from '@apackdev/sdk/services';
import { type Broker, type BrokerColors, type BrokerSession, holdBrokerSessions, startBroker } from '../broker/client.ts';

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
    // fallbacks, and nothing about that failure names the app. The window's emulator is what draws it, so this is what
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

/**
 * A broker session as a pack holds it.
 *
 * One mapping for both ways of coming to hold a session, because what a pack may do with one does not
 * depend on whether this process started it.
 */
function expose(held: Broker, session: BrokerSession): TerminalSession {
  return {
    id: session.id,
    pid: session.pid,
    // The broker's own, from its handshake, rather than a number this process also keeps
    scrollback: held.history,
    write: (data) => session.write(data),
    resize: (cols, rows, cell) => session.resize(cols, rows, cell),
    // Projected rather than passed, so the broker's `foreground` — a measurement, and a host shape — stays
    // out of the pack-facing contract
    facts: async () => {
      const { cwd, command, running, exitStatus, finished } = await session.facts();
      return { cwd, command, running, exitStatus, finished };
    },
    pause: () => session.pause(),
    resume: () => session.resume(),
    // The SDK declares the same closed set and the same scopes, so this passes them through rather than
    // mapping: a table here would be a second place for a signal to be missing from
    owns: (pid) => session.owns(pid),
    signal: (signal, scope) => session.signal(signal, scope),
    terminate: () => session.kill(),
  };
}

/**
 * A `#rrggbb` colour as red, green and blue, refusing anything else.
 *
 * Refused rather than read as black: a colour is what a program in the session is told the terminal is
 * drawn in, and a typo answered as black tells every one of them the background is dark.
 */
function rgb(color: TerminalColor): [number, number, number] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!hex) throw new Error(`A terminal colour is #rrggbb, and ${JSON.stringify(color)} is not`);
  return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
}

/** A session's colours as the broker takes them */
export function brokerColors(colors: TerminalColors): BrokerColors {
  return {
    foreground: rgb(colors.foreground),
    background: rgb(colors.background),
    cursor: colors.cursor === undefined ? null : rgb(colors.cursor),
    ansi: colors.ansi.map(rgb),
  };
}

/**
 * How many times a start may fail against one binary before the next session is refused with what that
 * failure said, rather than spawning another doomed process.
 *
 * Three, which is what the app's own supervisor allows its API process (`API_CONFIG.MAX_RESTART_ATTEMPTS`).
 * The number is derived from nothing, so it is the one this repo already chose rather than a second opinion.
 */
const START_ATTEMPTS = 3;

/**
 * What a start was attempted against: the binary's identity and the socket it would have bound.
 *
 * **This is what lets the budget below be forgiven without a timer or a reset hatch.** A contributor who
 * rebuilds the broker, or points `APACK_TERMINAL_BINARY` at another build, changes this key and gets a fresh
 * budget by doing the only thing that might fix it — which is the intent the old comment here stated and a
 * plain counter would have broken. A cooldown would forgive a binary that is still broken, and so go back to
 * spawning a process that cannot start, slower.
 *
 * The binary's size and mtime rather than its bytes: this runs before every start, and a hash of an Electron-
 * sized binary on that path would cost more than the spawn it is deciding about.
 */
function startKey(binary: string, socket: string): string {
  let stamp = 'absent';
  try {
    const { size, mtimeMs } = statSync(binary);
    stamp = `${size}:${mtimeMs}`;
  } catch {
    // An unreadable binary is a key of its own: the start below fails and says so
  }
  return `${binary}@${stamp}->${socket}`;
}

/** Starts the broker the first time a session is wanted, and once per process thereafter */
export function createTerminalService(): TerminalService & { shutdown(): Promise<void> } {
  let broker: Promise<Broker> | undefined;
  let current: Broker | undefined;
  /** Consecutive failed starts against one `startKey`, and what the last of them said */
  let failing: { key: string; count: number; error: unknown } | undefined;

  const running = (): Promise<Broker> => {
    // **A broker already held is the answer, and finding one costs nothing.** Everything below decides
    // *whether and what to start*, which is the branch `??=` guards — but it ran first regardless, so every
    // session opened or taken up paid a `createRequire`, an `existsSync` of the binary, a SHA-256 of the
    // data dir with the `mkdirSync` that goes with it, and a `statSync`, to reach a promise already settled.
    if (broker) return broker;
    const binary = brokerBinary();
    const socket = socketPath();
    const key = startKey(binary, socket);
    // **A broker that cannot start is not asked again until something about the attempt changes.** Every
    // spawn here is a session the user asked for, so without this each attempt pays a process launch and a
    // readiness wait to reach the same failure — and on a binary that is missing or not executable, that is
    // every click of "new terminal" for the life of the run. What they are told is what the broker itself
    // said, which `startBroker` already collects from its stderr, rather than a message about giving up.
    if (failing && failing.key === key && failing.count >= START_ATTEMPTS) return Promise.reject(failing.error);
    broker ??= startBroker({ binary, socket, env: brokerEnvironment() })
      .then((held) => {
        // It started, so nothing is owed against this key: a later death is a crash rather than a failure to
        // start, and the lazy path below is what recovers from one
        failing = undefined;
        // **A broker that is gone must not be remembered, and forgetting it is the whole of the restart.**
        // The next session takes the branch above and starts one, which is the path a first session takes
        // anyway — so recovery is the ordinary lazy start rather than a supervisor beside it. Remembering a
        // dead one instead hands that session a destroyed socket: the request is written to nothing and its
        // answer can never come, because the close that would have refused it has already happened.
        current = held;
        held.onGone(() => {
          if (current !== held) return;
          broker = undefined;
          current = undefined;
        });
        return held;
      })
      .catch((error: unknown) => {
      // A failed start must not be remembered as a broker: the next session tries again, so a contributor
      // who builds the binary and retries is not told to restart the app. What is remembered instead is the
      // failure and what it was tried against, which is what `START_ATTEMPTS` is counted over
      broker = undefined;
      failing = { key, count: failing?.key === key ? failing.count + 1 : 1, error };
      throw error;
    });
    return broker;
  };

  return {
    async open(options, listeners: TerminalListeners): Promise<TerminalSession> {
      const held = await running();
      const { colors, ...asked } = options;
      return expose(held, await held.open(colors ? { ...asked, colors: brokerColors(colors) } : asked, listeners));
    },
    async adopt(id, listeners: TerminalListeners): Promise<TerminalSession> {
      const held = await running();
      return expose(held, await held.adopt(id, listeners));
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
      current = undefined;
      if (started) await (await started.catch(() => undefined))?.close();
    },
  };
}
