import type { _BackendPortTransport, _HostBridge } from '@apackdev/sdk/fe';

const CHANNEL_REQUEST = 'api:request-port';
const CHANNEL_RELEASE = 'api:release-port';
const CHANNEL_PORT = 'api:port';
const CHANNEL_CLOSED = 'api:port-closed';

/** Structural slice of DOM `MessagePort` that preload wraps without exposing the raw port across `contextBridge`. */
export interface BackendPortLike {
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

export interface BackendPortIpcEvent {
  readonly ports?: readonly BackendPortLike[];
}

export interface BackendPortIpc {
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: BackendPortIpcEvent, data?: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: BackendPortIpcEvent, data?: unknown) => void): unknown;
}

export interface PageHideTarget {
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

/** Normalizes cross-realm `Uint8Array` views, matching `@apackdev/link`'s `port()` transport. */
function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]') {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

/**
 * Wraps a DOM `MessagePort` into a `_BackendPortTransport` matching `@apackdev/link`'s `Transport` contract.
 *
 * Uses the same `null` EOF sentinel as `@apackdev/link`'s `port()`, buffers early frames arriving before the
 * first `onData` listener attaches, and supports immediate host-notified close when main detects backend exit.
 */
export function wrapMessagePort(port: BackendPortLike): {
  transport: _BackendPortTransport;
  closeFromHost: () => void;
} {
  const dataListeners: Array<(message: string | Uint8Array) => void> = [];
  const closeListeners: Array<() => void> = [];
  const queued: Array<string | Uint8Array> = [];
  let closeQueued = false;
  let started = false;
  let closed = false;

  const finish = (sendEof: boolean): void => {
    if (closed) return;
    closed = true;
    dataListeners.length = 0;
    queued.length = 0;
    closeQueued = false;
    try { port.removeEventListener('message', onMessage); } catch { /* already closed */ }
    if (sendEof) {
      try { port.postMessage(null); } catch { /* already closed */ }
    }
    try { port.close(); } catch { /* already closed */ }
    for (const listener of closeListeners.splice(0)) listener();
  };

  const onMessage = (event: { readonly data: unknown }): void => {
    if (closed || closeQueued) return;
    const { data } = event;
    if (data === null) {
      if (dataListeners.length === 0 && queued.length > 0) {
        closeQueued = true;
        try { port.removeEventListener('message', onMessage); } catch { /* already closed */ }
        try { port.close(); } catch { /* already closed */ }
        return;
      }
      finish(false);
      return;
    }
    const message = typeof data === 'string' ? data : toBytes(data);
    if (message === undefined) return;
    if (dataListeners.length === 0) {
      queued.push(message);
      return;
    }
    for (const listener of dataListeners.slice()) {
      if (closed) break;
      listener(message);
    }
  };

  port.addEventListener('message', onMessage);

  const transport: _BackendPortTransport = {
    send(message) {
      if (closed) return;
      try { port.postMessage(message); } catch { finish(false); }
    },
    onData(listener) {
      if (closed) return;
      dataListeners.push(listener);
      if (!started) {
        started = true;
        for (const message of queued.splice(0)) {
          if (closed) break;
          for (const heard of dataListeners.slice()) {
            if (closed) break;
            heard(message);
          }
        }
        if (closeQueued) {
          closeQueued = false;
          finish(false);
          return;
        }
        if (!closed) port.start();
      }
    },
    onClose(listener) {
      if (closed) {
        listener();
        return;
      }
      closeListeners.push(listener);
    },
    close() {
      finish(true);
    },
  };

  return {
    transport,
    closeFromHost: () => finish(false),
  };
}

/**
 * Creates the preload `backendPort` bridge bound to `ipc` and optional `pageTarget` (`window`).
 *
 * Sends `api:request-port` only when `connect()` is called so existing windows pay zero overhead until Wave 0
 * attaches, closes the active port on `pagehide` or `api:port-closed`, and leaves zero listeners on unsubscribe.
 */
export function createBackendPortBridge(
  ipc: BackendPortIpc,
  pageTarget?: PageHideTarget,
): _HostBridge['backendPort'] {
  let activeSubscribers = 0;

  return {
    connect(onPort) {
      let unsubscribed = false;
      let active: { generation: number; transport: _BackendPortTransport; closeFromHost: () => void } | undefined;
      activeSubscribers += 1;

      const handlePort = (event: BackendPortIpcEvent, data?: unknown): void => {
        const incoming = event.ports?.[0];
        if (!incoming) return;
        if (unsubscribed) {
          try { incoming.close(); } catch { /* already closed */ }
          return;
        }
        const generation = typeof (data as { generation?: unknown } | undefined)?.generation === 'number'
          ? (data as { generation: number }).generation
          : 0;
        if (active && generation < active.generation) {
          try { incoming.close(); } catch { /* already closed */ }
          return;
        }
        const previous = active;
        active = undefined;
        previous?.closeFromHost();
        const wrapped = wrapMessagePort(incoming);
        active = { generation, transport: wrapped.transport, closeFromHost: wrapped.closeFromHost };
        onPort(wrapped.transport, { generation });
      };

      const handlePortClosed = (_event: BackendPortIpcEvent, data?: unknown): void => {
        if (!active) return;
        const closedGeneration = (data as { generation?: unknown } | undefined)?.generation;
        if (typeof closedGeneration === 'number' && closedGeneration !== active.generation) return;
        const current = active;
        active = undefined;
        current.closeFromHost();
      };

      const handlePageHide = (): void => {
        const current = active;
        active = undefined;
        current?.transport.close();
      };

      ipc.on(CHANNEL_PORT, handlePort);
      ipc.on(CHANNEL_CLOSED, handlePortClosed);
      pageTarget?.addEventListener('pagehide', handlePageHide);
      ipc.send(CHANNEL_REQUEST);

      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        activeSubscribers = Math.max(0, activeSubscribers - 1);
        ipc.removeListener(CHANNEL_PORT, handlePort);
        ipc.removeListener(CHANNEL_CLOSED, handlePortClosed);
        pageTarget?.removeEventListener('pagehide', handlePageHide);
        const current = active;
        active = undefined;
        current?.transport.close();
        if (activeSubscribers === 0) {
          ipc.send(CHANNEL_RELEASE);
        }
      };
    },
  };
}
