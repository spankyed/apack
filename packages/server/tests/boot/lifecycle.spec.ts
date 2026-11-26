import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createLifecycleBridge,
  type LifecycleProcess,
  type UtilityMessagePort,
  type UtilityParentPort,
  type WindowPortInfo,
} from '../../src/boot/lifecycle.ts';

function fakeMessagePort() {
  const emitter = new EventEmitter();
  let closed = false;
  const posted: unknown[] = [];
  const port: UtilityMessagePort = {
    on(event, listener) {
      emitter.on(event, listener);
    },
    postMessage(message) {
      posted.push(message);
    },
    start() {},
    close() {
      if (closed) return;
      closed = true;
      emitter.emit('close');
    },
  };
  return {
    port,
    posted,
    isClosed: () => closed,
    emitClose: () => { closed = true; emitter.emit('close'); },
  };
}

function fakeEnv(options: { withParentPort?: boolean; connected?: boolean } = {}) {
  const procEmitter = new EventEmitter();
  const portEmitter = new EventEmitter();
  const posted: unknown[] = [];

  const parentPort: UtilityParentPort | undefined = options.withParentPort === false
    ? undefined
    : {
        on(event, listener) {
          portEmitter.on(event, listener);
        },
        postMessage(message) {
          posted.push(message);
        },
      };

  const proc: LifecycleProcess = {
    on(event, listener) {
      procEmitter.on(event, listener);
    },
    connected: options.connected ?? false,
    parentPort,
  };

  return { proc, procEmitter, portEmitter, posted };
}

describe('boot lifecycle bridge', () => {
  it('records early parentPort shutdown during boot and invokes handler immediately on registration', () => {
    const { proc, portEmitter } = fakeEnv();
    const bridge = createLifecycleBridge(proc);
    bridge.installShutdownBridge();

    // Non-shutdown messages are ignored
    portEmitter.emit('message', { data: null });
    portEmitter.emit('message', { data: { type: 'ping' } });
    expect(bridge.isShutdownRequested()).toBe(false);

    // Shutdown arrives before WebSocket server is created
    portEmitter.emit('message', { data: { type: 'shutdown' } });
    expect(bridge.isShutdownRequested()).toBe(true);

    const handler = vi.fn();
    bridge.registerGracefulShutdown(handler);
    expect(handler).toHaveBeenCalledTimes(1);

    // Duplicate signals never re-run the shutdown handler
    portEmitter.emit('message', { data: { type: 'shutdown' } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('invokes registered shutdown handler once across parentPort, SIGTERM, and Node IPC disconnect', () => {
    const { proc, procEmitter, portEmitter } = fakeEnv({ connected: true });
    const bridge = createLifecycleBridge(proc);
    bridge.installShutdownBridge();
    bridge.installShutdownBridge(); // idempotent

    const handler = vi.fn();
    bridge.registerGracefulShutdown(handler);
    expect(handler).not.toHaveBeenCalled();

    procEmitter.emit('SIGTERM');
    portEmitter.emit('message', { data: { type: 'shutdown' } });
    procEmitter.emit('disconnect');

    expect(bridge.isShutdownRequested()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('triggers shutdown on Node IPC disconnect when running outside utilityProcess', () => {
    const { proc, procEmitter } = fakeEnv({ withParentPort: false, connected: true });
    const bridge = createLifecycleBridge(proc);
    const handler = vi.fn();
    bridge.registerGracefulShutdown(handler);

    procEmitter.emit('disconnect');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('posts structured ready message (with optional tool socket) to parentPort when available and no-ops otherwise', () => {
    const withPort = fakeEnv({ withParentPort: true });
    const bridge = createLifecycleBridge(withPort.proc);
    bridge.notifyServerReady(3042);
    bridge.notifyServerReady(3042, '/tmp/apack-501/api-abcdef0123456789.sock');
    expect(withPort.posted).toEqual([
      { type: 'ready', port: 3042 },
      { type: 'ready', port: 3042, socket: '/tmp/apack-501/api-abcdef0123456789.sock' },
    ]);

    const withoutPort = fakeEnv({ withParentPort: false });
    expect(() => createLifecycleBridge(withoutPort.proc).notifyServerReady(3042, '/tmp/a.sock')).not.toThrow();
  });

  it('tracks power state as level-triggered, replays suspend on late registration, and deduplicates transitions', () => {
    const { proc, portEmitter } = fakeEnv();
    const bridge = createLifecycleBridge(proc);
    bridge.installShutdownBridge();

    // Suspend arrives during boot before appClock registers
    portEmitter.emit('message', { data: { type: 'power', state: 'suspended' } });
    expect(bridge.powerState()).toBe('suspended');

    const seen: string[] = [];
    const unregister = bridge.registerPowerState((state) => seen.push(state));
    expect(seen).toEqual(['suspended']);

    // Duplicate suspend is ignored; resume transitions once; unknown states are ignored
    portEmitter.emit('message', { data: { type: 'power', state: 'suspended' } });
    portEmitter.emit('message', { data: { type: 'power', state: 'bogus' } });
    portEmitter.emit('message', { data: { type: 'power', state: 'active' } });
    portEmitter.emit('message', { data: { type: 'power', state: 'active' } });
    expect(seen).toEqual(['suspended', 'active']);

    // Unregistering stops delivery while bridge still tracks state
    unregister();
    portEmitter.emit('message', { data: { type: 'power', state: 'suspended' } });
    expect(seen).toEqual(['suspended', 'active']);
    expect(bridge.powerState()).toBe('suspended');
  });

  it('queues early window ports, drops ones that close before registration, and delivers live ones on register', () => {
    const { proc, portEmitter } = fakeEnv();
    const bridge = createLifecycleBridge(proc);
    bridge.installShutdownBridge();

    const alive = fakeMessagePort();
    const stale = fakeMessagePort();
    const later = fakeMessagePort();

    portEmitter.emit('message', { data: { type: 'window-port', windowId: 1, generation: 1 }, ports: [alive.port] });
    portEmitter.emit('message', { data: { type: 'window-port', windowId: 2, generation: 1 }, ports: [stale.port] });
    stale.emitClose();

    const received: Array<{ port: UtilityMessagePort; info: WindowPortInfo }> = [];
    const unsubscribe = bridge.registerWindowPortHandler((port, info) => {
      received.push({ port, info });
    });

    expect(received).toEqual([{ port: alive.port, info: { windowId: 1, generation: 1 } }]);

    portEmitter.emit('message', { data: { type: 'window-port', windowId: 3, generation: 1 }, ports: [later.port] });
    expect(received).toEqual([
      { port: alive.port, info: { windowId: 1, generation: 1 } },
      { port: later.port, info: { windowId: 3, generation: 1 } },
    ]);

    unsubscribe();
    const queuedAfterUnsub = fakeMessagePort();
    portEmitter.emit('message', { data: { type: 'window-port', windowId: 4, generation: 1 }, ports: [queuedAfterUnsub.port] });
    expect(received).toHaveLength(2);
    expect(queuedAfterUnsub.isClosed()).toBe(false);

    // Shutdown closes any queued unclaimed ports and rejects subsequent arrivals
    portEmitter.emit('message', { data: { type: 'shutdown' } });
    expect(queuedAfterUnsub.isClosed()).toBe(true);

    const afterShutdown = fakeMessagePort();
    portEmitter.emit('message', { data: { type: 'window-port', windowId: 5, generation: 1 }, ports: [afterShutdown.port] });
    expect(afterShutdown.isClosed()).toBe(true);
  });

  it('buffers early window-gone messages, validates windowId, delivers live ones, and clears on shutdown', () => {
    const { proc, portEmitter } = fakeEnv();
    const bridge = createLifecycleBridge(proc);
    bridge.installShutdownBridge();

    // Early valid messages queue; malformed windowId payloads are ignored
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: 11 } });
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: '12' } });
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: Number.NaN } });
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: Number.POSITIVE_INFINITY } });
    portEmitter.emit('message', { data: { type: 'window-gone' } });
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: 12 } });

    const seen: number[] = [];
    const unsubscribe = bridge.registerWindowGoneHandler((windowId) => {
      seen.push(windowId);
    });
    expect(seen).toEqual([11, 12]);

    // Live dispatch
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: 13 } });
    expect(seen).toEqual([11, 12, 13]);

    // Unsubscribe stops delivery and re-buffers until a new handler attaches or shutdown clears it
    unsubscribe();
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: 14 } });
    expect(seen).toEqual([11, 12, 13]);

    // Shutdown clears buffered events and drops subsequent arrivals
    portEmitter.emit('message', { data: { type: 'shutdown' } });
    portEmitter.emit('message', { data: { type: 'window-gone', windowId: 15 } });

    const afterShutdownSeen: number[] = [];
    bridge.registerWindowGoneHandler((windowId) => {
      afterShutdownSeen.push(windowId);
    });
    expect(afterShutdownSeen).toEqual([]);
  });
});
