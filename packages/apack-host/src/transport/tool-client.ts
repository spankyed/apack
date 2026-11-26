/**
 * Local-tool client helper composing `api-runtime.json` discovery, authenticated local-socket connect,
 * `@apackdev/link` length-prefixed `stream()` framing, `muxTransport`, and the typed Host Control RPC client.
 */
import type * as net from 'node:net';
import { stream, type StreamOptions } from '@apackdev/link';
import {
  muxTransport,
  type ControlClient,
  type MuxedTransport,
  type MuxTransportOptions,
  type RawTransport,
} from './mux.ts';
import {
  createHostControlClient,
  type HostControlContract,
} from './control-contract.ts';
import {
  connectToolSocket,
  inspectApiRuntimeFile,
  readApiRuntimeFile,
  runtimeFilePath,
  type ApiRuntimeReadResult,
  type ApiRuntimeRecord,
} from './tool-socket.ts';

export type { ApiRuntimeReadResult, ApiRuntimeRecord };

/** Reads the live `<appDir>/api-runtime.json` record, or returns `undefined` when absent, corrupt, or stale. */
export function readApiRuntime(appDir: string): ApiRuntimeRecord | undefined {
  return readApiRuntimeFile(appDir);
}

/** Inspects `<appDir>/api-runtime.json`, distinguishing `live`, `missing`, `corrupt`, and `stale` states. */
export function inspectApiRuntime(appDir: string): ApiRuntimeReadResult {
  return inspectApiRuntimeFile(appDir);
}

/**
 * Adapts an authenticated `net.Socket` (plus any pipelined bytes buffered during the handshake) into
 * a `@apackdev/link` length-prefixed `RawTransport`.
 */
export function toolSocketTransport(
  socket: net.Socket,
  initialBytes: Buffer = Buffer.alloc(0),
  options?: StreamOptions,
): RawTransport {
  if (initialBytes.length > 0) {
    socket.unshift(initialBytes);
  }
  return stream(socket, options);
}

export type ConnectToolClientOptions = (
  | { readonly appDir: string; readonly socket?: undefined; readonly token?: undefined }
  | { readonly socket: string; readonly token: string; readonly appDir?: undefined }
) & {
  readonly timeoutMs?: number;
  readonly maxHandshakeBytes?: number;
  readonly streamOptions?: StreamOptions;
  readonly muxOptions?: MuxTransportOptions;
};

export interface ToolClient extends Disposable, AsyncDisposable {
  readonly control: ControlClient<HostControlContract>;
  readonly link: RawTransport;
  readonly mux: MuxedTransport;
  readonly socket: net.Socket;
  readonly address: string;
  readonly record: ApiRuntimeRecord | undefined;
  readonly closed: boolean;
  close(): Promise<void>;
}

/**
 * Connects to a running app's local tool socket, authenticates, wraps the stream in `muxTransport`,
 * and returns a typed `HostControlContract` client alongside the Link lane transport.
 */
export async function connectToolClient(options: ConnectToolClientOptions): Promise<ToolClient> {
  let address: string;
  let token: string;
  let record: ApiRuntimeRecord | undefined;

  if (options.appDir !== undefined) {
    const inspected = inspectApiRuntimeFile(options.appDir);
    if (inspected.status !== 'live') {
      throw new Error(
        `No live API runtime in ${runtimeFilePath(options.appDir)} (${inspected.status})`,
      );
    }
    if (!inspected.record.socket || !inspected.record.token) {
      throw new Error(
        `Running API (pid ${inspected.record.pid}) in ${runtimeFilePath(options.appDir)} exposes no local tool socket`,
      );
    }
    record = inspected.record;
    address = inspected.record.socket;
    token = inspected.record.token;
  } else {
    address = options.socket;
    token = options.token;
  }

  const { socket, initialBytes } = await connectToolSocket({
    socket: address,
    token,
    timeoutMs: options.timeoutMs,
    maxHandshakeBytes: options.maxHandshakeBytes,
  });

  const raw = toolSocketTransport(socket, initialBytes, options.streamOptions);
  const mux = muxTransport(raw, options.muxOptions);
  const control = createHostControlClient(mux.control);

  let closed = false;
  let closePromise: Promise<void> | undefined;

  mux.control.onClose(() => {
    closed = true;
  });

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    control.dispose();
    const waitSocketClosed = socket.destroyed
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          socket.once('close', () => resolve());
        });
    mux.close();
    closePromise = waitSocketClosed;
    return closePromise;
  };

  return {
    control,
    link: mux.link,
    mux,
    socket,
    address,
    record,
    get closed() {
      return closed || mux.control.closed;
    },
    close,
    [Symbol.dispose]: () => {
      void close();
    },
    [Symbol.asyncDispose]: () => close(),
  };
}
