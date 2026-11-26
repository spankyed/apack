/**
 * Local-tool Unix domain socket / Windows named pipe transport and `api-runtime.json` discovery primitives.
 *
 * Local tools (CLI commands, pack watchers, diagnostics) discover a running API instance through
 * `<appDir>/api-runtime.json`. Production builds publish `{ pid }` only; development, test, and
 * `APACK_TOOL_SOCKET=1` runs additionally bind a user-private local socket and publish `{ pid, socket, token }`.
 *
 * Authentication uses a single newline-delimited JSON handshake (`{"toolToken":"..."}\n` → `{"ok":true}\n`)
 * before handing the raw `net.Socket` (plus any pipelined bytes) to callers such as `@apackdev/link`'s `stream()`.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { writePrivateRuntimeFile } from '../private-file.ts';
import { recordIsStale } from '../process-liveness.ts';
import type { AppEnv } from '@apackdev/sdk/env';

export const API_RUNTIME_FILE_NAME = 'api-runtime.json';

/**
 * macOS caps `AF_UNIX` `sockaddr_un.sun_path` at 104 bytes (including the NUL terminator).
 * Keep generated POSIX socket paths strictly under 100 UTF-8 bytes so long temp/Playwright `appDir`s still bind.
 */
export const MAX_POSIX_SOCKET_PATH_BYTES = 100;

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000;
export const DEFAULT_MAX_HANDSHAKE_BYTES = 4_096;

const HANDSHAKE_OK_LINE = '{"ok":true}\n';
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export interface ApiRuntimeRecord {
  readonly pid: number;
  readonly socket?: string;
  readonly token?: string;
}

export type ApiRuntimeReadResult =
  | { readonly status: 'live'; readonly record: ApiRuntimeRecord }
  | { readonly status: 'missing' }
  | { readonly status: 'corrupt' }
  | { readonly status: 'stale'; readonly record: ApiRuntimeRecord };

export interface ToolSocketAddressOptions {
  readonly platform?: NodeJS.Platform;
  readonly tmpDir?: string;
  readonly uid?: number;
  /** Windows-only per-run uniqueness suffix; defaults to 16 random bytes (32 hex chars). */
  readonly nonce?: string;
}

export interface StartToolSocketServerOptions {
  /** App directory used to derive the socket address (when `socket` is omitted) and optionally publish `api-runtime.json`. */
  readonly appDir?: string;
  /** Explicit socket address override (POSIX path or Windows named pipe). */
  readonly socket?: string;
  /** Non-empty shared secret required from connecting tools during the handshake. */
  readonly token: string;
  /** Invoked for each authenticated connection with any post-handshake bytes already buffered. */
  readonly onConnection: (socket: net.Socket, initialBytes: Buffer) => void;
  /** Maximum time to wait for a client to complete the auth handshake. Defaults to 2000 ms. */
  readonly handshakeTimeoutMs?: number;
  /** Maximum byte length of the handshake line (including the trailing newline). Defaults to 4096 bytes. */
  readonly maxHandshakeBytes?: number;
  readonly platform?: NodeJS.Platform;
  readonly tmpDir?: string;
  readonly uid?: number;
  /**
   * Whether to publish `{ pid, socket, token }` to `api-runtime.json` once listening and remove it on `close()`.
   * Defaults to `true` when `appDir` is provided and `false` otherwise.
   */
  readonly writeRuntimeFile?: boolean;
}

export interface ToolSocketServer extends Disposable, AsyncDisposable {
  readonly address: string;
  readonly runtimeFile: string | undefined;
  close(): Promise<void>;
}

export interface ConnectToolSocketOptions {
  readonly socket: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly maxHandshakeBytes?: number;
}

export interface ToolSocketConnection {
  readonly socket: net.Socket;
  readonly initialBytes: Buffer;
}

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | undefined)?.code;

const isNamedPipeAddress = (address: string): boolean =>
  address.startsWith('\\\\.\\pipe\\') || address.startsWith('//./pipe/');

/** Whether a process running in `appEnv` should bind the local tool socket and publish `{ pid, socket, token }`. */
export function shouldExposeToolSocket(appEnv: AppEnv, env: NodeJS.ProcessEnv = process.env): boolean {
  return appEnv === 'development' || appEnv === 'test' || env.APACK_TOOL_SOCKET === '1';
}

/** Path to `<appDir>/api-runtime.json`. */
export function runtimeFilePath(appDir: string): string {
  return path.join(appDir, API_RUNTIME_FILE_NAME);
}

/** Strictly parses and normalizes an `ApiRuntimeRecord`, returning `undefined` on any schema violation. */
function parseApiRuntimeRecord(raw: unknown): ApiRuntimeRecord | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== 'pid' && key !== 'socket' && key !== 'token') return undefined;
  }

  const { pid, socket, token } = obj;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return undefined;

  if (socket === undefined && token === undefined) {
    return { pid };
  }
  if (typeof socket === 'string' && socket.length > 0 && typeof token === 'string' && token.length > 0) {
    return { pid, socket, token };
  }
  return undefined;
}

/**
 * Atomically publishes `<appDir>/api-runtime.json` with mode `0600`.
 * Production runs pass `{ pid }`; dev/test/`APACK_TOOL_SOCKET=1` runs pass `{ pid, socket, token }`.
 */
export function writeApiRuntimeFile(appDir: string, record: ApiRuntimeRecord): void {
  const normalized = parseApiRuntimeRecord(record);
  if (!normalized) {
    throw new Error('Invalid api-runtime.json record: expected positive integer pid and either both non-empty socket & token or neither');
  }
  writePrivateRuntimeFile(runtimeFilePath(appDir), JSON.stringify(normalized));
}

/**
 * Reads and classifies `<appDir>/api-runtime.json`, distinguishing `live`, `missing`, `corrupt`, and `stale`
 * records so diagnostic commands such as `apack doctor` can report stale PIDs separately.
 */
export function inspectApiRuntimeFile(appDir: string): ApiRuntimeReadResult {
  const file = runtimeFilePath(appDir);
  let rawText: string;
  try {
    rawText = fs.readFileSync(file, 'utf-8');
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'missing' };
    return { status: 'corrupt' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { status: 'corrupt' };
  }

  const record = parseApiRuntimeRecord(parsed);
  if (!record) return { status: 'corrupt' };

  if (recordIsStale(file, record.pid)) {
    return { status: 'stale', record };
  }
  return { status: 'live', record };
}

/**
 * Reads the live `<appDir>/api-runtime.json` record, or returns `undefined` when the file is missing,
 * corrupt, or belongs to a dead / pre-boot PID.
 */
export function readApiRuntimeFile(appDir: string): ApiRuntimeRecord | undefined {
  const result = inspectApiRuntimeFile(appDir);
  return result.status === 'live' ? result.record : undefined;
}

/**
 * Removes `<appDir>/api-runtime.json` if present (idempotent).
 * When `onlyIfPid` is provided, skips removal if another live PID has since replaced the file.
 */
export function removeApiRuntimeFile(appDir: string, options?: { readonly onlyIfPid?: number }): void {
  const file = runtimeFilePath(appDir);
  if (options?.onlyIfPid !== undefined) {
    const current = inspectApiRuntimeFile(appDir);
    if (current.status === 'missing') return;
    if (current.status === 'live' && current.record.pid !== options.onlyIfPid) return;
  }
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Best-effort cleanup during teardown
  }
}

/**
 * Computes a user-private local socket address for `appDir`:
 * - **POSIX:** `<tmpdir>/apack-<uid>/api-<sha256(resolvedAppDir).slice(0,16)>.sock` (strictly `< 100` UTF-8 bytes).
 * - **Windows:** `\\.\pipe\apack-api-<sha256(resolvedAppDir).slice(0,16)>-<16-byte-random-hex>` (unique per run).
 */
export function toolSocketAddress(appDir: string, opts?: ToolSocketAddressOptions): string {
  const resolvedAppDir = path.resolve(appDir);
  const hash = crypto.createHash('sha256').update(resolvedAppDir, 'utf8').digest('hex').slice(0, 16);
  const platform = opts?.platform ?? process.platform;

  if (platform === 'win32') {
    const nonce = opts?.nonce ?? crypto.randomBytes(16).toString('hex');
    if (nonce.length === 0) {
      throw new RangeError('Tool socket Windows pipe nonce must be non-empty');
    }
    return `\\\\.\\pipe\\apack-api-${hash}-${nonce}`;
  }

  const uid = opts?.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
  const buildPosixPath = (baseTmp: string) => path.posix.join(baseTmp, `apack-${uid}`, `api-${hash}.sock`);

  let candidate = buildPosixPath(opts?.tmpDir ?? os.tmpdir());
  if (Buffer.byteLength(candidate, 'utf8') >= MAX_POSIX_SOCKET_PATH_BYTES && opts?.tmpDir === undefined) {
    // Fall back to `/tmp` when a custom TMPDIR would exceed macOS's 104-byte AF_UNIX `sun_path` limit.
    candidate = buildPosixPath('/tmp');
  }
  assertPosixSocketPathLength(candidate);
  return candidate;
}

function assertPosixSocketPathLength(socketPath: string): void {
  const bytes = Buffer.byteLength(socketPath, 'utf8');
  if (bytes >= MAX_POSIX_SOCKET_PATH_BYTES) {
    throw new RangeError(
      `POSIX tool socket path is ${bytes} bytes, exceeding the ${MAX_POSIX_SOCKET_PATH_BYTES - 1}-byte limit: ${socketPath}`,
    );
  }
}

/**
 * Checks whether a live server is currently accepting connections on `socketPath`.
 * Resolves `true` if a connection succeeds (and immediately destroys the probe), `false` on `ECONNREFUSED`/`ENOENT`.
 */
function isPosixSocketAlive(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const probe = net.connect(socketPath);
    let settled = false;

    const finish = (alive: boolean, err?: Error) => {
      if (settled) return;
      settled = true;
      probe.removeAllListeners();
      probe.on('error', () => {});
      probe.destroy();
      if (err) reject(err);
      else resolve(alive);
    };

    probe.once('connect', () => finish(true));
    probe.once('error', (err) => {
      const code = errorCode(err);
      if (code === 'ECONNREFUSED' || code === 'ENOENT') {
        finish(false);
      } else {
        finish(false, err);
      }
    });
  });
}

/**
 * Ensures the parent directory of a POSIX socket path is a real directory owned by the current user with `0700`
 * permissions, and removes any stale socket file left by an earlier crashed process.
 */
async function preparePosixSocketPath(socketPath: string): Promise<void> {
  assertPosixSocketPathLength(socketPath);
  const dir = path.dirname(socketPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  let dirStat = fs.lstatSync(dir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new Error(`Tool socket directory is not a regular directory: ${dir}`);
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (currentUid !== undefined && dirStat.uid !== currentUid) {
    throw new Error(`Tool socket directory is owned by uid ${dirStat.uid}, expected ${currentUid}: ${dir}`);
  }
  if ((dirStat.mode & 0o777) !== 0o700) {
    fs.chmodSync(dir, 0o700);
    dirStat = fs.lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory() || (currentUid !== undefined && dirStat.uid !== currentUid) || (dirStat.mode & 0o777) !== 0o700) {
      throw new Error(`Failed to enforce 0700 permissions on tool socket directory: ${dir}`);
    }
  }

  let entryStat: fs.Stats | undefined;
  try {
    entryStat = fs.lstatSync(socketPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw error;
  }

  if (!entryStat.isSocket()) {
    throw new Error(`Refusing to overwrite non-socket entry at ${socketPath}`);
  }
  if (currentUid !== undefined && entryStat.uid !== currentUid) {
    throw new Error(`Refusing to remove socket owned by uid ${entryStat.uid} at ${socketPath}`);
  }

  const alive = await isPosixSocketAlive(socketPath);
  if (alive) {
    throw Object.assign(new Error(`Tool socket is already in use: ${socketPath}`), { code: 'EADDRINUSE' });
  }
  fs.rmSync(socketPath, { force: true });
}

/**
 * Constant-time token comparison over fixed-length SHA-256 digests so mismatched lengths never short-circuit
 * before `crypto.timingSafeEqual`.
 */
function digestToken(token: string): Buffer {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function verifyToolToken(candidate: string, expectedDigest: Buffer): boolean {
  return crypto.timingSafeEqual(digestToken(candidate), expectedDigest);
}

function parseAuthHandshakeLine(lineBuffer: Buffer): string | undefined {
  let lineText: string;
  try {
    lineText = utf8Decoder.decode(lineBuffer);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lineText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== 'toolToken') return undefined;
  return typeof obj.toolToken === 'string' && obj.toolToken.length > 0 ? obj.toolToken : undefined;
}

function parseAckHandshakeLine(lineBuffer: Buffer): boolean {
  let lineText: string;
  try {
    lineText = utf8Decoder.decode(lineBuffer);
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lineText);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  return keys.length === 1 && keys[0] === 'ok' && obj.ok === true;
}

/**
 * Pauses `socket` across the handshake-to-caller handoff so no post-handshake bytes or `'end'` events are lost
 * before the caller attaches listeners, then automatically resumes on the first `'data'` listener (since Node's
 * `Readable.on('data')` does not auto-resume after an explicit `pause()`).
 */
function pauseUntilConsumed(socket: net.Socket): void {
  socket.pause();
  const onNewListener = (event: string | symbol) => {
    if (event === 'data' || event === 'readable') {
      socket.off('newListener', onNewListener);
      socket.off('close', cleanup);
      if (event === 'data' && !socket.destroyed) {
        socket.resume();
      }
    }
  };
  const cleanup = () => {
    socket.off('newListener', onNewListener);
  };
  socket.on('newListener', onNewListener);
  socket.once('close', cleanup);
}

/**
 * Starts an authenticated local-socket server on POSIX (`AF_UNIX`) or Windows named pipe.
 *
 * Clients must send `{"toolToken":"<token>"}\n` within `handshakeTimeoutMs` and `maxHandshakeBytes`;
 * authenticated sockets receive `{"ok":true}\n` before being handed to `onConnection(socket, initialBytes)`.
 */
export async function startToolSocketServer(options: StartToolSocketServerOptions): Promise<ToolSocketServer> {
  if (typeof options.token !== 'string' || options.token.length === 0) {
    throw new Error('Tool socket server requires a non-empty token');
  }
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const maxHandshakeBytes = options.maxHandshakeBytes ?? DEFAULT_MAX_HANDSHAKE_BYTES;
  if (!Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs <= 0) {
    throw new RangeError(`handshakeTimeoutMs must be a positive number, got ${handshakeTimeoutMs}`);
  }
  if (!Number.isSafeInteger(maxHandshakeBytes) || maxHandshakeBytes <= 0) {
    throw new RangeError(`maxHandshakeBytes must be a positive integer, got ${maxHandshakeBytes}`);
  }

  let address: string;
  if (options.socket !== undefined) {
    if (options.socket.length === 0) throw new Error('Tool socket address must be non-empty');
    address = options.socket;
  } else if (options.appDir !== undefined) {
    address = toolSocketAddress(options.appDir, {
      platform: options.platform,
      tmpDir: options.tmpDir,
      uid: options.uid,
    });
  } else {
    throw new Error('startToolSocketServer requires either socket or appDir');
  }

  const isPosix = !isNamedPipeAddress(address) && (options.platform ?? process.platform) !== 'win32';
  const expectedDigest = digestToken(options.token);
  const shouldWriteRuntime = options.writeRuntimeFile ?? options.appDir !== undefined;
  const publishedAppDir = shouldWriteRuntime ? options.appDir : undefined;

  if (isPosix) {
    await preparePosixSocketPath(address);
  }

  const activeSockets = new Set<net.Socket>();
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let boundSocket = false;
  let publishedRuntime = false;

  const server = net.createServer((socket) => {
    if (closed) {
      socket.destroy();
      return;
    }

    activeSockets.add(socket);
    socket.once('close', () => {
      activeSockets.delete(socket);
    });

    const chunks: Buffer[] = [];
    let accumulatedBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      rejectHandshake();
    }, handshakeTimeoutMs);
    timer.unref();
    pendingTimers.add(timer);

    const cleanupHandshake = () => {
      clearTimeout(timer);
      pendingTimers.delete(timer);
      socket.off('data', onData);
      socket.off('end', onEarlyClose);
      socket.off('close', onEarlyClose);
      socket.off('error', onEarlyError);
    };

    const rejectHandshake = () => {
      if (settled) return;
      settled = true;
      cleanupHandshake();
      // Keep a no-op error listener so destroying during an in-flight reset cannot emit unhandled 'error'.
      socket.on('error', () => {});
      socket.destroy();
    };

    const onEarlyClose = () => {
      rejectHandshake();
    };

    const onEarlyError = () => {
      rejectHandshake();
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      const newlineIndex = chunk.indexOf(0x0a);
      if (newlineIndex === -1) {
        accumulatedBytes += chunk.length;
        // Without a newline yet, reaching `maxHandshakeBytes` already guarantees the line (including `\n`) is over limit.
        if (accumulatedBytes >= maxHandshakeBytes) {
          rejectHandshake();
          return;
        }
        chunks.push(chunk);
        return;
      }

      const lineBytesWithNewline = accumulatedBytes + newlineIndex + 1;
      if (lineBytesWithNewline > maxHandshakeBytes) {
        rejectHandshake();
        return;
      }

      settled = true;
      socket.pause();
      cleanupHandshake();

      const lineHead = chunk.subarray(0, newlineIndex);
      const lineBuffer = chunks.length === 0 ? lineHead : Buffer.concat([...chunks, lineHead]);
      const candidateToken = parseAuthHandshakeLine(lineBuffer);
      if (!candidateToken || !verifyToolToken(candidateToken, expectedDigest) || closed || socket.destroyed) {
        socket.on('error', () => {});
        socket.destroy();
        return;
      }

      const trailing = chunk.subarray(newlineIndex + 1);
      const initialBytes = trailing.length > 0 ? Buffer.from(trailing) : Buffer.alloc(0);

      pauseUntilConsumed(socket);
      socket.write(HANDSHAKE_OK_LINE);
      options.onConnection(socket, initialBytes);
    };

    socket.on('data', onData);
    socket.on('end', onEarlyClose);
    socket.on('close', onEarlyClose);
    socket.on('error', onEarlyError);
  });

  const cleanupFilesSync = () => {
    if (isPosix && boundSocket) {
      boundSocket = false;
      try {
        fs.rmSync(address, { force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    if (publishedRuntime && publishedAppDir !== undefined) {
      publishedRuntime = false;
      removeApiRuntimeFile(publishedAppDir, { onlyIfPid: process.pid });
    }
  };

  const beginCloseSync = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;

    for (const timer of pendingTimers) {
      clearTimeout(timer);
    }
    pendingTimers.clear();

    for (const socket of activeSockets) {
      socket.on('error', () => {});
      socket.destroy();
    }
    activeSockets.clear();

    closePromise = new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });

    cleanupFilesSync();
    return closePromise;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        boundSocket = true;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(address);
    });

    if (isPosix) {
      fs.chmodSync(address, 0o600);
    }

    if (publishedAppDir !== undefined) {
      writeApiRuntimeFile(publishedAppDir, { pid: process.pid, socket: address, token: options.token });
      publishedRuntime = true;
    }
  } catch (error) {
    await beginCloseSync();
    throw error;
  }

  return {
    address,
    runtimeFile: publishedRuntime && publishedAppDir !== undefined ? runtimeFilePath(publishedAppDir) : undefined,
    close: () => beginCloseSync(),
    [Symbol.dispose]: () => {
      void beginCloseSync();
    },
    [Symbol.asyncDispose]: () => beginCloseSync(),
  };
}

/**
 * Connects to a local tool socket, performs the JSON token handshake, and resolves the authenticated
 * `net.Socket` (paused until the caller attaches listeners, e.g. `@apackdev/link`'s `stream(socket)`)
 * alongside any post-handshake bytes already buffered.
 */
export function connectToolSocket(options: ConnectToolSocketOptions): Promise<ToolSocketConnection> {
  if (typeof options.socket !== 'string' || options.socket.length === 0) {
    return Promise.reject(new Error('connectToolSocket requires a non-empty socket address'));
  }
  if (typeof options.token !== 'string' || options.token.length === 0) {
    return Promise.reject(new Error('connectToolSocket requires a non-empty token'));
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const maxHandshakeBytes = options.maxHandshakeBytes ?? DEFAULT_MAX_HANDSHAKE_BYTES;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError(`timeoutMs must be a positive number, got ${timeoutMs}`));
  }
  if (!Number.isSafeInteger(maxHandshakeBytes) || maxHandshakeBytes <= 0) {
    return Promise.reject(new RangeError(`maxHandshakeBytes must be a positive integer, got ${maxHandshakeBytes}`));
  }

  return new Promise<ToolSocketConnection>((resolve, reject) => {
    const socket = net.connect(options.socket);
    const chunks: Buffer[] = [];
    let accumulatedBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onClose);
      socket.off('close', onClose);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.on('error', () => {});
      socket.destroy();
      reject(error);
    };

    const timer = setTimeout(() => {
      fail(new Error(`Tool socket handshake timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref();

    const onConnect = () => {
      socket.write(`${JSON.stringify({ toolToken: options.token })}\n`);
    };

    const onError = (error: Error) => {
      fail(error);
    };

    const onClose = () => {
      fail(new Error('Tool socket closed during handshake'));
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      const newlineIndex = chunk.indexOf(0x0a);
      if (newlineIndex === -1) {
        accumulatedBytes += chunk.length;
        if (accumulatedBytes >= maxHandshakeBytes) {
          fail(new Error(`Tool socket handshake response exceeded ${maxHandshakeBytes} bytes`));
          return;
        }
        chunks.push(chunk);
        return;
      }

      const lineBytesWithNewline = accumulatedBytes + newlineIndex + 1;
      if (lineBytesWithNewline > maxHandshakeBytes) {
        fail(new Error(`Tool socket handshake response exceeded ${maxHandshakeBytes} bytes`));
        return;
      }

      settled = true;
      socket.pause();
      cleanup();

      const lineHead = chunk.subarray(0, newlineIndex);
      const lineBuffer = chunks.length === 0 ? lineHead : Buffer.concat([...chunks, lineHead]);
      if (!parseAckHandshakeLine(lineBuffer)) {
        socket.on('error', () => {});
        socket.destroy();
        reject(new Error('Tool socket server sent an invalid handshake acknowledgement'));
        return;
      }

      const trailing = chunk.subarray(newlineIndex + 1);
      const initialBytes = trailing.length > 0 ? Buffer.from(trailing) : Buffer.alloc(0);
      pauseUntilConsumed(socket);
      resolve({ socket, initialBytes });
    };

    socket.once('connect', onConnect);
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('end', onClose);
    socket.on('close', onClose);
  });
}
