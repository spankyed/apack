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
import { createLogger } from '@apackdev/sdk/logger';
import type { ErrorCode, Event, Request } from './protocol.ts';

/** The protocol this client speaks. The broker refuses a connection that does not match. */
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

/** One session's feed and the operations on it */
export interface BrokerSession {
  readonly id: string;
  readonly pid: number;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
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
  /** The process ended, however it ended. Delivered once */
  onExit(code: number | null): void;
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
  cwd?: string;
}

export interface Broker {
  open(options: BrokerSessionOptions, listeners: BrokerSessionListeners): Promise<BrokerSession>;
  close(): Promise<void>;
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
   */
  next(accept: (event: Event) => boolean, session?: string): Promise<Event>;
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
async function reach(options: BrokerOptions): Promise<net.Socket> {
  const listening = await connect(options.socket).catch(() => undefined);
  if (listening) return listening;

  // **Detached, and its handle released.** The broker outlives whoever started it by design — that is the
  // whole point of a session surviving an API restart — so it must not be in this process's group, where
  // the shell's Ctrl-C would reach it, and this process must not be kept alive waiting for it.
  const process_ = spawn(options.binary, [options.socket], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env,
    detached: true,
  });
  const stderr: string[] = [];
  process_.stderr?.on('data', chunk => { stderr.push(String(chunk)); });
  await ready(process_, stderr);
  process_.unref();
  return connect(options.socket);
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
  socket.write(`${JSON.stringify({ kind: 'hello', protocol: PROTOCOL_VERSION, role: 'lifetime' })}\n`);
  // Nothing is read: an owner receives no events, and a socket with no reader would otherwise fill
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
  const connection = frames(socket, listeners);

  connection.send({ kind: 'hello', protocol: PROTOCOL_VERSION, role: 'client' });
  const greeting = await connection.next(event => event.kind === 'hello');
  if (greeting.kind === 'hello' && greeting.protocol !== PROTOCOL_VERSION) {
    throw new BrokerError('HANDSHAKE', `the broker speaks protocol ${greeting.protocol}; this app speaks ${PROTOCOL_VERSION}`);
  }

  return {
    async open({ cols, rows, shell, args, env, cwd }, sessionListeners) {
      connection.send({
        kind: 'spawn',
        cols,
        rows,
        shell: shell ?? null,
        args: [...args ?? []],
        env: Object.entries(env ?? {}),
        cwd: cwd ?? null,
      });
      const spawned = await connection.next(event => event.kind === 'spawned');
      if (spawned.kind !== 'spawned') throw new BrokerError('PTY', 'the broker answered no session');
      listeners.set(spawned.session, sessionListeners);
      const id = spawned.session;
      return {
        id,
        pid: spawned.pid,
        async write(data) { connection.send({ kind: 'write', session: id, data }); },
        async resize(cols_, rows_) { connection.send({ kind: 'resize', session: id, cols: cols_, rows: rows_ }); },
        async screen(history = 0) {
          connection.send({ kind: 'screen', session: id, history });
          // Keyed by the session, because two of these can be outstanding and an answer must not be taken
          // for the other one's — the broker answers per request and the frames carry no call of their own
          const answer = await connection.next(event => event.kind === 'screen' && event.session === id, id);
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
          const answer = await connection.next(event => event.kind === 'facts' && event.session === id, id);
          if (answer.kind !== 'facts') throw new BrokerError('PTY', 'the broker answered no facts');
          return {
            cwd: answer.cwd,
            command: answer.command,
            running: answer.running,
            exitStatus: answer.exit_status,
          };
        },
        async search(text, history = 0) {
          connection.send({ kind: 'search', session: id, text, history });
          const answer = await connection.next(event => event.kind === 'search' && event.session === id, id);
          if (answer.kind !== 'search') throw new BrokerError('PTY', 'the broker answered no search');
          return answer.matches;
        },
        async wait(until, timeoutMs) {
          connection.send({ kind: 'wait', session: id, until, timeout_ms: timeoutMs });
          // **The deadline is the broker's**, so this waits for its answer rather than racing a timer of its
          // own: two deadlines would disagree, and the one that matters is the one holding the waiter
          const answer = await connection.next(event => event.kind === 'waited' && event.session === id, id);
          if (answer.kind !== 'waited') throw new BrokerError('PTY', 'the broker answered no wait');
          return answer.outcome;
        },
        async kill() { connection.send({ kind: 'kill', session: id }); },
      };
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
      socket.end();
    },
  };
}

/** The broker's ready line, or the reason it never came */
function ready(process_: ChildProcess, stderr: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: process_.stdout! });
    const fail = (why: string) => reject(new Error(`${why}${stderr.length > 0 ? `: ${stderr.join('').trim()}` : ''}`));
    lines.once('line', line => {
      if (line.startsWith('listening ')) resolve();
      else fail(`the broker's first line was ${JSON.stringify(line)} rather than its socket`);
    });
    process_.once('error', error => fail(`the broker could not be started (${error.message})`));
    process_.once('exit', code => fail(`the broker exited with ${code} before it was listening`));
  });
}

function connect(path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * Newline-delimited frames both ways. **A session's feed goes to its listener and never through `next`**:
 * output is news, so a reader waiting for an answer must not consume it, and a correlated answer must not be
 * lost behind a burst of it.
 */
function frames(socket: net.Socket, listeners: Map<string, BrokerSessionListeners>): Connection {
  const waiting: Array<{ accept: (event: Event) => boolean; settle: (event: Event) => void; refuse: (error: Error) => void; session?: string }> = [];
  const lines = createInterface({ input: socket });

  lines.on('line', line => {
    if (line.trim() === '') return;
    let event: Event;
    try { event = JSON.parse(line) as Event; } catch { return; }

    if (event.kind === 'output') {
      listeners.get(event.session)?.onOutput(event.data);
      return;
    }
    if (event.kind === 'exited') {
      const listener = listeners.get(event.session);
      listeners.delete(event.session);
      listener?.onExit(event.code);
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
      const index = event.session == null
        ? (waiting.length > 0 ? 0 : -1)
        : waiting.findIndex(one => one.session === event.session);
      if (index >= 0) { waiting.splice(index, 1)[0]!.refuse(error); return; }
      logger.warn(`the broker refused ${event.code}, which no call was waiting for`, { session: event.session, message: event.message });
      return;
    }
    const index = waiting.findIndex(one => one.accept(event));
    if (index >= 0) waiting.splice(index, 1)[0]!.settle(event);
  });

  const ended = new Error('the broker connection ended');
  socket.once('close', () => { while (waiting.length > 0) waiting.shift()!.refuse(ended); });

  return {
    send(request) { socket.write(`${JSON.stringify(request)}\n`); },
    next(accept, session) {
      return new Promise<Event>((settle, refuse) => { waiting.push({ accept, settle, refuse, session }); });
    },
  };
}
