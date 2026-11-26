import { describe, expect, it, vi } from 'vitest';
import { dial, listen, memoryPair, type Frame } from '@apackdev/link';
import { encodeJsonSafely, safeJsonCodec } from '../../src/transport/encoder.ts';

describe('safeJsonCodec & encodeJsonSafely', () => {
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
});
