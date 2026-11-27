import { describe, expect, it, vi } from 'vitest';
import { dial, listen, memoryPair, type Frame } from '@apackdev/link';
import { decodeDiagnosticCause, encodeDiagnosticCause, encodeDiagnosticSending } from '@apackdev/host/transport/link-protocol';
import { _answer, _SERIALISATION_INPUTS, _SERIALISATION_MATRIX, type _SerialisationInput } from '@apackdev/sdk/testing/serialisation-matrix';
import { bindHost } from '@apackdev/sdk/runtime';
import type { LogEvent } from '@apackdev/sdk/logger';
import { RootEventEmitter } from '../../src/transport/emitter.ts';
import { encodeJsonSafely, safeJsonCodec } from '../../src/transport/encoder.ts';

const sharedEmitter = new RootEventEmitter();
bindHost({ transport: { rootEvents: sharedEmitter } } as never);

describe('safeJsonCodec & encodeJsonSafely', () => {
  it.each(Object.entries(_SERIALISATION_INPUTS) as Array<[_SerialisationInput, () => unknown]>)(
    'matches _SERIALISATION_MATRIX.encoder for %s',
    (name, make) => {
      expect(_answer(() => JSON.parse(safeJsonCodec.encode(make()) as string))).toBe(
        _SERIALISATION_MATRIX.encoder[name],
      );
    },
  );

  it('encodes BigInts on the fast path with zero logger warnings', () => {
    const logs: LogEvent[] = [];
    const off = sharedEmitter.onLog((ev) => logs.push(ev));
    try {
      const out = safeJsonCodec.encode({ ok: true, count: 123456789012345678901234567890n });
      expect(JSON.parse(out as string)).toEqual({ ok: true, count: '123456789012345678901234567890' });
      expect(logs.filter((l) => l.level === 'warn' || l.level === 'error')).toEqual([]);
    } finally {
      off();
    }
  });

  it('handles 100k-depth nested objects without crashing the process', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 100_000; i++) {
      deep = { child: deep };
    }
    expect(() => safeJsonCodec.encode(deep)).toThrow(TypeError);
    const safe = encodeJsonSafely(deep, (reason) => ({ unserialisable: reason }));
    expect(JSON.parse(safe)).toEqual({ unserialisable: expect.any(String) });
  });

  it('guards hostile, cyclic, and BigInt .id properties without throwing or poisoning logs', () => {
    const logs: LogEvent[] = [];
    const off = sharedEmitter.onLog((ev) => logs.push(ev));
    try {
      // Throwing .id getter beside a throwing payload getter
      const hostileId: Record<string, unknown> = {};
      Object.defineProperty(hostileId, 'id', { enumerable: true, get() { throw new Error('id exploded'); } });
      expect(() => safeJsonCodec.encode(hostileId)).toThrow(TypeError);
      expect(JSON.parse(encodeJsonSafely(hostileId, (reason) => ({ failed: reason })))).toEqual({
        failed: 'id exploded',
      });

      // Cyclic .id property on a cyclic object
      const cyclicId: Record<string, unknown> = {};
      cyclicId.self = cyclicId;
      const cyclicObj: Record<string, unknown> = { id: cyclicId };
      cyclicObj.self = cyclicObj;
      const cut = JSON.parse(safeJsonCodec.encode(cyclicObj) as string);
      expect(cut.self).toBe('[circular]');

      // BigInt .id property on a cyclic object is stringified in log metadata
      logs.length = 0;
      const bigIdObj: Record<string, unknown> = { id: 99n };
      bigIdObj.self = bigIdObj;
      safeJsonCodec.encode(bigIdObj);
      expect(logs.at(-1)?.meta).toMatchObject({ id: '99' });
      expect(() => JSON.stringify(logs.at(-1)?.meta)).not.toThrow();
    } finally {
      off();
    }
  });

  it('encodes BigInts as decimal strings over @apackdev/link without dropping subsequent frames', async () => {
    const [a, b] = memoryPair();
    const server = listen(b, { codec: safeJsonCodec });
    const client = dial(a);
    const received: Frame[] = [];
    client.onFrame((frame) => received.push(frame));

    server.send({ kind: 'tell', to: 'pack/a', event: { type: 'BIG', count: 123456789012345678901234567890n } });
    server.send({ kind: 'tell', to: 'pack/a', event: { type: 'AFTER', ok: true } });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received).toEqual([
      { kind: 'tell', to: 'pack/a', event: { type: 'BIG', count: '123456789012345678901234567890' } },
      { kind: 'tell', to: 'pack/a', event: { type: 'AFTER', ok: true } },
    ]);

    client.close();
    server.close();
  });

  it('cuts circular structures to [circular] while preserving shared non-cyclic sibling references', async () => {
    const [a, b] = memoryPair();
    const server = listen(b, { codec: safeJsonCodec });
    const client = dial(a);
    const received: Frame[] = [];
    client.onFrame((frame) => received.push(frame));

    const shared = { id: 'shared-1', at: new Date('2026-01-02T03:04:05.000Z') };
    const cyclic: Record<string, unknown> = { first: shared, second: shared, big: 42n };
    cyclic.self = cyclic;

    server.send({ kind: 'tell', to: 'pack/a', event: { type: 'LOOP', data: cyclic } });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({
      kind: 'tell',
      to: 'pack/a',
      event: {
        type: 'LOOP',
        data: {
          first: { id: 'shared-1', at: '2026-01-02T03:04:05.000Z' },
          second: { id: 'shared-1', at: '2026-01-02T03:04:05.000Z' },
          big: '42',
          self: '[circular]',
        },
      },
    });

    client.close();
    server.close();
  });

  it('throws TypeError on throwing getters so @apackdev/link refuses only that frame and keeps the link alive', async () => {
    const [a, b] = memoryPair();
    const server = listen(b, { codec: safeJsonCodec });
    const client = dial(a);
    const received: Frame[] = [];
    client.onFrame((frame) => received.push(frame));

    const poisoned = Object.defineProperty({}, 'boom', {
      enumerable: true,
      get() { throw new Error('getter exploded'); },
    });

    expect(() => server.send({ kind: 'tell', to: 'pack/a', event: { type: 'BAD', poisoned } })).toThrow(TypeError);
    server.send({ kind: 'tell', to: 'pack/a', event: { type: 'GOOD' } });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ kind: 'tell', to: 'pack/a', event: { type: 'GOOD' } });

    client.close();
    server.close();
  });

  it('encodeJsonSafely never throws, falling back to describeFailure for unserialisable values', () => {
    const poisoned = Object.defineProperty({}, 'boom', {
      enumerable: true,
      get() { throw new Error('getter exploded'); },
    });
    const out = encodeJsonSafely(poisoned, (reason) => ({ unserialisable: reason }));
    expect(JSON.parse(out)).toEqual({ unserialisable: 'getter exploded' });
  });

  it('encodeDiagnosticCause bounds double-JSON wire size to <= 1024 bytes through @apackdev/link safeJsonCodec', async () => {
    const traceparent = '00-11111111111111111111111111111111-2222222222222222-01';
    // Craft a tracestate whose inner JSON is ~1015-1024 bytes with quotes/backslashes so outer JSON.stringify exceeds 1024B
    const nearLimitTracestate = `k=${'"\\'.repeat(200)}${'a'.repeat(120)}`;
    const innerOnly = JSON.stringify({ traceparent, tracestate: nearLimitTracestate });
    expect(Buffer.byteLength(innerOnly, 'utf8')).toBeGreaterThanOrEqual(1000);
    expect(Buffer.byteLength(innerOnly, 'utf8')).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(JSON.stringify(innerOnly), 'utf8')).toBeGreaterThan(1024);

    // Must fall back to { traceparent } alone so @apackdev/link never throws RangeError
    const cause = encodeDiagnosticCause({ traceparent, tracestate: nearLimitTracestate });
    expect(cause).toBeDefined();
    expect(Buffer.byteLength(safeJsonCodec.encode(cause) as string, 'utf8')).toBeLessThanOrEqual(1024);
    expect(decodeDiagnosticCause(cause)).toEqual({ traceparent });

    // Send cleanly over a real @apackdev/link with safeJsonCodec
    const [a, b] = memoryPair();
    const server = listen(b, { codec: safeJsonCodec });
    const client = dial(a);
    const causes: Array<string | undefined> = [];
    client.onFrame((_frame, receivedCause) => causes.push(receivedCause));

    expect(() => server.send(
      { kind: 'tell', to: 'pack/a', event: { type: 'TRACE' } },
      encodeDiagnosticSending({ traceparent, tracestate: nearLimitTracestate }),
    )).not.toThrow();

    await vi.waitFor(() => expect(causes).toHaveLength(1));
    expect(decodeDiagnosticCause(causes[0])).toEqual({ traceparent });

    // Even if traceparent itself exceeds 1024 bytes after outer escaping, returns undefined instead of throwing
    expect(encodeDiagnosticCause({ traceparent: '"'.repeat(600) })).toBeUndefined();

    client.close();
    server.close();
  });
});
