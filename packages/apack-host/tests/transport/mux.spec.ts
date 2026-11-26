import { describe, expect, it, vi } from 'vitest';
import {
  ControlRpcError,
  DEFAULT_MAX_CONTROL_FRAME_BYTES,
  createControlClient,
  createControlServer,
  muxTransport,
  type ControlContract,
  type ControlSubscriptionSink,
  type MuxControlError,
  type RawMessage,
  type RawTransport,
} from '../../src/transport/mux.ts';

interface MemoryPairOptions {
  readonly most?: number;
  readonly waiting?: () => number;
  readonly deliver?: (run: () => void) => void;
}

/** In-memory bidirectional `RawTransport` pair for deterministic tests (no timers). */
function createMemoryPair(options: MemoryPairOptions = {}): {
  readonly a: RawTransport;
  readonly b: RawTransport;
  readonly wireFromA: RawMessage[];
  readonly wireFromB: RawMessage[];
  injectRawToA(frame: RawMessage): void;
  injectRawToB(frame: RawMessage): void;
} {
  const deliver = options.deliver ?? queueMicrotask;
  const wireFromA: RawMessage[] = [];
  const wireFromB: RawMessage[] = [];

  const ends = [0, 1].map(() => {
    const dataListeners: Array<(data: RawMessage) => void> = [];
    const closeListeners: Array<() => void> = [];
    let closed = false;
    const fireClose = () => {
      if (closed) return;
      closed = true;
      dataListeners.length = 0;
      for (const listener of closeListeners.splice(0)) listener();
    };
    return {
      dataListeners,
      closeListeners,
      isClosed: () => closed,
      fireClose,
      deliverData(data: RawMessage) {
        if (closed) return;
        for (const listener of dataListeners.slice()) {
          if (closed) break;
          listener(data);
        }
      },
    };
  });

  const make = (mine: 0 | 1, wire: RawMessage[]): RawTransport => {
    const here = ends[mine]!;
    const there = ends[1 - mine]!;
    return {
      send(data) {
        if (here.isClosed()) return;
        wire.push(data);
        deliver(() => there.deliverData(data));
      },
      onData(listener) {
        if (here.isClosed()) return;
        here.dataListeners.push(listener);
      },
      onClose(listener) {
        if (here.isClosed()) {
          listener();
          return;
        }
        here.closeListeners.push(listener);
      },
      close() {
        if (here.isClosed()) return;
        here.fireClose();
        deliver(() => there.fireClose());
      },
      ...(options.most !== undefined ? { most: options.most } : {}),
      ...(options.waiting !== undefined ? { waiting: options.waiting } : {}),
    };
  };

  return {
    a: make(0, wireFromA),
    b: make(1, wireFromB),
    wireFromA,
    wireFromB,
    injectRawToA(frame) {
      ends[0]!.deliverData(frame);
    },
    injectRawToB(frame) {
      ends[1]!.deliverData(frame);
    },
  };
}

async function flushMicrotasks(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

interface TestContract extends ControlContract {
  requests: {
    echo: { input: { text: string }; output: string };
    ping: { input: void; output: 'pong' };
    slow: { input: { tag: string }; output: string };
    failCoded: { input: void; output: never };
    failPlain: { input: void; output: never };
    huge: { input: { size: number }; output: string };
  };
  subscriptions: {
    ticks: { input: { prefix: string }; output: string };
    'packs.catalog': { input: void; output: { revision: number; ids: string[] } };
    asyncSetup: { input: void; output: string };
    failSetup: { input: void; output: string };
  };
}

describe('muxTransport', () => {
  it('frames string and binary Link messages with L / 0x00 prefixes and queues early arrivals', async () => {
    const pair = createMemoryPair();
    const muxA = muxTransport(pair.a);
    const muxB = muxTransport(pair.b);

    // Send before B attaches link.onData to verify early queuing
    muxA.link.send('hello');
    muxA.link.send('');
    muxA.link.send(Uint8Array.of(0x01, 0x02, 0xff));
    muxA.link.send(new Uint8Array(0));

    await flushMicrotasks();

    // Verify exact wire prefixes
    expect(pair.wireFromA).toEqual([
      'Lhello',
      'L',
      Uint8Array.of(0x00, 0x01, 0x02, 0xff),
      Uint8Array.of(0x00),
    ]);

    const receivedB: RawMessage[] = [];
    muxB.link.onData((data) => receivedB.push(data));
    expect(receivedB).toEqual([
      'hello',
      '',
      Uint8Array.of(0x01, 0x02, 0xff),
      new Uint8Array(0),
    ]);

    // Bidirectional live delivery from B -> A
    const receivedA: RawMessage[] = [];
    muxA.link.onData((data) => receivedA.push(data));
    muxB.link.send('reply');
    muxB.link.send(Uint8Array.of(9, 8, 7));
    await flushMicrotasks();
    expect(receivedA).toEqual(['reply', Uint8Array.of(9, 8, 7)]);
  });

  it('forwards most (decremented by 1, floored at 0) and waiting() dynamically', () => {
    let buffered = 128;
    const withBounds = createMemoryPair({ most: 1024, waiting: () => buffered });
    const muxBounded = muxTransport(withBounds.a);
    expect(muxBounded.link.most).toBe(1023);
    expect(muxBounded.link.waiting?.()).toBe(128);
    buffered = 512;
    expect(muxBounded.link.waiting?.()).toBe(512);

    const zeroBound = createMemoryPair({ most: 0 });
    expect(muxTransport(zeroBound.a).link.most).toBe(0);

    const oneBound = createMemoryPair({ most: 1 });
    expect(muxTransport(oneBound.a).link.most).toBe(0);

    const unbounded = createMemoryPair();
    const muxUnbounded = muxTransport(unbounded.a);
    expect(muxUnbounded.link.most).toBeUndefined();
    expect('most' in muxUnbounded.link).toBe(false);
    expect(muxUnbounded.link.waiting).toBeUndefined();
    expect('waiting' in muxUnbounded.link).toBe(false);
  });

  it('isolates Link and Control lanes and drops malformed, oversized, or unknown frames safely', async () => {
    const errorsA: MuxControlError[] = [];
    const errorsB: MuxControlError[] = [];
    const pair = createMemoryPair();
    const muxA = muxTransport(pair.a, { maxControlFrameBytes: 64, onControlError: (err) => errorsA.push(err) });
    const muxB = muxTransport(pair.b, { maxControlFrameBytes: 64, onControlError: (err) => errorsB.push(err) });

    const linkSeenB: RawMessage[] = [];
    const controlSeenB: unknown[] = [];
    muxB.link.onData((data) => linkSeenB.push(data));
    muxB.control.onFrame((frame) => controlSeenB.push(frame));

    // Interleave valid link & control frames
    muxA.link.send('link-1');
    muxA.control.send({ type: 'req', id: 1, method: 'ping' });
    muxA.link.send(Uint8Array.of(42));
    await flushMicrotasks();

    expect(linkSeenB).toEqual(['link-1', Uint8Array.of(42)]);
    expect(controlSeenB).toEqual([{ type: 'req', id: 1, method: 'ping' }]);

    // Inject malformed, oversized (ASCII + multi-byte UTF-8), and bad-prefix frames directly into B
    pair.injectRawToB('C{not-valid-json');
    pair.injectRawToB('Cnull');
    pair.injectRawToB('C{"type":"req","id":-1,"method":"x"}');
    pair.injectRawToB('C{"type":"res","id":1,"ok":false}');
    pair.injectRawToB('C{"type":"bogus","id":1}');
    pair.injectRawToB('C' + JSON.stringify({ type: 'req', id: 2, method: 'x', input: 'a'.repeat(80) }));
    // Multi-byte UTF-8 string whose .length <= 64 but UTF-8 byte length > 64 (each '€' is 3 UTF-8 bytes)
    pair.injectRawToB('C' + JSON.stringify({ type: 'data', id: 3, value: '€'.repeat(18) }));
    pair.injectRawToB('Xunknown-prefix');
    pair.injectRawToB('');
    pair.injectRawToB(new Uint8Array(0));
    pair.injectRawToB(Uint8Array.of(0x01, 0x02));

    expect(errorsB.map((err) => err.kind)).toEqual([
      'malformed',
      'malformed',
      'malformed',
      'malformed',
      'malformed',
      'oversized',
      'oversized',
      'unknown-prefix',
      'unknown-prefix',
      'unknown-prefix',
      'unknown-prefix',
    ]);
    // Zero leakage into either lane
    expect(linkSeenB).toEqual(['link-1', Uint8Array.of(42)]);
    expect(controlSeenB).toEqual([{ type: 'req', id: 1, method: 'ping' }]);

    // Subsequent valid frames on both lanes still flow cleanly
    muxA.link.send('link-2');
    muxA.control.send({ type: 'cancel', id: 1 });
    await flushMicrotasks();
    expect(linkSeenB).toEqual(['link-1', Uint8Array.of(42), 'link-2']);
    expect(controlSeenB).toEqual([
      { type: 'req', id: 1, method: 'ping' },
      { type: 'cancel', id: 1 },
    ]);
    expect(errorsA).toEqual([]);
  });

  it('enforces default and configured maxControlFrameBytes bounds', () => {
    const pair = createMemoryPair();
    const defaultMux = muxTransport(pair.a);
    expect(defaultMux.control.maxFrameBytes).toBe(DEFAULT_MAX_CONTROL_FRAME_BYTES);
    expect(DEFAULT_MAX_CONTROL_FRAME_BYTES).toBe(4 * 1024 * 1024);

    const smallMux = muxTransport(pair.b, { maxControlFrameBytes: 40 });
    expect(() => smallMux.control.send({ type: 'data', id: 1, value: 'x'.repeat(50) })).toThrow(ControlRpcError);
    expect(() => muxTransport(pair.a, { maxControlFrameBytes: 1 })).toThrow(RangeError);
  });
});

describe('Control RPC server & client', () => {
  it('handles typed req/res success, errors, unknown methods, oversized responses, and AbortSignal cancel', async () => {
    const pair = createMemoryPair();
    const clientMux = muxTransport(pair.a, { maxControlFrameBytes: 128 });
    const serverMux = muxTransport(pair.b, { maxControlFrameBytes: 128 });

    let slowAborted = false;
    let resolveSlow!: (value: string) => void;

    const server = createControlServer<TestContract>(serverMux.control, {
      requests: {
        echo: ({ text }) => `echo:${text}`,
        ping: () => 'pong',
        slow: (_input, { signal }) =>
          new Promise<string>((resolve) => {
            signal.addEventListener('abort', () => {
              slowAborted = true;
            }, { once: true });
            resolveSlow = resolve;
          }),
        failCoded: () => {
          throw new ControlRpcError('UNAUTHORIZED', 'secret denied');
        },
        failPlain: () => {
          throw new Error('boom');
        },
        huge: ({ size }) => 'z'.repeat(size),
      },
    });
    const client = createControlClient<TestContract>(clientMux.control);

    // Success calls
    await expect(client.call('echo', { text: 'hi' })).resolves.toBe('echo:hi');
    await expect(client.call('ping')).resolves.toBe('pong');

    // Coded and plain errors
    await expect(client.call('failCoded')).rejects.toMatchObject({
      name: 'ControlRpcError',
      code: 'UNAUTHORIZED',
      message: 'secret denied',
    });
    await expect(client.call('failPlain')).rejects.toMatchObject({
      name: 'ControlRpcError',
      code: 'INTERNAL_ERROR',
      message: 'boom',
    });

    // Unknown method
    await expect((client as unknown as { call(m: string): Promise<unknown> }).call('nope')).rejects.toMatchObject({
      code: 'METHOD_NOT_FOUND',
    });

    // Oversized request fails cleanly on client without leaking pendingCallCount
    await expect(client.call('echo', { text: 'a'.repeat(200) })).rejects.toMatchObject({
      code: 'FRAME_TOO_LARGE',
    });
    expect(client.pendingCallCount).toBe(0);

    // Oversized server response returns FRAME_TOO_LARGE to client instead of hanging
    await expect(client.call('huge', { size: 200 })).rejects.toMatchObject({
      code: 'FRAME_TOO_LARGE',
    });
    expect(client.pendingCallCount).toBe(0);
    expect(server.activeRequestCount).toBe(0);

    // Pre-aborted AbortSignal rejects immediately without sending anything
    const preAborted = new AbortController();
    preAborted.abort();
    const wireCountBefore = pair.wireFromA.length;
    await expect(client.call('ping', undefined, { signal: preAborted.signal })).rejects.toMatchObject({
      code: 'ABORTED',
    });
    expect(pair.wireFromA.length).toBe(wireCountBefore);

    // In-flight cancel aborts server handler and suppresses late responses
    const inFlightAbort = new AbortController();
    const slowPromise = client.call('slow', { tag: 'x' }, { signal: inFlightAbort.signal });
    await flushMicrotasks();
    expect(server.activeRequestCount).toBe(1);
    expect(client.pendingCallCount).toBe(1);

    inFlightAbort.abort();
    await expect(slowPromise).rejects.toMatchObject({ code: 'ABORTED' });
    await flushMicrotasks();
    expect(slowAborted).toBe(true);
    expect(server.activeRequestCount).toBe(0);
    expect(client.pendingCallCount).toBe(0);

    // Late resolution after cancel does not crash or send a stale res
    const serverWireBefore = pair.wireFromB.length;
    resolveSlow('too-late');
    await flushMicrotasks();
    expect(pair.wireFromB.length).toBe(serverWireBefore);
  });

  it('supports streaming subscriptions, unsub cleanup (including async setup race), and server/client latest-value coalescing', async () => {
    const pair = createMemoryPair();
    const clientMux = muxTransport(pair.a);
    const serverMux = muxTransport(pair.b);

    let tickSink!: ControlSubscriptionSink<string>;
    let tickCleanedUp = 0;
    let catalogSink!: ControlSubscriptionSink<{ revision: number; ids: string[] }>;
    let catalogCleanedUp = 0;
    let resolveAsyncSetup!: (cleanup: () => void) => void;
    const asyncCleanupSpy = vi.fn();

    const server = createControlServer<TestContract>(serverMux.control, {
      subscriptions: {
        ticks: (_input, sink) => {
          tickSink = sink;
          return () => {
            tickCleanedUp += 1;
          };
        },
        'packs.catalog': {
          coalesce: true,
          subscribe: (_input, sink) => {
            catalogSink = sink;
            return () => {
              catalogCleanedUp += 1;
            };
          },
        },
        asyncSetup: () =>
          new Promise<() => void>((resolve) => {
            resolveAsyncSetup = resolve;
          }),
        failSetup: () => {
          throw new ControlRpcError('BAD_FILTER', 'invalid filter');
        },
      },
    });
    const client = createControlClient<TestContract>(clientMux.control);

    // 1. Ordered streaming subscription + unsub cleanup
    const ticksReceived: string[] = [];
    const tickEnds: Array<ControlRpcError | undefined> = [];
    const tickHandle = client.subscribe('ticks', { prefix: 't' }, {
      onData: (v) => ticksReceived.push(v),
      onEnd: (err) => tickEnds.push(err),
    });
    await flushMicrotasks();
    tickSink.push('a');
    tickSink.push('b');
    await flushMicrotasks();
    expect(ticksReceived).toEqual(['a', 'b']);

    tickHandle.unsubscribe();
    expect(tickHandle.closed).toBe(true);
    await flushMicrotasks();
    expect(tickSink.closed).toBe(true);
    expect(tickSink.signal.aborted).toBe(true);
    expect(tickCleanedUp).toBe(1);
    expect(tickEnds).toEqual([]);
    // Pushing after unsubscribe is ignored
    tickSink.push('c');
    await flushMicrotasks();
    expect(ticksReceived).toEqual(['a', 'b']);

    // 2. Server-side latest-value coalescing (packs.catalog burst sends only latest per turn, flushes final before clean end)
    const catalogReceived: Array<{ revision: number; ids: string[] }> = [];
    let catalogEndedCleanly = false;
    client.subscribe('packs.catalog', undefined, {
      onData: (snapshot) => catalogReceived.push(snapshot),
      onEnd: (err) => {
        if (err === undefined) catalogEndedCleanly = true;
      },
    });
    await flushMicrotasks();

    const serverWireBeforeBurst = pair.wireFromB.length;
    catalogSink.push({ revision: 1, ids: ['a'] });
    catalogSink.push({ revision: 2, ids: ['a', 'b'] });
    catalogSink.push({ revision: 3, ids: ['a', 'b', 'c'] });
    await flushMicrotasks();

    // Only ONE data frame crossed the wire for the entire synchronous burst
    expect(pair.wireFromB.length - serverWireBeforeBurst).toBe(1);
    expect(catalogReceived).toEqual([{ revision: 3, ids: ['a', 'b', 'c'] }]);

    // Second burst followed immediately by clean end() flushes latest value before end
    catalogSink.push({ revision: 4, ids: ['d'] });
    catalogSink.push({ revision: 5, ids: ['e'] });
    catalogSink.end();
    await flushMicrotasks();

    expect(catalogReceived).toEqual([
      { revision: 3, ids: ['a', 'b', 'c'] },
      { revision: 5, ids: ['e'] },
    ]);
    expect(catalogEndedCleanly).toBe(true);
    expect(catalogCleanedUp).toBe(1);

    // 3. Async setup race: unsub arrives before subscribe() resolves -> returned cleanup runs immediately
    const asyncHandle = client.subscribe('asyncSetup', undefined, { onData: () => {} });
    await flushMicrotasks();
    expect(server.activeSubscriptionCount).toBe(1);
    asyncHandle.unsubscribe();
    await flushMicrotasks();
    expect(server.activeSubscriptionCount).toBe(0);
    resolveAsyncSetup(asyncCleanupSpy);
    await flushMicrotasks();
    expect(asyncCleanupSpy).toHaveBeenCalledTimes(1);

    // 4. Failing subscription setup ends client subscription with structured error
    const failEnds: Array<ControlRpcError | undefined> = [];
    client.subscribe('failSetup', undefined, {
      onData: () => {},
      onEnd: (err) => failEnds.push(err),
    });
    await flushMicrotasks();
    expect(failEnds).toHaveLength(1);
    expect(failEnds[0]).toMatchObject({ code: 'BAD_FILTER', message: 'invalid filter' });

    // 5. Client-side coalescing on non-coalescing server stream (synchronous transport delivery)
    interface SyncTickContract extends ControlContract {
      subscriptions: {
        ticks: { input: { prefix: string }; output: string };
      };
    }
    const syncPair = createMemoryPair({ deliver: (fn) => fn() });
    const syncClientMux = muxTransport(syncPair.a);
    const syncServerMux = muxTransport(syncPair.b);
    let syncSink!: ControlSubscriptionSink<string>;
    createControlServer<SyncTickContract>(syncServerMux.control, {
      subscriptions: {
        ticks: (_input, sink) => {
          syncSink = sink;
        },
      },
    });
    const syncClient = createControlClient<SyncTickContract>(syncClientMux.control);
    const clientCoalesced: string[] = [];
    const clientCoalesceHandle = syncClient.subscribe('ticks', { prefix: 'c' }, {
      onData: (v) => clientCoalesced.push(v),
    }, { coalesce: true });
    syncSink.push('v1');
    syncSink.push('v2');
    syncSink.push('v3');
    await flushMicrotasks();
    expect(clientCoalesced).toEqual(['v3']);
    clientCoalesceHandle.unsubscribe();
    expect(syncSink.closed).toBe(true);

    expect(server.activeSubscriptionCount).toBe(0);
    expect(client.activeSubscriptionCount).toBe(0);
  });

  it('atomically tears down both lanes, rejects in-flight RPCs, and cleans up subscriptions when raw.close() fires', async () => {
    interface TeardownContract extends ControlContract {
      requests: {
        slow: { input: { tag: string }; output: string };
      };
      subscriptions: {
        ticks: { input: { prefix: string }; output: string };
      };
    }
    const pair = createMemoryPair();
    const clientMux = muxTransport(pair.a);
    const serverMux = muxTransport(pair.b);

    let serverRequestAborted = false;
    let serverSubAborted = false;
    let serverSubCleanedUp = 0;

    const server = createControlServer<TeardownContract>(serverMux.control, {
      requests: {
        slow: (_input, { signal }) =>
          new Promise<string>(() => {
            signal.addEventListener('abort', () => {
              serverRequestAborted = true;
            }, { once: true });
          }),
      },
      subscriptions: {
        ticks: (_input, sink) => {
          sink.signal.addEventListener('abort', () => {
            serverSubAborted = true;
          }, { once: true });
          return () => {
            serverSubCleanedUp += 1;
          };
        },
      },
    });
    const client = createControlClient<TeardownContract>(clientMux.control);

    let clientLinkClosed = 0;
    let clientControlClosed = 0;
    let serverLinkClosed = 0;
    let serverControlClosed = 0;
    clientMux.link.onClose(() => { clientLinkClosed += 1; });
    clientMux.control.onClose(() => { clientControlClosed += 1; });
    serverMux.link.onClose(() => { serverLinkClosed += 1; });
    serverMux.control.onClose(() => { serverControlClosed += 1; });

    const inFlightCall = client.call('slow', { tag: 'hang' });
    const subErrors: Array<ControlRpcError | undefined> = [];
    const subHandle = client.subscribe('ticks', { prefix: 't' }, {
      onData: () => {},
      onEnd: (err) => subErrors.push(err),
    });

    await flushMicrotasks();
    expect(client.pendingCallCount).toBe(1);
    expect(client.activeSubscriptionCount).toBe(1);
    expect(server.activeRequestCount).toBe(1);
    expect(server.activeSubscriptionCount).toBe(1);

    // Closing raw on client side tears down BOTH lanes on BOTH ends
    pair.a.close();
    await expect(inFlightCall).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' });
    await flushMicrotasks();

    expect(clientLinkClosed).toBe(1);
    expect(clientControlClosed).toBe(1);
    expect(serverLinkClosed).toBe(1);
    expect(serverControlClosed).toBe(1);

    expect(subHandle.closed).toBe(true);
    expect(subErrors).toHaveLength(1);
    expect(subErrors[0]).toMatchObject({ code: 'TRANSPORT_CLOSED' });

    expect(serverRequestAborted).toBe(true);
    expect(serverSubAborted).toBe(true);
    expect(serverSubCleanedUp).toBe(1);

    expect(client.pendingCallCount).toBe(0);
    expect(client.activeSubscriptionCount).toBe(0);
    expect(server.activeRequestCount).toBe(0);
    expect(server.activeSubscriptionCount).toBe(0);

    // Calls & subscriptions after close fail immediately with TRANSPORT_CLOSED
    await expect(client.call('slow', { tag: 'after' })).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' });
    const lateEnds: Array<ControlRpcError | undefined> = [];
    const lateSub = client.subscribe('ticks', { prefix: 'after' }, {
      onData: () => {},
      onEnd: (err) => lateEnds.push(err),
    });
    expect(lateSub.closed).toBe(true);
    expect(lateEnds[0]).toMatchObject({ code: 'TRANSPORT_CLOSED' });

    // Late onClose registrations fire immediately
    let lateClose = 0;
    clientMux.link.onClose(() => { lateClose += 1; });
    expect(lateClose).toBe(1);
  });
});
