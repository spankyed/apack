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
 */
const logger = createLogger('broker');

export interface Broker {
  open(options: { cols: number; rows: number; shell?: string; cwd?: string }, listeners: BrokerSessionListeners): Promise<BrokerSession>;
  close(): Promise<void>;
}

interface Connection {
  send(request: Request): void;
  /** Resolves with the first event the predicate accepts, or rejects with a `Failed` that names no session */
  next(accept: (event: Event) => boolean): Promise<Event>;
}

/**
 * Starts a broker on `binary`, listening on `socket`, and greets it.
 *
 * **It waits for the broker's ready line rather than retrying a connect.** The broker prints where it is
 * listening before its first accept, so a parent knows when to connect; retrying would turn a broker that
 * failed to start into a timeout rather than an error.
 */
export async function startBroker(options: { binary: string; socket: string; env?: NodeJS.ProcessEnv }): Promise<Broker> {
  const process_ = spawn(options.binary, [options.socket], { stdio: ['ignore', 'pipe', 'pipe'], env: options.env });
  const stderr: string[] = [];
  process_.stderr?.on('data', chunk => { stderr.push(String(chunk)); });

  await ready(process_, stderr);
  const socket = await connect(options.socket);
  const listeners = new Map<string, BrokerSessionListeners>();
  const connection = frames(socket, listeners);

  connection.send({ kind: 'hello', protocol: PROTOCOL_VERSION });
  const greeting = await connection.next(event => event.kind === 'hello');
  if (greeting.kind === 'hello' && greeting.protocol !== PROTOCOL_VERSION) {
    throw new BrokerError('HANDSHAKE', `the broker speaks protocol ${greeting.protocol}; this app speaks ${PROTOCOL_VERSION}`);
  }

  return {
    async open({ cols, rows, shell, cwd }, sessionListeners) {
      connection.send({ kind: 'spawn', cols, rows, shell: shell ?? null, cwd: cwd ?? null });
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
          const answer = await connection.next(event => event.kind === 'screen' && event.session === id);
          if (answer.kind !== 'screen') throw new BrokerError('PTY', 'the broker answered no screen');
          return {
            lines: answer.lines,
            cursorRow: answer.cursor_row,
            cursorColumn: answer.cursor_column,
            altScreen: answer.alt_screen,
          };
        },
        async kill() { connection.send({ kind: 'kill', session: id }); },
      };
    },
    async close() {
      socket.end();
      process_.kill();
      await new Promise<void>(resolve => { process_.once('exit', () => resolve()); });
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
  const waiting: Array<{ accept: (event: Event) => boolean; settle: (event: Event) => void; refuse: (error: Error) => void }> = [];
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
      logger.warn(`the terminal channel was full: a flush waited ${event.waited_ms}ms`, { session: event.session });
      return;
    }
    if (event.kind === 'failed') {
      const error = new BrokerError(event.code, event.message, event.session ?? undefined);
      // A refusal with no session is this connection's: whoever is waiting hears it
      const next = waiting.shift();
      if (next) next.refuse(error);
      return;
    }
    const index = waiting.findIndex(one => one.accept(event));
    if (index >= 0) waiting.splice(index, 1)[0]!.settle(event);
  });

  const ended = new Error('the broker connection ended');
  socket.once('close', () => { while (waiting.length > 0) waiting.shift()!.refuse(ended); });

  return {
    send(request) { socket.write(`${JSON.stringify(request)}\n`); },
    next(accept) {
      return new Promise<Event>((settle, refuse) => { waiting.push({ accept, settle, refuse }); });
    },
  };
}
