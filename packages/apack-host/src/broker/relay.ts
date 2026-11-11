// A broker somewhere else, reached as a socket here.
//
// **A broker listens on a socket, which only its own machine can reach.** `apack-terminal proxy <socket>`
// turns a process's stdin and stdout into a connection to the broker on that socket, starting one if there
// is none — so a command that runs the proxy on another machine or in a container (`ssh host …`,
// `docker exec -i box …`) is a connection to a broker there.
//
// **This puts a socket in front of such a command**, so that everything that reaches the app's own broker
// by connecting to a socket reaches a remote one the same way: each connection accepted here is one run of
// the command, with the connection's bytes as its stdin and its stdout as the connection's. Nothing that
// connects knows the broker is elsewhere, which is why a remote terminal needs no second client and no
// second protocol — and why a window, which opens its own connection to draw a terminal, needs only to be
// told a different socket.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import * as net from 'node:net';
import { createLogger } from '@apackdev/sdk/logger';

const logger = createLogger('terminal-relay');

/** How much of what a command wrote to stderr is kept to explain a connection that came to nothing */
const STDERR_KEPT = 4096;

/** A target's name among the app's sockets: the same command is the same target */
export function relayKey(command: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex').slice(0, 12);
}

/** Whether `key` is one `relayKey` could have made, which is what a caller naming a relay is held to */
export function isRelayKey(key: unknown): key is string {
  return typeof key === 'string' && /^[0-9a-f]{12}$/.test(key);
}

export interface Relay {
  readonly socket: string;
  /**
   * Why a connection came to nothing: a run of the command that is still going and has written nothing,
   * or what the last run that ended badly wrote to stderr
   */
  lastFailure(): string;
  /** Stops accepting, and ends the commands still running. Nothing is ended on the far side by this */
  close(): Promise<void>;
}

/**
 * Listens on `socket`, running `command` for each connection.
 *
 * **Argv, never a shell line.** The command is the user's own setting, and it is still passed as the
 * arguments they are: nothing here is in a position to quote a string for a shell correctly.
 *
 * **The socket is this process's.** It is in the directory of the data dir this process serves, which one
 * API process holds at a time, so a file already at the path is one a process that died left behind and
 * is replaced. Asking whether something answers there would run the command once to find out.
 */
export async function serveRelay(socket: string, command: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<Relay> {
  const [program, ...args] = command;
  if (program === undefined) throw new Error('A terminal target needs a command to reach it with');
  let failure = '';
  /** Each run of the command still going, with when it began, whether it has answered, and its stderr */
  const running = new Map<ReturnType<typeof spawn>, { began: number; answered: boolean; said(): string }>();
  /**
   * What a run that has written nothing says of itself: how long it has been, and what it put on stderr.
   * A command that hangs — a host that takes no connection, a daemon that is not answering — exits with
   * no status to report, so this is the only account of it there is.
   */
  const silence = (run: { began: number; said(): string }): string => {
    const said = run.said().trim();
    return `${program} has run for ${((Date.now() - run.began) / 1000).toFixed(1)}s and written nothing${said ? `; it said: ${said}` : ''}`;
  };

  const server = net.createServer((connection) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    let said = '';
    const run = { began: Date.now(), answered: false, said: () => said };
    running.set(child, run);
    child.stderr.on('data', (chunk: Buffer) => { if (said.length < STDERR_KEPT) said += chunk.toString('utf8'); });
    child.stdout.once('data', () => { run.answered = true; });
    connection.pipe(child.stdin);
    child.stdout.pipe(connection);
    // A command that has gone takes no more input, which is an ending and not a fault
    child.stdin.on('error', () => {});
    connection.on('error', () => {});
    connection.once('close', () => {
      // Given up on by whoever connected, before it wrote a byte: said here, where it is still known
      if (!run.answered && running.has(child)) {
        failure = silence(run);
        logger.warn(`a terminal target's command was given up on: ${failure}`);
      }
      child.kill();
    });
    child.once('error', (error) => {
      failure = `${program} could not be started (${error.message})`;
      logger.warn(failure);
      connection.destroy();
    });
    child.once('exit', (code, signal) => {
      running.delete(child);
      if (code !== 0 && signal === null) {
        failure = said.trim() || `${program} exited with status ${code}`;
        logger.warn(`a terminal target's command ended (${code}): ${failure}`);
      }
      connection.destroy();
    });
  });

  const listen = (): Promise<'listening' | 'in-use'> => new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve('in-use');
      else reject(error);
    });
    server.listen(socket, () => resolve('listening'));
  });

  if (await listen() === 'in-use') {
    rmSync(socket, { force: true });
    if (await listen() === 'in-use') throw new Error(`Could not listen on ${socket} for a terminal target`);
  }
  server.unref();

  return {
    socket,
    // A run still going that has answered nothing is the failure being asked about, before it has ended
    lastFailure: () => [...running.values()].filter(run => !run.answered).map(silence)[0] ?? failure,
    async close() {
      for (const child of running.keys()) child.kill();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
