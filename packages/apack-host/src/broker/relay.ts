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
  /** What the last run of the command that ended badly wrote to stderr: why a connection came to nothing */
  lastFailure(): string;
  /** Stops accepting, and ends the commands still running. Nothing is ended on the far side by this */
  close(): Promise<void>;
}

function listening(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection(socket);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}

/**
 * Listens on `socket`, running `command` for each connection.
 *
 * **Argv, never a shell line.** The command is the user's own setting, and it is still passed as the
 * arguments they are: nothing here is in a position to quote a string for a shell correctly.
 *
 * A socket something is already answering on is left to it — two processes of this app serve the same
 * target the same way — and one nothing answers on is a file a process that died left behind.
 */
export async function serveRelay(socket: string, command: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<Relay> {
  const [program, ...args] = command;
  if (program === undefined) throw new Error('A terminal target needs a command to reach it with');
  let failure = '';
  const running = new Set<ReturnType<typeof spawn>>();

  const server = net.createServer((connection) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    running.add(child);
    let said = '';
    child.stderr.on('data', (chunk: Buffer) => { if (said.length < STDERR_KEPT) said += chunk.toString('utf8'); });
    connection.pipe(child.stdin);
    child.stdout.pipe(connection);
    // A command that has gone takes no more input, which is an ending and not a fault
    child.stdin.on('error', () => {});
    connection.on('error', () => {});
    connection.once('close', () => { child.kill(); });
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

  let owned = true;
  if (await listen() === 'in-use') {
    if (await listening(socket)) {
      owned = false;
    } else {
      rmSync(socket, { force: true });
      if (await listen() === 'in-use') throw new Error(`Could not listen on ${socket} for a terminal target`);
    }
  }
  server.unref();

  return {
    socket,
    lastFailure: () => failure,
    async close() {
      for (const child of running) child.kill();
      if (!owned) return;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
