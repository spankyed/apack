/**
 * Single-port transport multiplexer and off-bus Control RPC framing.
 *
 * Splits one message-oriented `RawTransport` (structurally identical to `@apackdev/link`'s `Transport` and
 * `_BackendPortTransport`) into two isolated lanes without taking a dependency on `@apackdev/link`:
 *
 * - **Link lane:** `'L' + text` for text frames, `[0x00, ...bytes]` for binary frames. Forwards `most` minus
 *   one framing byte and `waiting()`, and binds `onClose`/`close` 1:1 to the underlying transport.
 * - **Control lane:** `'C' + JSON.stringify(frame)` for bounded off-bus RPC (`req`/`res`/`cancel` and
 *   `sub`/`data`/`end`/`unsub` with optional latest-value coalescing). Malformed or oversized control frames
 *   are rejected without crashing the process or leaking into the Link lane.
 */

export const DEFAULT_MAX_CONTROL_FRAME_BYTES = 4 * 1024 * 1024;

const LINK_TEXT_PREFIX = 'L';
const LINK_TEXT_PREFIX_CODE = 0x4c; // 'L'
const CONTROL_TEXT_PREFIX = 'C';
const CONTROL_TEXT_PREFIX_CODE = 0x43; // 'C'
const LINK_BINARY_PREFIX = 0x00;

const utf8Encoder = new TextEncoder();

/** What crosses a transport whole: text or bytes. Matches `@apackdev/link`'s `Message`. */
export type RawMessage = string | Uint8Array;

/**
 * Structural slice of `@apackdev/link`'s `Transport` (and `_BackendPortTransport`).
 *
 * Kept dependency-free so `@apackdev/host` can compose over `MessagePort`, `WebSocket`, or in-memory test
 * transports before `@apackdev/link` is wired in.
 */
export interface RawTransport {
  send(data: RawMessage): void;
  onData(listener: (data: RawMessage) => void): void;
  onClose(listener: () => void): void;
  close(): void;
  readonly most?: number;
  waiting?(): number;
}

export interface MuxControlError {
  readonly kind: 'oversized' | 'malformed' | 'unknown-prefix';
  readonly message: string;
}

export interface MuxTransportOptions {
  /** Maximum encoded UTF-8 byte length of a single control frame (`'C' + JSON`). Defaults to 4 MiB. */
  readonly maxControlFrameBytes?: number;
  /** Optional observer for dropped malformed, oversized, or unknown-prefix frames. */
  readonly onControlError?: (error: MuxControlError) => void;
}

export type ControlFrame =
  | { readonly type: 'req'; readonly id: number; readonly method: string; readonly input?: unknown }
  | { readonly type: 'cancel'; readonly id: number }
  | { readonly type: 'res'; readonly id: number; readonly ok: true; readonly value?: unknown }
  | { readonly type: 'res'; readonly id: number; readonly ok: false; readonly code: string; readonly message: string }
  | { readonly type: 'sub'; readonly id: number; readonly method: string; readonly input?: unknown }
  | { readonly type: 'data'; readonly id: number; readonly value?: unknown }
  | { readonly type: 'end'; readonly id: number; readonly code?: string; readonly message?: string }
  | { readonly type: 'unsub'; readonly id: number };

export interface ControlLane {
  send(frame: ControlFrame): void;
  onFrame(listener: (frame: ControlFrame) => void): () => void;
  onClose(listener: () => void): void;
  close(): void;
  readonly closed: boolean;
  readonly maxFrameBytes: number;
}

export interface MuxedTransport {
  readonly link: RawTransport;
  readonly control: ControlLane;
  close(): void;
}

export class ControlRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ControlRpcError';
    this.code = code;
  }
}

export interface ControlContract {
  readonly requests?: Record<string, { readonly input: unknown; readonly output: unknown }>;
  readonly subscriptions?: Record<string, { readonly input: unknown; readonly output: unknown }>;
}

type RequestMapOf<C extends ControlContract> = NonNullable<C['requests']>;
type SubscriptionMapOf<C extends ControlContract> = NonNullable<C['subscriptions']>;

export interface ControlRequestMeta {
  readonly id: number;
  readonly method: string;
  readonly signal: AbortSignal;
}

export type ControlRequestHandler<Input = unknown, Output = unknown> = (
  input: Input,
  meta: ControlRequestMeta,
) => Output | Promise<Output>;

export interface ControlSubscriptionSink<Output = unknown> {
  readonly id: number;
  readonly method: string;
  readonly signal: AbortSignal;
  readonly closed: boolean;
  push(value: Output): void;
  end(error?: { readonly code?: string; readonly message: string }): void;
}

export type ControlSubscriptionSetup<Input = unknown, Output = unknown> = (
  input: Input,
  sink: ControlSubscriptionSink<Output>,
) => void | (() => void) | Promise<void | (() => void)>;

export type ControlSubscriptionHandler<Input = unknown, Output = unknown> =
  | ControlSubscriptionSetup<Input, Output>
  | {
      /**
       * When true, bursts of `sink.push(...)` within the same turn coalesce into a single latest-value
       * `data` frame flushed on a microtask (intended for state-snapshot streams such as `packs.catalog`).
       */
      readonly coalesce?: boolean;
      readonly subscribe: ControlSubscriptionSetup<Input, Output>;
    };

export interface ControlServerHandlers<C extends ControlContract = ControlContract> {
  readonly requests?: {
    readonly [M in keyof RequestMapOf<C>]: ControlRequestHandler<
      RequestMapOf<C>[M]['input'],
      RequestMapOf<C>[M]['output']
    >;
  };
  readonly subscriptions?: {
    readonly [M in keyof SubscriptionMapOf<C>]: ControlSubscriptionHandler<
      SubscriptionMapOf<C>[M]['input'],
      SubscriptionMapOf<C>[M]['output']
    >;
  };
}

export interface ControlServer {
  readonly activeRequestCount: number;
  readonly activeSubscriptionCount: number;
  dispose(): void;
}

export interface ControlCallOptions {
  readonly signal?: AbortSignal;
}

export interface ControlSubscriptionHandlers<Output = unknown> {
  onData(value: Output): void;
  onEnd?(error?: ControlRpcError): void;
}

export interface ControlSubscribeOptions {
  readonly signal?: AbortSignal;
  /** Coalesce bursts of incoming `data` frames on the client side, delivering only the latest value per microtask. */
  readonly coalesce?: boolean;
}

export interface ControlSubscriptionHandle {
  unsubscribe(): void;
  readonly closed: boolean;
}

export interface ControlClient<C extends ControlContract = ControlContract> {
  call<M extends keyof RequestMapOf<C> & string>(
    method: M,
    ...args: [RequestMapOf<C>[M]['input']] extends [void]
      ? [input?: RequestMapOf<C>[M]['input'], options?: ControlCallOptions]
      : [input: RequestMapOf<C>[M]['input'], options?: ControlCallOptions]
  ): Promise<RequestMapOf<C>[M]['output']>;
  subscribe<M extends keyof SubscriptionMapOf<C> & string>(
    method: M,
    input: SubscriptionMapOf<C>[M]['input'],
    handlers: ControlSubscriptionHandlers<SubscriptionMapOf<C>[M]['output']>,
    options?: ControlSubscribeOptions,
  ): ControlSubscriptionHandle;
  readonly pendingCallCount: number;
  readonly activeSubscriptionCount: number;
  dispose(): void;
}

function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]') {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

/**
 * Checks whether `value` exceeds `maxBytes` when UTF-8 encoded, fast-pathing without allocating when
 * `value.length` alone proves it is under or over the bound (`1..3` UTF-8 bytes per UTF-16 code unit).
 */
function exceedsUtf8Limit(value: string, maxBytes: number): boolean {
  if (value.length > maxBytes) return true;
  if (value.length * 3 <= maxBytes) return false;
  return utf8Encoder.encode(value).byteLength > maxBytes;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseControlFrame(rawJson: string): ControlFrame | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (!isNonNegativeInt(obj.id)) return undefined;

  switch (obj.type) {
    case 'req':
    case 'sub':
      if (typeof obj.method !== 'string' || obj.method.length === 0) return undefined;
      return {
        type: obj.type,
        id: obj.id,
        method: obj.method,
        ...('input' in obj ? { input: obj.input } : {}),
      };
    case 'cancel':
    case 'unsub':
      return { type: obj.type, id: obj.id };
    case 'res':
      if (obj.ok === true) {
        return {
          type: 'res',
          id: obj.id,
          ok: true,
          ...('value' in obj ? { value: obj.value } : {}),
        };
      }
      if (obj.ok === false && typeof obj.code === 'string' && typeof obj.message === 'string') {
        return { type: 'res', id: obj.id, ok: false, code: obj.code, message: obj.message };
      }
      return undefined;
    case 'data':
      return {
        type: 'data',
        id: obj.id,
        ...('value' in obj ? { value: obj.value } : {}),
      };
    case 'end':
      if (obj.code !== undefined && typeof obj.code !== 'string') return undefined;
      if (obj.message !== undefined && typeof obj.message !== 'string') return undefined;
      return {
        type: 'end',
        id: obj.id,
        ...(obj.code !== undefined ? { code: obj.code } : {}),
        ...(obj.message !== undefined ? { message: obj.message } : {}),
      };
    default:
      return undefined;
  }
}

function toControlError(error: unknown): ControlRpcError {
  if (error instanceof ControlRpcError) return error;
  if (error instanceof Error) return new ControlRpcError('INTERNAL_ERROR', error.message);
  return new ControlRpcError('INTERNAL_ERROR', String(error));
}

/**
 * Multiplexes a `@apackdev/link`-compatible Link lane and a bounded JSON Control RPC lane over one `RawTransport`.
 *
 * Closing either lane or the underlying transport tears down both lanes atomically.
 */
export function muxTransport(raw: RawTransport, options: MuxTransportOptions = {}): MuxedTransport {
  const maxControlFrameBytes = options.maxControlFrameBytes ?? DEFAULT_MAX_CONTROL_FRAME_BYTES;
  if (!Number.isInteger(maxControlFrameBytes) || maxControlFrameBytes < 2) {
    throw new RangeError(`maxControlFrameBytes must be an integer >= 2, got ${maxControlFrameBytes}`);
  }
  const onControlError = options.onControlError;

  const linkListeners: Array<(data: RawMessage) => void> = [];
  const queuedLink: RawMessage[] = [];
  const controlListeners: Array<(frame: ControlFrame) => void> = [];
  const queuedControl: ControlFrame[] = [];
  const closeListeners: Array<() => void> = [];
  let closed = false;
  let closingRaw = false;

  const finishClose = (): void => {
    if (closed) return;
    closed = true;
    linkListeners.length = 0;
    queuedLink.length = 0;
    controlListeners.length = 0;
    queuedControl.length = 0;
    let firstError: unknown;
    let hasError = false;
    for (const listener of closeListeners.splice(0)) {
      try {
        listener();
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
    if (hasError) throw firstError;
  };

  const closeAll = (): void => {
    if (closed || closingRaw) return;
    closingRaw = true;
    try {
      raw.close();
    } finally {
      closingRaw = false;
      finishClose();
    }
  };

  const onClose = (listener: () => void): void => {
    if (closed) {
      listener();
      return;
    }
    closeListeners.push(listener);
  };

  const deliverLink = (data: RawMessage): void => {
    if (closed) return;
    if (linkListeners.length === 0) {
      queuedLink.push(data);
      return;
    }
    for (const listener of linkListeners.slice()) {
      if (closed) break;
      listener(data);
    }
  };

  const deliverControl = (frame: ControlFrame): void => {
    if (closed) return;
    if (controlListeners.length === 0) {
      queuedControl.push(frame);
      return;
    }
    for (const listener of controlListeners.slice()) {
      if (closed) break;
      listener(frame);
    }
  };

  raw.onData((data) => {
    if (closed) return;
    if (typeof data === 'string') {
      if (data.length === 0) {
        onControlError?.({ kind: 'unknown-prefix', message: 'Received empty text frame' });
        return;
      }
      const prefix = data.charCodeAt(0);
      if (prefix === LINK_TEXT_PREFIX_CODE) {
        deliverLink(data.slice(1));
        return;
      }
      if (prefix === CONTROL_TEXT_PREFIX_CODE) {
        if (exceedsUtf8Limit(data, maxControlFrameBytes)) {
          onControlError?.({
            kind: 'oversized',
            message: `Control frame exceeds limit of ${maxControlFrameBytes} bytes`,
          });
          return;
        }
        const frame = parseControlFrame(data.slice(1));
        if (!frame) {
          onControlError?.({ kind: 'malformed', message: 'Received malformed control RPC frame' });
          return;
        }
        deliverControl(frame);
        return;
      }
      onControlError?.({ kind: 'unknown-prefix', message: `Unknown text lane prefix: ${JSON.stringify(data[0])}` });
      return;
    }

    const bytes = toBytes(data);
    if (!bytes || bytes.byteLength === 0 || bytes[0] !== LINK_BINARY_PREFIX) {
      onControlError?.({ kind: 'unknown-prefix', message: 'Received binary frame without Link prefix byte (0x00)' });
      return;
    }
    deliverLink(bytes.subarray(1));
  });

  raw.onClose(() => {
    finishClose();
  });

  const link: RawTransport = {
    send(data) {
      if (closed) return;
      if (typeof data === 'string') {
        raw.send(LINK_TEXT_PREFIX + data);
        return;
      }
      const prefixed = new Uint8Array(data.byteLength + 1);
      prefixed[0] = LINK_BINARY_PREFIX;
      prefixed.set(data, 1);
      raw.send(prefixed);
    },
    onData(listener) {
      if (closed) return;
      const wasEmpty = linkListeners.length === 0;
      linkListeners.push(listener);
      if (wasEmpty && queuedLink.length > 0) {
        for (const item of queuedLink.splice(0)) {
          if (closed) break;
          for (const heard of linkListeners.slice()) {
            if (closed) break;
            heard(item);
          }
        }
      }
    },
    onClose,
    close: closeAll,
    ...(raw.most !== undefined ? { most: Math.max(0, raw.most - 1) } : {}),
    ...(raw.waiting !== undefined ? { waiting: () => raw.waiting!() } : {}),
  };

  const control: ControlLane = {
    send(frame) {
      if (closed) {
        throw new ControlRpcError('TRANSPORT_CLOSED', 'Control transport is closed');
      }
      let serialized: string;
      try {
        serialized = CONTROL_TEXT_PREFIX + JSON.stringify(frame);
      } catch (error) {
        throw new ControlRpcError('SERIALIZE_ERROR', error instanceof Error ? error.message : String(error));
      }
      if (exceedsUtf8Limit(serialized, maxControlFrameBytes)) {
        throw new ControlRpcError(
          'FRAME_TOO_LARGE',
          `Control frame exceeds limit of ${maxControlFrameBytes} bytes`,
        );
      }
      raw.send(serialized);
    },
    onFrame(listener) {
      if (closed) return () => {};
      const wasEmpty = controlListeners.length === 0;
      controlListeners.push(listener);
      if (wasEmpty && queuedControl.length > 0) {
        for (const frame of queuedControl.splice(0)) {
          if (closed) break;
          for (const heard of controlListeners.slice()) {
            if (closed) break;
            heard(frame);
          }
        }
      }
      return () => {
        const index = controlListeners.indexOf(listener);
        if (index !== -1) controlListeners.splice(index, 1);
      };
    },
    onClose,
    close: closeAll,
    get closed() {
      return closed;
    },
    maxFrameBytes: maxControlFrameBytes,
  };

  return { link, control, close: closeAll };
}

/**
 * Attaches a typed Control RPC server to `lane`, handling `req`/`cancel` and `sub`/`unsub` frames.
 *
 * Automatically aborts in-flight requests and cleans up all active subscriptions when `lane` closes or
 * `dispose()` is called.
 */
export function createControlServer<C extends ControlContract = ControlContract>(
  lane: ControlLane,
  handlers: ControlServerHandlers<C>,
): ControlServer {
  const requests = (handlers.requests ?? {}) as Record<string, ControlRequestHandler | undefined>;
  const subscriptions = (handlers.subscriptions ?? {}) as Record<string, ControlSubscriptionHandler | undefined>;

  const activeRequests = new Map<number, AbortController>();
  const activeSubscriptions = new Map<number, { teardown: (reason: ControlRpcError) => void }>();
  let disposed = false;

  const trySend = (frame: ControlFrame): void => {
    if (disposed || lane.closed) return;
    try {
      lane.send(frame);
    } catch {
      /* transport closed concurrently */
    }
  };

  const handleRequest = (id: number, method: string, input: unknown): void => {
    if (activeRequests.has(id) || activeSubscriptions.has(id)) {
      trySend({ type: 'res', id, ok: false, code: 'DUPLICATE_ID', message: `Duplicate control id: ${id}` });
      return;
    }
    const handler = Object.hasOwn(requests, method) ? requests[method] : undefined;
    if (!handler) {
      trySend({ type: 'res', id, ok: false, code: 'METHOD_NOT_FOUND', message: `Unknown control method: ${method}` });
      return;
    }

    const controller = new AbortController();
    activeRequests.set(id, controller);

    const run = async (): Promise<void> => {
      try {
        const value = await handler(input, { id, method, signal: controller.signal });
        if (activeRequests.get(id) !== controller) return;
        activeRequests.delete(id);
        if (disposed || lane.closed || controller.signal.aborted) return;
        try {
          lane.send({ type: 'res', id, ok: true, ...(value !== undefined ? { value } : {}) });
        } catch (sendError) {
          const rpcErr = toControlError(sendError);
          trySend({ type: 'res', id, ok: false, code: rpcErr.code, message: rpcErr.message });
        }
      } catch (error) {
        if (activeRequests.get(id) !== controller) return;
        activeRequests.delete(id);
        if (disposed || lane.closed || controller.signal.aborted) return;
        const rpcErr = toControlError(error);
        trySend({ type: 'res', id, ok: false, code: rpcErr.code, message: rpcErr.message });
      }
    };

    void run();
  };

  const handleSubscribe = (id: number, method: string, input: unknown): void => {
    if (activeRequests.has(id) || activeSubscriptions.has(id)) {
      trySend({ type: 'end', id, code: 'DUPLICATE_ID', message: `Duplicate control id: ${id}` });
      return;
    }
    const rawHandler = Object.hasOwn(subscriptions, method) ? subscriptions[method] : undefined;
    if (!rawHandler) {
      trySend({ type: 'end', id, code: 'METHOD_NOT_FOUND', message: `Unknown control subscription: ${method}` });
      return;
    }

    const coalesce = typeof rawHandler === 'function' ? false : rawHandler.coalesce === true;
    const setup = typeof rawHandler === 'function' ? rawHandler : rawHandler.subscribe;

    const controller = new AbortController();
    let active = true;
    let cleanup: (() => void) | undefined;
    let cleanupCalled = false;
    let hasPendingValue = false;
    let pendingValue: unknown;
    let flushScheduled = false;

    const runCleanup = (): void => {
      if (cleanupCalled || !cleanup) return;
      cleanupCalled = true;
      const fn = cleanup;
      cleanup = undefined;
      try { fn(); } catch { /* cleanup failure must not break teardown */ }
    };

    const closeLocal = (reason: ControlRpcError): void => {
      if (!active) return;
      active = false;
      hasPendingValue = false;
      pendingValue = undefined;
      activeSubscriptions.delete(id);
      controller.abort(reason);
      runCleanup();
    };

    const sendDataFrame = (value: unknown): boolean => {
      if (!active || disposed || lane.closed) return false;
      try {
        lane.send({ type: 'data', id, ...(value !== undefined ? { value } : {}) });
        return true;
      } catch (sendError) {
        const rpcErr = toControlError(sendError);
        closeLocal(rpcErr);
        trySend({ type: 'end', id, code: rpcErr.code, message: rpcErr.message });
        return false;
      }
    };

    const flushPending = (): void => {
      flushScheduled = false;
      if (!active || !hasPendingValue) return;
      const value = pendingValue;
      hasPendingValue = false;
      pendingValue = undefined;
      sendDataFrame(value);
    };

    const sink: ControlSubscriptionSink = {
      id,
      method,
      signal: controller.signal,
      get closed() {
        return !active;
      },
      push(value) {
        if (!active || disposed || lane.closed) return;
        if (!coalesce) {
          sendDataFrame(value);
          return;
        }
        pendingValue = value;
        hasPendingValue = true;
        if (!flushScheduled) {
          flushScheduled = true;
          queueMicrotask(flushPending);
        }
      },
      end(error) {
        if (!active) return;
        if (!error && hasPendingValue) {
          const finalValue = pendingValue;
          hasPendingValue = false;
          pendingValue = undefined;
          if (!sendDataFrame(finalValue)) return;
        }
        closeLocal(new ControlRpcError(error?.code ?? 'ENDED', error?.message ?? 'Subscription ended'));
        if (error) {
          trySend({ type: 'end', id, code: error.code ?? 'INTERNAL_ERROR', message: error.message });
        } else {
          trySend({ type: 'end', id });
        }
      },
    };

    activeSubscriptions.set(id, { teardown: closeLocal });

    const runSetup = async (): Promise<void> => {
      try {
        const maybeCleanup = await setup(input, sink);
        if (typeof maybeCleanup === 'function') {
          if (!active) {
            try { maybeCleanup(); } catch { /* cleanup failure must not break teardown */ }
          } else {
            cleanup = maybeCleanup;
          }
        }
      } catch (error) {
        if (!active) return;
        const rpcErr = toControlError(error);
        closeLocal(rpcErr);
        trySend({ type: 'end', id, code: rpcErr.code, message: rpcErr.message });
      }
    };

    void runSetup();
  };

  const unsubscribeLane = lane.onFrame((frame) => {
    if (disposed) return;
    switch (frame.type) {
      case 'req':
        handleRequest(frame.id, frame.method, frame.input);
        break;
      case 'cancel': {
        const controller = activeRequests.get(frame.id);
        if (controller) {
          activeRequests.delete(frame.id);
          controller.abort(new ControlRpcError('CANCELLED', 'Request cancelled'));
        }
        break;
      }
      case 'sub':
        handleSubscribe(frame.id, frame.method, frame.input);
        break;
      case 'unsub': {
        const sub = activeSubscriptions.get(frame.id);
        sub?.teardown(new ControlRpcError('UNSUBSCRIBED', 'Client unsubscribed'));
        break;
      }
      default:
        break;
    }
  });

  const teardownAll = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribeLane();
    const closedError = new ControlRpcError('TRANSPORT_CLOSED', 'Control transport closed');
    for (const controller of Array.from(activeRequests.values())) {
      controller.abort(closedError);
    }
    activeRequests.clear();
    for (const sub of Array.from(activeSubscriptions.values())) {
      sub.teardown(closedError);
    }
    activeSubscriptions.clear();
  };

  lane.onClose(teardownAll);

  return {
    get activeRequestCount() {
      return activeRequests.size;
    },
    get activeSubscriptionCount() {
      return activeSubscriptions.size;
    },
    dispose: teardownAll,
  };
}

/**
 * Attaches a typed Control RPC client to `lane`.
 *
 * Rejects all in-flight calls and terminates all active subscriptions with `TRANSPORT_CLOSED` when the
 * underlying transport closes or `dispose()` is called.
 */
export function createControlClient<C extends ControlContract = ControlContract>(
  lane: ControlLane,
): ControlClient<C> {
  let nextId = 1;
  let disposed = false;

  const inFlight = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: ControlRpcError) => void;
    cleanupSignal: () => void;
  }>();

  const subscriptions = new Map<number, {
    deliver: (value: unknown) => void;
    end: (error?: ControlRpcError) => void;
    abort: (error: ControlRpcError) => void;
  }>();

  const unsubscribeLane = lane.onFrame((frame) => {
    if (disposed) return;
    switch (frame.type) {
      case 'res': {
        const pending = inFlight.get(frame.id);
        if (!pending) return;
        inFlight.delete(frame.id);
        pending.cleanupSignal();
        if (frame.ok) {
          pending.resolve(frame.value);
        } else {
          pending.reject(new ControlRpcError(frame.code, frame.message));
        }
        break;
      }
      case 'data': {
        subscriptions.get(frame.id)?.deliver(frame.value);
        break;
      }
      case 'end': {
        const sub = subscriptions.get(frame.id);
        if (!sub) return;
        const err = frame.code !== undefined
          ? new ControlRpcError(frame.code, frame.message ?? frame.code)
          : undefined;
        sub.end(err);
        break;
      }
      default:
        break;
    }
  });

  const teardownAll = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribeLane();
    const closedError = new ControlRpcError('TRANSPORT_CLOSED', 'Control transport closed');
    for (const pending of Array.from(inFlight.values())) {
      pending.cleanupSignal();
      pending.reject(closedError);
    }
    inFlight.clear();
    for (const sub of Array.from(subscriptions.values())) {
      sub.abort(closedError);
    }
    subscriptions.clear();
  };

  lane.onClose(teardownAll);

  const client: ControlClient<C> = {
    call(method, ...args) {
      const [input, options] = args as [unknown, ControlCallOptions | undefined];
      if (disposed || lane.closed) {
        return Promise.reject(new ControlRpcError('TRANSPORT_CLOSED', 'Control transport is closed'));
      }
      if (options?.signal?.aborted) {
        return Promise.reject(new ControlRpcError('ABORTED', 'Control request aborted'));
      }

      const id = nextId++;
      return new Promise((resolve, reject) => {
        let cleanupSignal = (): void => {};
        if (options?.signal) {
          const signal = options.signal;
          const onAbort = (): void => {
            if (!inFlight.delete(id)) return;
            if (!disposed && !lane.closed) {
              try { lane.send({ type: 'cancel', id }); } catch { /* transport closed */ }
            }
            reject(new ControlRpcError('ABORTED', 'Control request aborted'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
          cleanupSignal = () => signal.removeEventListener('abort', onAbort);
        }

        inFlight.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          cleanupSignal,
        });

        try {
          lane.send({ type: 'req', id, method, ...(input !== undefined ? { input } : {}) });
        } catch (error) {
          if (inFlight.delete(id)) {
            cleanupSignal();
            reject(toControlError(error));
          }
        }
      });
    },

    subscribe(method, input, handlers, options) {
      if (disposed || lane.closed) {
        handlers.onEnd?.(new ControlRpcError('TRANSPORT_CLOSED', 'Control transport is closed'));
        return { unsubscribe() {}, get closed() { return true; } };
      }
      if (options?.signal?.aborted) {
        handlers.onEnd?.(new ControlRpcError('ABORTED', 'Control subscription aborted'));
        return { unsubscribe() {}, get closed() { return true; } };
      }

      const id = nextId++;
      const coalesce = options?.coalesce === true;
      let closed = false;
      let hasPendingValue = false;
      let pendingValue: unknown;
      let flushScheduled = false;
      let cleanupSignal = (): void => {};

      const flushPending = (): void => {
        flushScheduled = false;
        if (closed || !hasPendingValue) return;
        const value = pendingValue;
        hasPendingValue = false;
        pendingValue = undefined;
        handlers.onData(value as never);
      };

      const finish = (error: ControlRpcError | undefined, notifyEnd: boolean, flushFirst: boolean): void => {
        if (closed) return;
        if (flushFirst && hasPendingValue) {
          const finalValue = pendingValue;
          hasPendingValue = false;
          pendingValue = undefined;
          handlers.onData(finalValue as never);
          if (closed) return;
        }
        closed = true;
        hasPendingValue = false;
        pendingValue = undefined;
        subscriptions.delete(id);
        cleanupSignal();
        if (notifyEnd) handlers.onEnd?.(error);
      };

      const unsubscribe = (): void => {
        if (closed) return;
        finish(undefined, false, false);
        if (!disposed && !lane.closed) {
          try { lane.send({ type: 'unsub', id }); } catch { /* transport closed */ }
        }
      };

      if (options?.signal) {
        const signal = options.signal;
        const onAbort = (): void => {
          if (closed) return;
          finish(new ControlRpcError('ABORTED', 'Control subscription aborted'), true, false);
          if (!disposed && !lane.closed) {
            try { lane.send({ type: 'unsub', id }); } catch { /* transport closed */ }
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        cleanupSignal = () => signal.removeEventListener('abort', onAbort);
      }

      subscriptions.set(id, {
        deliver(value) {
          if (closed) return;
          if (!coalesce) {
            handlers.onData(value as never);
            return;
          }
          pendingValue = value;
          hasPendingValue = true;
          if (!flushScheduled) {
            flushScheduled = true;
            queueMicrotask(flushPending);
          }
        },
        end(error) {
          finish(error, true, error === undefined);
        },
        abort(error) {
          finish(error, true, false);
        },
      });

      try {
        lane.send({ type: 'sub', id, method, ...(input !== undefined ? { input } : {}) });
      } catch (error) {
        finish(toControlError(error), true, false);
      }

      return {
        unsubscribe,
        get closed() {
          return closed;
        },
      };
    },

    get pendingCallCount() {
      return inFlight.size;
    },
    get activeSubscriptionCount() {
      return subscriptions.size;
    },
    dispose: teardownAll,
  };

  return client;
}
