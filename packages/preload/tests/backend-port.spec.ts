import { describe, expect, it } from 'vitest';
import type { _BackendPortTransport } from '@apackdev/sdk/fe';
import {
  createBackendPortBridge,
  type BackendPortIpc,
  type BackendPortIpcEvent,
  type BackendPortLike,
  type PageHideTarget,
} from '../src/backend-port.ts';

function fakeDomPort() {
  const listeners = new Set<(event: { readonly data: unknown }) => void>();
  const posted: unknown[] = [];
  let started = false;
  let closed = false;

  const port: BackendPortLike = {
    postMessage(message) {
      posted.push(message);
    },
    start() {
      started = true;
    },
    close() {
      closed = true;
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };

  return {
    port,
    posted,
    isStarted: () => started,
    isClosed: () => closed,
    listenerCount: () => listeners.size,
    deliver(data: unknown) {
      for (const listener of Array.from(listeners)) listener({ data });
    },
  };
}

function fakeHarness() {
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  const ipcListeners = new Map<string, Array<(event: BackendPortIpcEvent, data?: unknown) => void>>();
  const pageHideListeners = new Set<() => void>();

  const ipc: BackendPortIpc = {
    send(channel, ...args) {
      sent.push({ channel, args });
    },
    on(channel, listener) {
      ipcListeners.set(channel, [...(ipcListeners.get(channel) ?? []), listener]);
    },
    removeListener(channel, listener) {
      ipcListeners.set(channel, (ipcListeners.get(channel) ?? []).filter((each) => each !== listener));
    },
  };

  const pageTarget: PageHideTarget = {
    addEventListener(_type, listener) {
      pageHideListeners.add(listener);
    },
    removeEventListener(_type, listener) {
      pageHideListeners.delete(listener);
    },
  };

  const emitIpc = (channel: string, event: BackendPortIpcEvent, data?: unknown) => {
    for (const listener of (ipcListeners.get(channel) ?? []).slice()) listener(event, data);
  };

  const emitPageHide = () => {
    for (const listener of Array.from(pageHideListeners)) listener();
  };

  const listenerCount = () => [...ipcListeners.values()].reduce((sum, list) => sum + list.length, 0);

  return { ipc, pageTarget, sent, emitIpc, emitPageHide, listenerCount, pageHideCount: () => pageHideListeners.size };
}

describe('backendPort preload bridge', () => {
  it('requests a port only on connect(), delivers buffered + live text/bytes, and honors EOF sentinel', () => {
    const h = fakeHarness();
    const bridge = createBackendPortBridge(h.ipc, h.pageTarget);
    expect(h.sent).toEqual([]);

    const ports: Array<{ transport: _BackendPortTransport; generation: number }> = [];
    const unsubscribe = bridge.connect((transport, info) => {
      ports.push({ transport, generation: info.generation });
    });

    expect(h.sent).toEqual([{ channel: 'api:request-port', args: [] }]);
    expect(h.listenerCount()).toBe(2);
    expect(h.pageHideCount()).toBe(1);

    const domPort = fakeDomPort();
    h.emitIpc('api:port', { ports: [domPort.port] }, { generation: 1 });
    expect(ports).toHaveLength(1);
    expect(ports[0]!.generation).toBe(1);
    expect(domPort.isStarted()).toBe(false);

    // Messages arriving before onData are queued in order; EOF sentinel waits until queue drains
    domPort.deliver('early-1');
    domPort.deliver(Uint8Array.of(1, 2, 3));
    domPort.deliver(null);
    expect(domPort.isClosed()).toBe(true);

    const received: Array<string | Uint8Array> = [];
    let closedCount = 0;
    ports[0]!.transport.onClose(() => { closedCount += 1; });
    expect(closedCount).toBe(0);

    ports[0]!.transport.onData((msg) => received.push(msg));
    expect(received).toEqual(['early-1', Uint8Array.of(1, 2, 3)]);
    expect(closedCount).toBe(1);

    // Late onClose registration fires immediately once closed
    let lateClosed = 0;
    ports[0]!.transport.onClose(() => { lateClosed += 1; });
    expect(lateClosed).toBe(1);

    unsubscribe();
    expect(h.listenerCount()).toBe(0);
    expect(h.pageHideCount()).toBe(0);
  });

  it('sends text/bytes, closes cleanly with null EOF on local close, and closes without EOF on api:port-closed', () => {
    const h = fakeHarness();
    const bridge = createBackendPortBridge(h.ipc, h.pageTarget);
    const seen: _BackendPortTransport[] = [];
    const unsubscribe = bridge.connect((transport) => seen.push(transport));

    const p1 = fakeDomPort();
    h.emitIpc('api:port', { ports: [p1.port] }, { generation: 1 });
    const t1 = seen[0]!;
    const received: Array<string | Uint8Array> = [];
    let t1Closed = 0;
    t1.onData((msg) => received.push(msg));
    t1.onClose(() => { t1Closed += 1; });
    expect(p1.isStarted()).toBe(true);

    t1.send('hello');
    t1.send(Uint8Array.of(9, 8));
    p1.deliver('world');
    expect(p1.posted).toEqual(['hello', Uint8Array.of(9, 8)]);
    expect(received).toEqual(['world']);

    // Stale generation close notification is ignored
    h.emitIpc('api:port-closed', {}, { generation: 99 });
    expect(t1Closed).toBe(0);
    expect(p1.isClosed()).toBe(false);

    // Matching generation close notification closes port immediately without posting null to dead backend
    h.emitIpc('api:port-closed', {}, { generation: 1 });
    expect(t1Closed).toBe(1);
    expect(p1.isClosed()).toBe(true);
    expect(p1.posted).toEqual(['hello', Uint8Array.of(9, 8)]);

    // Backend restart hands off generation 2; local close posts null EOF once
    const p2 = fakeDomPort();
    h.emitIpc('api:port', { ports: [p2.port] }, { generation: 2 });
    const t2 = seen[1]!;
    let t2Closed = 0;
    t2.onClose(() => { t2Closed += 1; });
    t2.close();
    t2.close();
    t2.send('after-close');
    expect(t2Closed).toBe(1);
    expect(p2.isClosed()).toBe(true);
    expect(p2.posted).toEqual([null]);

    unsubscribe();
  });

  it('closes active transport on pagehide and closes superseded ports on fresh handoff', () => {
    const h = fakeHarness();
    const bridge = createBackendPortBridge(h.ipc, h.pageTarget);
    const seen: _BackendPortTransport[] = [];
    const unsubscribe = bridge.connect((transport) => seen.push(transport));

    const p1 = fakeDomPort();
    const p2 = fakeDomPort();
    h.emitIpc('api:port', { ports: [p1.port] }, { generation: 1 });
    let t1Closed = 0;
    seen[0]!.onClose(() => { t1Closed += 1; });

    // A fresh generation arriving while t1 is open closes t1 first
    h.emitIpc('api:port', { ports: [p2.port] }, { generation: 2 });
    expect(t1Closed).toBe(1);
    expect(p1.isClosed()).toBe(true);

    let t2Closed = 0;
    seen[1]!.onClose(() => { t2Closed += 1; });
    h.emitPageHide();
    expect(t2Closed).toBe(1);
    expect(p2.isClosed()).toBe(true);
    expect(p2.posted).toEqual([null]);

    unsubscribe();
  });

  it('rejects concurrent connect() calls without attaching listeners or re-requesting, and allows re-subscribing after unsubscribe', () => {
    const h = fakeHarness();
    const bridge = createBackendPortBridge(h.ipc, h.pageTarget);
    const firstSeen: _BackendPortTransport[] = [];
    const secondSeen: _BackendPortTransport[] = [];

    const unsubscribeFirst = bridge.connect((transport) => firstSeen.push(transport));
    expect(h.sent).toEqual([{ channel: 'api:request-port', args: [] }]);
    expect(h.listenerCount()).toBe(2);
    expect(h.pageHideCount()).toBe(1);

    // Second concurrent connect() throws and leaves IPC listeners & requests untouched
    expect(() => bridge.connect((transport) => secondSeen.push(transport))).toThrow(/active subscriber/i);
    expect(h.sent).toEqual([{ channel: 'api:request-port', args: [] }]);
    expect(h.listenerCount()).toBe(2);
    expect(h.pageHideCount()).toBe(1);

    const p1 = fakeDomPort();
    h.emitIpc('api:port', { ports: [p1.port] }, { generation: 1 });
    expect(firstSeen).toHaveLength(1);
    expect(secondSeen).toHaveLength(0);

    // Unsubscribing closes the active port and releases the single-subscriber slot
    unsubscribeFirst();
    expect(p1.isClosed()).toBe(true);
    expect(h.listenerCount()).toBe(0);
    expect(h.pageHideCount()).toBe(0);

    // Subsequent connect() succeeds and receives the fresh handoff
    const unsubscribeSecond = bridge.connect((transport) => secondSeen.push(transport));
    expect(h.sent).toEqual([
      { channel: 'api:request-port', args: [] },
      { channel: 'api:request-port', args: [] },
    ]);
    expect(h.listenerCount()).toBe(2);
    expect(h.pageHideCount()).toBe(1);

    // Calling the stale first unsubscribe again does NOT release the second subscriber's lock
    unsubscribeFirst();
    expect(() => bridge.connect(() => {})).toThrow(/active subscriber/i);
    expect(h.listenerCount()).toBe(2);

    const p2 = fakeDomPort();
    h.emitIpc('api:port', { ports: [p2.port] }, { generation: 2 });
    expect(secondSeen).toHaveLength(1);

    unsubscribeSecond();
    expect(h.listenerCount()).toBe(0);
    expect(h.pageHideCount()).toBe(0);
  });
});
