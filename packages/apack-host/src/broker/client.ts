// The app's side of the broker protocol: start the process, greet it, and turn its frames into calls and a
// feed. Host-only — a pack reaches a terminal through a session service, never through this.
//
// **Everything here is a promise, and that is the point of meeting it now.** EARS is synchronous because
// elmdb is in-process ("do NOT await"); a socket client is not, so every write, resize and kill the terminal
// feature performs becomes asynchronous, reaching its machine code and every call site that assumed sync.
// Phase S exists partly to meet that in real call sites rather than in a plan, and this is the file where it
// starts.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLogger } from '@apackdev/sdk/logger';
import { holdExclusiveLockWaiting, type ExclusiveLock } from '../exclusive-lock.ts';
// The protocol's types, generated from the broker's Rust and shipped by its package — not a copy of them.
// There was a copy here, with a script that re-derived and compared it; a package with the file in it
// leaves nothing to carry (`apack-terminal/node/protocol.ts`, `cargo xtask check-generated` there).
import type { ErrorCode, Event, Request } from 'apack-terminal';

/**
 * The protocol this client speaks. The broker refuses a connection that does not match.
 *
 * **It stays 1 through a change to what a message means.** The broker is pinned by commit
 * (`vendor/apack-terminal.rev`) and the two halves move in one change, so there is no app reading an older
 * shape to protect. What the handshake is for is a checkout whose link points at a build from before the
 * change: a refusal naming both numbers beats a message that means something else.
 */
export const PROTOCOL_VERSION = 1;

/** A refusal the broker answered with, carrying its code rather than a message to match on */
export class BrokerError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly session?: string) {
    super(message);
    this.name = 'BrokerError';
  }
}

/** The screen the broker has for a session, as its own parse of the bytes it sent */
export interface BrokerScreen {
  /** The history that was asked for, then the viewport, oldest first */
  readonly lines: readonly string[];
  /** Within the viewport, so `0` is its first line however much history came with it */
  readonly cursorRow: number;
  readonly cursorColumn: number;
  /** An alternate-screen app is showing — `vim`, `less`, a TUI agent — which has no scrollback of its own */
  readonly altScreen: boolean;
}

/**
 * What a session's shell has reported about itself, from the broker's own parse of the markers it emitted.
 *
 * **Every field is a claim, not a measurement.** A program in the pty can write any of these sequences, so
 * these say what was *said*: a `cwd` is a path some program named, not a directory this process checked, and
 * what may be done with one is the caller's decision. The broker knows the pid and the session id for
 * itself and neither is in here.
 */
export interface BrokerFacts {
  /** The working directory the shell last reported, as reported */
  readonly cwd: string | null;
  /** The command line the shell last said it was about to run */
  readonly command: string | null;
  /** Between a command starting and finishing — a busy session told apart from one at a prompt **without
   * reading the screen**, which is what the markers are for */
  readonly running: boolean;
  /** The status the last finished command reported. `null` when none has, and when a shell reported a finish
   * without one: a shell that says nothing about how a command ended is not saying it succeeded */
  readonly exitStatus: number | null;
  /**
   * Moves each time the shell reports a command it started has ended. A command that starts and ends between
   * two reads leaves `running` false at both, and this is what says one ran. Compared for a difference only:
   * it is not an exact number of commands, and it wraps
   */
  readonly finished: number;
  /**
   * **What is running in the pty, measured rather than claimed** — the one field here that is not a report
   * of what some program said.
   *
   * It is what a caller asks when the claims are empty, which for a shell with no integration installed is
   * always: whether anything is running, and what to put in a tab. `null` on Windows, which has no
   * foreground process group at all.
   */
  readonly foreground: BrokerForeground | null;
}

/** The process group reading a session's pty, as the OS reports it */
export interface BrokerForeground {
  /** The process group leader */
  readonly pid: number;
  /** Its name, or `null` when it ended between being named and being looked up */
  readonly name: string | null;
}

/** Where a search found what it was asked for */
export interface BrokerMatch {
  /** Into the lines the same request's `screen` would answer, oldest first */
  readonly line: number;
  /** Where in that line the match starts, in characters */
  readonly column: number;
  /** The whole line, so a caller sees the context without a second read */
  readonly text: string;
}

/** What a `wait` is waiting for */
export type BrokerWaitUntil =
  /**
   * No command is running. **Needs shell integration**: without the markers nothing ever reports a command
   * starting, so a session that emits none is idle from the start and this answers at once — the honest
   * answer for a shell that says nothing, rather than a guess read off the screen.
   */
  | { readonly kind: 'idle' }
  /** `text` appears in the screen or its history — the fallback for a program that reports nothing */
  | { readonly kind: 'text'; readonly text: string }
  /** The process ended */
  | { readonly kind: 'exit' };

/** How a wait ended */
export type BrokerWaitOutcome =
  /** The condition held */
  | 'MET'
  /** The deadline passed first */
  | 'TIMEOUT'
  /** The session ended before the condition held, so nothing is coming */
  | 'EXITED';

/** A signal a session's processes may be sent — a closed set, so a caller cannot name an arbitrary one */
export type BrokerSignal = 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGTERM' | 'SIGKILL';

/**
 * What a signal is sent to.
 *
 * **`group` is `kill(-pid)` and no more than that.** A shell with job control puts each background job in a
 * process group of its own, so a group signal does not reach one — `kill()` is what ends a session and
 * everything under it. What a group is for is a program the broker started directly and the children it
 * left in its own group.
 */
export type BrokerSignalScope =
  /** The process the broker started for this session */
  | { readonly kind: 'leader' }
  /** The process group it leads */
  | { readonly kind: 'group' }
  /** One process, which the broker refuses unless it is inside this session's tree */
  | { readonly kind: 'pid'; readonly pid: number };

/** One session's feed and the operations on it */
export interface BrokerSession {
  readonly id: string;
  /**
   * The process id, for a diagnostic — **`null` when the broker did not say**.
   *
   * It is answered by the frame that spawns a session and by nothing else, so a session taken up with
   * `adopt` has none. Nothing addresses a session by it (that is `id`'s job, and a pid reused by the OS is
   * exactly what F7 was), so absence costs a window only the one thing the number is for: telling the shell
   * answering now from the one whose output is above it on screen. An adopted session is the shell the
   * window already knows, so there is nothing there to tell apart.
   */
  readonly pid: number | null;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  /**
   * Stops the broker reading this session's pty, so its process feels the reader stop.
   *
   * **For a holder whose own sink is slower than a shell can write** — an image transport that has to drain
   * before the next frame. Reading this connection more slowly is not the same thing: one socket carries
   * every session, so that stalls all of them to slow one down.
   *
   * **The bytes are held by the kernel, not by the broker**: the pty's buffer fills and the process blocks
   * on its own write, so a pause is backpressure reaching the program and nothing accumulates. Two things
   * follow, and both are the contract rather than a limitation — the chunk a read already outstanding
   * returns still arrives, as it does for `node-pty`'s `pause()`, and a paused session's `screen`, `facts`
   * and `text` wait describe it as it was when it was paused. An exit is unaffected: the broker waits for
   * that on the child rather than reading it off the pty.
   */
  pause(): Promise<void>;
  /** Reads it again, and sends what arrived while it was not being read */
  resume(): Promise<void>;
  /**
   * Whether `pid` is this session's own process or something it started.
   *
   * **The same walk the broker refuses a `pid` scope with**, so what a caller reads and what it would have
   * been refused cannot disagree. A caller that walked the parent chain itself would be a second
   * implementation of the broker's own invariant — and on Windows it answers nothing, where this refuses
   * with a code a caller can tell from `false`.
   */
  owns(pid: number): Promise<boolean>;
  /**
   * Sends a signal to this session's process, its process group, or one process inside its tree.
   *
   * `kill()` ends a session and its tree, which is all a terminal needs. This is for a holder driving a
   * particular program and shutting it down the way that program documents: signal the program so the
   * servers it owns outlive its own shutdown handlers, then its group, then the group harder.
   *
   * **POSIX only.** Windows has no signals and the broker refuses with `UNSUPPORTED` rather than
   * approximating them; a pid outside this session's tree is refused with `OUTSIDE_SESSION`, which is what
   * makes naming one safe to offer at all.
   */
  signal(signal: BrokerSignal, scope: BrokerSignalScope): Promise<void>;
  /**
   * The screen as the broker has it, with up to `history` lines above the viewport.
   *
   * **It answers whether or not a window is drawing this session**, which is the gain the ownership refactor
   * is for: the broker parses the same bytes it sends and is the authority on them, so nothing here depends
   * on a renderer holding state. `history` is a ceiling and not a promise.
   */
  screen(history?: number): Promise<BrokerScreen>;
  /**
   * What this session's shell has reported about itself.
   *
   * **The read shell integration exists for**, and like `screen` it answers whether or not a window is
   * drawing the session: the markers are parsed where the bytes arrive, so a hidden session's working
   * directory and command status are known without anything being mounted.
   */
  facts(): Promise<BrokerFacts>;
  /** Where `text` appears in the screen and the `history` lines above it */
  search(text: string, history?: number): Promise<readonly BrokerMatch[]>;
  /**
   * Waits for the session to reach a state, for at most `timeoutMs`.
   *
   * **Nothing polls**: the broker checks the condition as bytes arrive, so this costs a condition check per
   * read rather than a request per tick. The answer comes exactly once however the race between the
   * condition, the deadline and the session ending goes.
   */
  wait(until: BrokerWaitUntil, timeoutMs: number): Promise<BrokerWaitOutcome>;
  kill(): Promise<void>;
}

export interface BrokerSessionListeners {
  /** Bytes the process wrote. Unprompted, and nobody asked: a feed, as the app's own rules name it */
  onOutput(data: string): void;
  /**
   * The process ended, however it ended. Delivered once.
   *
   * **A code or a signal, never both.** A shell the user quit and a program the app terminated are the same
   * `1` otherwise, so a holder cannot tell a crash it should draw a seam for from the shutdown it asked for
   * itself. Both are `null` when the session's end was inferred rather than reported — the connection went,
   * or the broker said there was no such session.
   */
  onExit(code: number | null, signal: string | null): void;
}

/**
 * The broker waited for channel credit before it could send output — the overload, reported rather than
 * silent. It is a wait and not a loss: the pty's buffer fills behind it and the process feels it, so every
 * byte still arrives. There is nothing for a caller to do about one; what it is for is being visible when a
 * terminal feels slow, which is why it is logged and not swallowed.
 *
 * **One report means the channel genuinely filled.** It did not at first: the broker timed the mutex it holds
 * to reach its credit rather than the condvar it waits on, so every flush reported itself throttled and this
 * line went into the log for each one. Driving `less` is what showed it.
 */
const logger = createLogger('broker');

/** What a session is started with */
export interface BrokerSessionOptions {
  cols: number;
  rows: number;
  shell?: string;
  /**
   * The shell's own launch arguments, in order.
   *
   * **This is how shell integration is arranged**: the markers a terminal reads facts from come from code
   * the shell runs at startup, and bash and PowerShell take that as an argument (`--init-file`, `-NoExit`)
   * where zsh and fish take it as environment. Typing it into the shell after it starts is the alternative,
   * and it echoes, races startup and has no branch for PowerShell or cmd.
   */
  args?: readonly string[];
  /** Added to the environment the broker runs in, which already has the app's own identity stripped out */
  env?: Readonly<Record<string, string>>;
  /**
   * Taken out of it, which `env` cannot express: a session inherits the broker's environment, so adding
   * entries cannot make a name absent. Applied after `env`, so absence is what a caller asking for both gets.
   */
  unset?: readonly string[];
  cwd?: string;
}

export interface Broker {
  open(options: BrokerSessionOptions, listeners: BrokerSessionListeners): Promise<BrokerSession>;
  /**
   * Takes up a session this process did not start, by its id.
   *
   * What a restarted service needs and cannot otherwise have: the sessions outlive it on purpose, and
   * without this they outlive it *unreachably* — no listener, no handle, and a fresh shell spawned beside
   * each. Refuses `NO_SUCH_SESSION` for an id that names nothing, which is how a caller tells a session that
   * survived from one that did not.
   */
  adopt(id: string, listeners: BrokerSessionListeners): Promise<BrokerSession>;
  close(): Promise<void>;
  /**
   * Runs when the connection ended without `close()` — the broker is gone, and its sessions with it.
   *
   * **What it is for is forgetting this broker**, so that the next session starts a fresh one through the
   * lazy path that already exists rather than through a second mechanism. A caller that keeps a reference
   * instead hands the next `open()` a destroyed socket, where a request is written to nothing and the answer
   * it waits for can never arrive — a hang rather than an error, since the close that would have refused it
   * has already happened. Every session's listener has been told by the time this runs.
   */
  onGone(listener: () => void): void;
  /**
   * How many lines of scrollback the broker keeps per session, from its handshake.
   *
   * **The one scrollback number, and it is the broker's because the broker is what answers for it.** An
   * emulator in this window holds whatever it was sent while attached; the broker holds this for every
   * session whether or not a window is drawing one, and a `screen` read is what a reattaching window gets.
   * Showing more than this would be showing lines that cannot survive a reattach, which is what two
   * independent constants produced — 10,000 in the pool against 1,000 in the broker, so closing and
   * reopening a window silently lost nine tenths of it.
   */
  readonly history: number;
}

interface Connection {
  send(request: Request): void;
  /**
   * Resolves with the first event the predicate accepts.
   *
   * `session` is whose refusals are this call's. A `failed` frame naming a session belongs to a call about
   * that session; one naming none is the connection's — a handshake, a spawn — and goes to whoever is
   * waiting. Without it every refusal went to `waiting.shift()`, so a dead terminal's rejected keystroke
   * could fail the unrelated `spawn` that happened to be at the head of the queue.
   *
   * `onMatch` runs **in the turn the frame is read**, before the promise settles. A promise settles in a
   * microtask and readline emits every buffered line synchronously, so anything done after the `await` is
   * done too late for a frame that arrived in the same read: a shell that dies instantly sends `spawned`
   * and `exited` microseconds apart, and a listener registered after the await never heard the exit.
   */
  next(accept: (event: Event) => boolean, options?: { session?: string; onMatch?: (event: Event) => void }): Promise<Event>;
  /**
   * Leaves without ending the sessions, so the close that follows is expected.
   *
   * **The distinction this draws is the whole of what makes a synthesised exit honest.** A connection
   * closing means two opposite things: this client chose to leave, and the sessions carry on under whoever
   * holds them; or the broker is gone, and every session with it. Only the first is knowable here, so it is
   * recorded rather than inferred — the same shape as `ProcessManager.stop()` removing its exit handlers
   * before it signals, so a deliberate replacement is not counted as a crash.
   */
  leave(): void;
  /**
   * Tears this connection down, for one that must not be left open.
   *
   * **Not `leave`.** Leaving is a graceful half-close meaning *this client chose to go*, and it keeps the
   * reader attached; a refused handshake is not a departure but a connection that was never usable. The
   * broker counts connections **from the accept rather than the handshake** and exits only at zero, so one
   * left open keeps it alive for ever — and a caller that retries adds another each time, which is the
   * stray-broker leak the lifetime hold exists to prevent.
   */
  destroy(): void;
}

/**
 * Starts a broker on `binary`, listening on `socket`, and greets it.
 *
 * **It waits for the broker's ready line rather than retrying a connect.** The broker prints where it is
 * listening before its first accept, so a parent knows when to connect; retrying would turn a broker that
 * failed to start into a timeout rather than an error.
 */
/** How to reach the broker: where it listens, and the binary to start if nothing is there yet */
export interface BrokerOptions {
  binary: string;
  socket: string;
  env?: NodeJS.ProcessEnv;
  /**
   * How long the broker has to say where it is listening, and a connection to be accepted.
   *
   * A parameter for the reason `socketPath`'s platform is one: the bound is the subject, and a case about it
   * must be able to reach it without waiting out a figure chosen for a loaded machine.
   */
  startMs?: number;
}

/**
 * **One broker per data dir, so this connects to a running one before it starts another.**
 *
 * Which process gets there first is not fixed and must not matter: in the app it is Electron main, which
 * starts the broker before any window and holds its lifetime; everywhere else — a dev run, the CLI, a test
 * — it is whoever first wants a session. Both arrive here, and the second one finds a broker listening.
 *
 * Starting a second would be worse than a wasted process: the broker takes its socket with
 * `try_overwrite`, since a path a previous run left behind must not refuse the bind, so a second broker
 * would take the address and leave the first one's sessions unreachable with no error anywhere.
 */
/**
 * How many of the broker's stderr chunks are kept for its failure message.
 *
 * Enough for a panic with its backtrace, which is what this is read for, and a ceiling rather than a
 * measurement: what it exists to stop is a broker that logs steadily being accumulated for the life of the
 * app by a reader that only ever wants its last words.
 */
const STDERR_CHUNKS_KEPT = 50;

/**
 * The starts this process has in flight, by socket.
 *
 * **The file lock cannot serve this half.** `holdExclusiveLock` is deliberately not re-entrant — a second
 * take in one process is refused naming that same pid — so two callers here would both be told no and both
 * fall through to connecting, which is the race again with an extra step. Electron main holding the lifetime
 * connection while the API opens its first session is exactly two callers in one process when they share
 * one, and a test that drives both is another. So in-process callers wait on one start, and the lock keeps
 * *processes* apart.
 */
const starting = new Map<string, Promise<void>>();

async function reach(options: BrokerOptions): Promise<net.Socket> {
  const listening = await connect(options.socket, options.startMs).catch(() => undefined);
  if (listening) return listening;

  let pending = starting.get(options.socket);
  if (!pending) {
    pending = ensureListening(options).finally(() => { starting.delete(options.socket); });
    starting.set(options.socket, pending);
  }
  await pending;
  return connect(options.socket, options.startMs);
}

/**
 * Registers a session's feed, held until whoever asked for the session is holding it.
 *
 * **A frame can arrive before the call that asked for the session has returned.** The broker answers
 * `spawned` and the shell's `exited` in one read — a bad `--init-file`, `cmd /K` on a missing script — and
 * readline delivers both in that turn, so a listener registered as the first frame is read is called while
 * its caller is still inside `await`. Every holder then had to hold the exit for itself until it had
 * somewhere to put it, and a holder that forgot recorded a session that had already gone as live.
 *
 * So the registration happens on the frame, which is what keeps the exit from being lost, and the delivery
 * waits for the holder: `setImmediate` runs after the microtask queue, and a holder's work between `await`
 * and its own next `await` is in that queue. The feed is in order either way, since the queue is drained in
 * the order it was filled.
 *
 * An exit that arrived while held is not re-registered — the session is over, and `frames` has already
 * forgotten it.
 */
function heldFeed(
  listeners: Map<string, BrokerSessionListeners>,
  id: string,
  holder: BrokerSessionListeners,
): () => void {
  const queued: Array<() => void> = [];
  let ended = false;
  const held: BrokerSessionListeners = {
    onOutput: (text) => { queued.push(() => holder.onOutput(text)); },
    onExit: (code, signal) => { ended = true; queued.push(() => holder.onExit(code, signal)); },
  };
  listeners.set(id, held);
  return () => {
    if (!ended && listeners.get(id) === held) listeners.set(id, holder);
    for (const deliver of queued.splice(0)) deliver();
  };
}

/** The prefix every Windows pipe address carries, which is a namespace rather than a directory */
const PIPE_PREFIX = '\\\\.\\pipe\\';

/**
 * Where the exclusive start lock goes for a broker listening on `socket`.
 *
 * **The socket cannot carry it on Windows.** There the address is a named pipe, `\\.\pipe\<name>`, and that
 * is a kernel namespace and not a directory: nothing can create `\\.\pipe\<name>.start.lock`, so the `wx`
 * take fails with something other than `EEXIST` on every attempt, the waiter spends its whole window
 * retrying and then throws, and the caller connects to a broker nobody started. A pipe's name is already
 * unique per data dir, so the lock takes that name in the temporary directory instead.
 */
function startLockFile(socket: string): string {
  if (!socket.startsWith(PIPE_PREFIX)) return `${socket}.start.lock`;
  return path.join(os.tmpdir(), `${socket.slice(PIPE_PREFIX.length)}.start.lock`);
}

/**
 * Makes sure a broker is listening on this socket, starting one if nothing is.
 *
 * **Starting one is exclusive, and that is not an optimisation.** The broker binds its socket with
 * `try_overwrite`, so a second one takes the address and leaves the first one's sessions unreachable with no
 * error anywhere. Finding nothing listening and then spawning is a check followed by an act, and the gap
 * between them is a whole broker startup — so the lock is held across the spawn *and* the wait, not merely
 * around the spawn. Processes reach here together routinely: Electron main takes its lifetime hold while the
 * API server starts in the same tick (`ModuleRunner` calls every module's `enable` eagerly and chains only
 * the awaiting), and every dev API reload is another.
 *
 * Keyed on the socket, so suites with a socket each never wait on one another.
 */
async function ensureListening(options: BrokerOptions): Promise<void> {
  let lock: ExclusiveLock;
  try {
    lock = await holdExclusiveLockWaiting({
      file: startLockFile(options.socket),
      what: 'starting the terminal broker',
      wait: true,
      refuse: (holder) => new Error(`another process is starting the terminal broker (${holder})`),
    });
  } catch {
    // Given up on rather than refused: whoever holds it stopped working while starting the broker, so whatever
    // is on that socket now is what the caller should connect to. Throwing here would report a failure to start
    // where there may be one running.
    return;
  }

  try {
    // The winner may be the second to arrive, in which case another process has already started one
    const started = await connect(options.socket, options.startMs).catch(() => undefined);
    // The probe is not the caller's socket — each caller connects for itself once this resolves
    if (started) { started.destroy(); return; }
    await start(options);
  } finally {
    lock.release();
  }
}

async function start(options: BrokerOptions): Promise<void> {
  // **Detached, and its handle released.** The broker outlives whoever started it by design — that is the
  // whole point of a session surviving an API restart — so it must not be in this process's group, where
  // the shell's Ctrl-C would reach it, and this process must not be kept alive waiting for it.
  const process_ = spawn(options.binary, [options.socket], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env,
    detached: true,
  });
  const stderr: string[] = [];
  process_.stderr?.on('data', chunk => {
    stderr.push(String(chunk));
    // Bounded, because this is read whenever the broker ends rather than only while it is starting, and a
    // broker that writes to stderr for an hour must not be kept in memory for the sake of its first line
    if (stderr.length > STDERR_CHUNKS_KEPT) stderr.splice(0, stderr.length - STDERR_CHUNKS_KEPT);
  });
  try {
    await ready(process_, stderr, options.startMs);
  } catch (error) {
    // **A broker that never reported listening is this function's to clean up.** It was spawned detached and
    // its handle is dropped here, so nothing else can reach it again: left running it holds the socket path
    // the next attempt will try to bind, and its pipes would keep this process alive with nobody reading
    // them. The caller retries, so each abandoned child would otherwise be a permanent one.
    process_.stdout?.destroy();
    process_.stderr?.destroy();
    // **The reap is said out loud, because the error the caller throws cannot say it.** `ready` words why the
    // start failed and carries the broker's last words; what it has no way to mention is that a child was
    // killed here. That matters now the service bounds its attempts (`START_ATTEMPTS`): someone hitting a
    // broker that will not start sees three failures, and without this nothing tells them the processes
    // behind them were not left running.
    //
    // Only when it was still running. A broker that exited before listening is what the thrown error is
    // already about, and a second line claiming a kill would contradict it — `exitCode`/`signalCode` are
    // both set by then, since that exit is what `ready` failed on.
    //
    // Nothing asserts this line: `client.spec.ts` drives this function but binds no app, so its logger
    // writes to the console rather than anywhere a case could read.
    const running = process_.exitCode === null && process_.signalCode === null;
    process_.kill();
    process_.unref();
    if (running) logger.warn(`the broker (${process_.pid ?? 'pid unknown'}) never reported listening and was killed`);
    throw error;
  }

  // **The handle is kept, so a broker that dies leaves a cause and not only a consequence.** `unref` stops
  // it holding this process open; it does not stop this process hearing about it. Without this the sole
  // trace of a crash was a socket closing, which says what happened to the connection and nothing about
  // why — and the stderr collected above had no reader once the ready line had arrived.
  // Its last words in the message rather than beside it, as `ready` already words a failure to start
  process_.once('exit', (code, signal) => {
    const said = stderr.join('').trim();
    logger.warn(`the broker exited (${signal ?? `status ${code}`})${said ? `: ${said}` : ''}`);
  });
  // **The pipes are released too, and `unref` on the child does not do it.** `ChildProcess.unref` releases
  // the process handle; `stdout` and `stderr` are separate libuv handles, and a flowing one holds the event
  // loop open on its own. The stderr listener above stays subscribed, because it is read whenever the broker
  // ends — unreferenced, so a short-lived process that happened to win the start still exits on its own.
  // `ready` resolving is the broker's own word that it is listening, so there is nothing to confirm here:
  // whoever asked for this connects for itself
  process_.unref();
  unrefPipe(process_.stdout);
  unrefPipe(process_.stderr);
}

/**
 * Releases a child's pipe from the event loop.
 *
 * A piped `stdio` is a socket, which is what carries `unref` — `Readable`, the type the child exposes it as,
 * does not say so. Asked for rather than asserted, so a stream that is genuinely not one is left alone.
 */
function unrefPipe(stream: unknown): void {
  (stream as { unref?: () => void } | null)?.unref?.();
}

/**
 * The broker's answer to a greeting, within `startMs`.
 *
 * **A connection that is accepted and never answered is the one shape that has no end of its own.** The
 * socket is up, so nothing errors and nothing closes; the greeting's waiter simply never settles, and with
 * it every `open()` behind the one lazy start — a hang rather than a refusal, so the caller's `catch` never
 * runs and no attempt is ever counted against the budget. It is the same case `ready()` bounds on the other
 * stream, for the same reason. Whoever catches this destroys the connection, which refuses the waiter left
 * behind.
 */
function greetingWithin(connection: Connection, startMs = BROKER_START_MS): Promise<Event> {
  let deadline: NodeJS.Timeout | undefined;
  return Promise.race([
    connection.next(event => event.kind === 'hello'),
    new Promise<never>((_, refuse) => {
      deadline = setTimeout(
        () => refuse(new Error(`the broker accepted a connection and did not answer the greeting within ${startMs}ms`)),
        startMs,
      );
      deadline.unref();
    }),
  ]).finally(() => { clearTimeout(deadline); });
}

/**
 * Holds the broker's sessions open for as long as this process lives.
 *
 * **The app's own process holds this and nothing else does.** Every session the broker owns ends when this
 * connection closes, which a descriptor does on process death however the process died — quit, crash or
 * kill — so there is no shutdown handler to skip. It asks for nothing and is sent nothing, so holding it
 * costs one socket.
 */
export async function holdBrokerSessions(options: BrokerOptions): Promise<{ close(): void }> {
  const socket = await reach(options);
  // **The answer is read, because a refused hold is silent otherwise.** This greeting can be refused — a
  // broker speaking another protocol answers `failed` with `HANDSHAKE` — and a caller that only wrote would
  // report success while the sessions it believes it owns have no owner at all, which is exactly the state
  // this function exists to prevent. After the greeting nothing more is read: an owner receives no events,
  // and a socket with no reader would fill.
  const greeted = frames(socket, new Map());
  greeted.send({ kind: 'hello', protocol: PROTOCOL_VERSION, role: 'lifetime' });
  // **Torn down on every way out, not only on a version mismatch.** A broker speaking another protocol
  // answers `failed` rather than `hello`, which rejects this await instead of reaching the check below — so
  // a `destroy` on that branch alone leaves the commonest refusal holding a connection open for ever
  let greeting: Event;
  try {
    greeting = await greetingWithin(greeted, options.startMs);
  } catch (error) {
    greeted.destroy();
    throw error;
  }
  if (greeting.kind !== 'hello' || greeting.protocol !== PROTOCOL_VERSION) {
    greeted.destroy();
    throw new BrokerError('HANDSHAKE', `the broker speaks protocol ${greeting.kind === 'hello' ? greeting.protocol : '(none)'}; this app speaks ${PROTOCOL_VERSION}`);
  }
  socket.resume();
  socket.on('error', () => {});
  // **The hold must not keep its process alive.** It is a backstop on the app's lifetime, not a reason for
  // the app to have one: a referenced socket would stop Node exiting when everything else had finished.
  socket.unref();
  return { close: () => { socket.destroy(); } };
}

export async function startBroker(options: BrokerOptions): Promise<Broker> {
  const socket = await reach(options);
  const listeners = new Map<string, BrokerSessionListeners>();
  const gone = new Set<() => void>();
  const connection = frames(socket, listeners, () => { for (const listener of gone) listener(); });

  connection.send({ kind: 'hello', protocol: PROTOCOL_VERSION, role: 'client' });
  // As in `holdBrokerSessions`: a refusal rejects the await rather than arriving as a `hello`, and either
  // way this connection is unusable and must not be left counted
  let greeting: Event;
  try {
    greeting = await greetingWithin(connection, options.startMs);
    if (greeting.kind === 'hello' && greeting.protocol !== PROTOCOL_VERSION) {
      throw new BrokerError('HANDSHAKE', `the broker speaks protocol ${greeting.protocol}; this app speaks ${PROTOCOL_VERSION}`);
    }
  } catch (error) {
    connection.destroy();
    throw error;
  }
  const history = greeting.kind === 'hello' ? greeting.history : 0;

  /**
   * One session as its holder operates it, over this connection.
   *
   * Shared by `open` and `adopt` because what you can do with a session has nothing to do with how you came
   * to hold it: a copy per route is two places for a request kind to be forgotten.
   */
  const sessionHandle = (id: string, pid: number | null): BrokerSession => ({
      id,
      pid,
      async write(text) { connection.send({ kind: 'write', session: id, text }); },
      async resize(cols_, rows_) { connection.send({ kind: 'resize', session: id, cols: cols_, rows: rows_ }); },
      async pause() { connection.send({ kind: 'pause', session: id }); },
      async resume() { connection.send({ kind: 'resume', session: id }); },
      async owns(pid) {
        connection.send({ kind: 'owns', session: id, pid });
        // **Keyed by the pid as well as the session**, because a session can have more than one of these
        // outstanding: the frames carry no call, and an answer taken for another pid's is a claim admitted
        // or refused wrongly
        const answer = await connection.next(
          event => event.kind === 'owns' && event.session === id && event.pid === pid,
          { session: id },
        );
        if (answer.kind !== 'owns') throw new BrokerError('PTY', 'the broker answered no ownership');
        return answer.owned;
      },
      async signal(signal, scope) { connection.send({ kind: 'signal', session: id, signal, scope }); },
      async screen(history = 0) {
        connection.send({ kind: 'screen', session: id, history });
        // Keyed by the session, because two of these can be outstanding and an answer must not be taken
        // for the other one's — the broker answers per request and the frames carry no call of their own
        const answer = await connection.next(event => event.kind === 'screen' && event.session === id, { session: id });
        if (answer.kind !== 'screen') throw new BrokerError('PTY', 'the broker answered no screen');
        return {
          lines: answer.lines,
          cursorRow: answer.cursor_row,
          cursorColumn: answer.cursor_column,
          altScreen: answer.alt_screen,
        };
      },
      async facts() {
        connection.send({ kind: 'facts', session: id });
        const answer = await connection.next(event => event.kind === 'facts' && event.session === id, { session: id });
        if (answer.kind !== 'facts') throw new BrokerError('PTY', 'the broker answered no facts');
        return {
          cwd: answer.cwd,
          command: answer.command,
          running: answer.running,
          exitStatus: answer.exit_status,
          finished: answer.finished,
          foreground: answer.foreground ?? null,
        };
      },
      async search(text, history = 0) {
        connection.send({ kind: 'search', session: id, text, history });
        const answer = await connection.next(event => event.kind === 'search' && event.session === id, { session: id });
        if (answer.kind !== 'search') throw new BrokerError('PTY', 'the broker answered no search');
        return answer.matches;
      },
      async wait(until, timeoutMs) {
        connection.send({ kind: 'wait', session: id, until, timeout_ms: timeoutMs });
        // **The deadline is the broker's**, so this waits for its answer rather than racing a timer of its
        // own: two deadlines would disagree, and the one that matters is the one holding the waiter
        const answer = await connection.next(event => event.kind === 'waited' && event.session === id, { session: id });
        if (answer.kind !== 'waited') throw new BrokerError('PTY', 'the broker answered no wait');
        return answer.outcome;
      },
      async kill() { connection.send({ kind: 'kill', session: id }); },
  });

  return {
    history,
    async open({ cols, rows, shell, args, env, unset, cwd }, sessionListeners) {
      connection.send({
        kind: 'spawn',
        cols,
        rows,
        shell: shell ?? null,
        args: [...args ?? []],
        env: Object.entries(env ?? {}),
        unset: [...unset ?? []],
        cwd: cwd ?? null,
      });
      // Registered as the frame is read, so an `exited` in the same read is not lost; delivered once this
      // call's caller is holding the session (`heldFeed`)
      let release: (() => void) | undefined;
      const spawned = await connection.next(
        event => event.kind === 'spawned',
        { onMatch: event => { if (event.kind === 'spawned') release = heldFeed(listeners, event.session, sessionListeners); } },
      );
      if (spawned.kind !== 'spawned') throw new BrokerError('PTY', 'the broker answered no session');
      const handle = sessionHandle(spawned.session, spawned.pid);
      if (release) setImmediate(release);
      return handle;
    },
    /**
     * Takes up a session this process did not start.
     *
     * **One feed slot is what makes this possible at all.** The broker writes every event to whichever
     * client greeted last, so a surviving session's output already arrives on this connection — what a
     * restarted process lacks is nothing but the mapping from session id to listener, which `open` would
     * have made from the `spawned` frame it never saw. There is no attach request to send and none is
     * needed.
     *
     * **The session is asked after before it is claimed**, because the id came from outside this process and
     * may name a session that is gone — a full app restart ends them all, so after one every stored id is
     * stale. A broker that has no such session refuses with `NO_SUCH_SESSION` and the listener is never
     * registered, which is the caller's signal to start a shell instead. Registered on the frame as it is
     * read, for the same reason `open` does it there.
     */
    async adopt(id, sessionListeners) {
      connection.send({ kind: 'facts', session: id });
      let release: (() => void) | undefined;
      const answer = await connection.next(
        event => event.kind === 'facts' && event.session === id,
        { session: id, onMatch: () => { release = heldFeed(listeners, id, sessionListeners); } },
      );
      if (answer.kind !== 'facts') throw new BrokerError('PTY', 'the broker answered no facts');
      // **No pid, because the broker does not answer one for a session it did not just spawn.** It is a
      // diagnostic the window uses to tell one shell from the next, and an adopted session *is* the shell
      // the window already knows — so saying nothing is the true answer, and inventing one would draw a
      // seam across a session that never ended.
      const taken = sessionHandle(id, null);
      if (release) setImmediate(release);
      return taken;
    },
    /**
     * Leaves the broker, without ending it.
     *
     * **This used to kill the process, and killing it is now exactly wrong**: the sessions outlive this
     * connection on purpose, so that restarting the service that opened them does not take a user's shells
     * down. What ends them is the owner's connection closing (`holdBrokerSessions`) — and with no owner,
     * the broker's own rule that the last client leaving ends them, which is what keeps a dev run or a test
     * from leaving anything behind.
     */
    async close() {
      connection.leave();
    },
    onGone(listener) { gone.add(listener); },
  };
}

/**
 * How long a broker has to say where it is listening, and a connection to be accepted.
 *
 * **A bound rather than a guess at how long starting takes.** The broker prints its line before its first
 * accept, so the figure is slack for a loaded machine and not a measurement — what it is here for is the
 * case that otherwise has no end: a broker that starts, stays alive and prints nothing to stdout, which is
 * what a listening line written to stderr looks like from here. Without it the promise never settled, so the
 * caller's own `catch` never ran: `holdTerminalSessionsForTheApp` logs a failure and carries on, and a hang
 * is the one shape that silences it.
 */
const BROKER_START_MS = 10_000;

/** The broker's ready line, or the reason it never came */
function ready(process_: ChildProcess, stderr: string[], startMs = BROKER_START_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: process_.stdout! });
    const said = (why: string) => `${why}${stderr.length > 0 ? `: ${stderr.join('').trim()}` : ''}`;
    const deadline = setTimeout(
      () => reject(new Error(said(`the broker did not say where it was listening within ${startMs}ms`))),
      startMs,
    );
    deadline.unref();
    // **The reader is closed however this ends.** `createInterface` puts the child's stdout into flowing
    // mode, which is a referenced handle that outlives this promise: left open it keeps the process alive
    // after everything else has finished, which is what made the deliberate `socket.unref()` in
    // `holdBrokerSessions` buy nothing in whichever process won the start.
    const settle = (run: () => void) => { clearTimeout(deadline); lines.close(); run(); };
    const fail = (why: string) => settle(() => reject(new Error(said(why))));
    lines.once('line', line => {
      if (line.startsWith('listening ')) settle(resolve);
      else fail(`the broker's first line was ${JSON.stringify(line)} rather than its socket`);
    });
    process_.once('error', error => fail(`the broker could not be started (${error.message})`));
    process_.once('exit', code => fail(`the broker exited with ${code} before it was listening`));
  });
}

function connect(path: string, startMs = BROKER_START_MS): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    // A refused connection errors at once; one that is accepted and never completed does not, which is the
    // same shape as the broker that prints nothing and wants the same answer
    const deadline = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no answer from the broker at ${path} within ${startMs}ms`));
    }, startMs);
    deadline.unref();
    socket.once('connect', () => { clearTimeout(deadline); resolve(socket); });
    socket.once('error', error => { clearTimeout(deadline); reject(error); });
  });
}

/**
 * Newline-delimited frames both ways. **A session's feed goes to its listener and never through `next`**:
 * output is news, so a reader waiting for an answer must not consume it, and a correlated answer must not be
 * lost behind a burst of it.
 */
function frames(socket: net.Socket, listeners: Map<string, BrokerSessionListeners>, onGone?: () => void): Connection {
  let leaving = false;
  const waiting: Array<{ accept: (event: Event) => boolean; settle: (event: Event) => void; refuse: (error: Error) => void; session?: string; onMatch?: (event: Event) => void }> = [];
  const lines = createInterface({ input: socket });
  // An abandoned socket still raises `error` — an `ECONNRESET` from a broker that hung up on a refused
  // handshake is the case — and an unhandled one on a `net.Socket` ends the process. What a connection does
  // about a failure it reports through `close`, which refuses every waiter below
  socket.on('error', () => {});

  lines.on('line', line => {
    if (line.trim() === '') return;
    let event: Event;
    try { event = JSON.parse(line) as Event; } catch { return; }

    if (event.kind === 'output') {
      listeners.get(event.session)?.onOutput(event.text);
      return;
    }
    if (event.kind === 'exited') {
      const listener = listeners.get(event.session);
      listeners.delete(event.session);
      listener?.onExit(event.code, event.signal ?? null);
      return;
    }
    if (event.kind === 'throttled') {
      logger.warn(`the terminal channel was full: a flush waited ${event.waited_us}µs`, { session: event.session });
      return;
    }
    if (event.kind === 'failed') {
      const error = new BrokerError(event.code, event.message, event.session ?? undefined);
      // **Matched, as an answer is.** A refusal naming a session is the answer to a call about that session,
      // and `write`, `resize` and `kill` wait for nothing — so a refusal of one of those has no caller, and
      // reporting it is all there is to do. Shifting the queue instead rejected whoever happened to be at
      // its head, which is a call about another session being told it failed.
      // A refusal naming no session is the connection's — a handshake, a spawn — so it belongs to a call
      // that named none either. Taking the head instead rejected whoever was there: with a `screen` in
      // flight and a `spawn` refused, the screen's caller was told the spawn's failure and the `open` it
      // was really about waited for an answer that had already been consumed.
      const index = event.session == null
        ? waiting.findIndex(one => one.session === undefined)
        : waiting.findIndex(one => one.session === event.session);
      if (index >= 0) waiting.splice(index, 1)[0]!.refuse(error);
      else if (event.code !== 'NO_SUCH_SESSION') {
        logger.warn(`the broker refused ${event.code}, which no call was waiting for`, { session: event.session, message: event.message });
      }

      // **`NO_SUCH_SESSION` is the broker saying this app's record is stale, which is news whoever asked.**
      // The app keeps its own account of which sessions are live, and that account can be wrong — a frame
      // missed, a broker replaced, a bug not yet found — in which case every later call about that session
      // is refused the same way for ever and the terminal above it can never be closed. Reporting it as the
      // session's end puts the app back in step on the next thing it tries, so a divergence costs one
      // refused request instead of wedging.
      //
      // Delivered exactly as an `exited` frame is, because that is what it means and the app already models
      // it: `null` is the honest code, the session having ended without this process seeing a status.
      if (event.code === 'NO_SUCH_SESSION' && event.session != null) {
        const listener = listeners.get(event.session);
        listeners.delete(event.session);
        listener?.onExit(null, null);
      }
      return;
    }
    const index = waiting.findIndex(one => one.accept(event));
    if (index >= 0) {
      const matched = waiting.splice(index, 1)[0]!;
      // Synchronously, so a frame later in this same read finds whatever the match set up
      matched.onMatch?.(event);
      matched.settle(event);
    }
  });

  const ended = new Error('the broker connection ended');
  socket.once('close', () => {
    while (waiting.length > 0) waiting.shift()!.refuse(ended);
    if (leaving) return;

    // **The broker is gone, and every session with it.** A pty dies with the process that owns it, so none
    // of these sessions can be reached again — and saying nothing leaves a terminal drawn as live in front of
    // a shell that no longer exists, which is the one state worse than reporting the death. An `exited` frame
    // is how a single shell's end arrives, so each session is reported the same way and lands in the state the
    // app already models for it: a shell that died badly, its terminal kept and its transcript labelled.
    //
    // `null` is the honest code rather than a sentinel. The session ended without a status, the kernel having
    // reaped it when its owner died — which is what `null` means everywhere else on this listener, and what
    // the window already words as *"without a status (a signal)"*.
    //
    // Taken first, because a listener may open a terminal again and must not find a stale entry.
    const held = [...listeners.values()];
    listeners.clear();
    for (const listener of held) listener.onExit(null, null);
    onGone?.();
  });

  return {
    send(request) { socket.write(`${JSON.stringify(request)}\n`); },
    next(accept, options) {
      return new Promise<Event>((settle, refuse) => {
        waiting.push({ accept, settle, refuse, session: options?.session, onMatch: options?.onMatch });
      });
    },
    leave() {
      leaving = true;
      socket.end();
    },
    destroy() {
      // `leaving` first, so the close this causes reports no sessions gone: a connection that never greeted
      // holds none, and synthesising an exit for each would be inventing news
      leaving = true;
      lines.close();
      socket.destroy();
    },
  };
}
