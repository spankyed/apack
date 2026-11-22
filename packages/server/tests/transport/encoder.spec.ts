// A value the app cannot serialise must not end a client's event stream.
//
// **Why this runs a real server instead of calling the encoder directly.** The encoder's own behaviour is the
// easy half; what this file is for is the half that can go wrong silently. `experimental_encoder` is named
// experimental, so a tRPC bump could rename or drop it, and the symptom would be the original bug back again —
// one BigInt and the subscription is dead — with every unit test of the encoder still green. So each case here
// goes through `applyWSSHandler` over a real socket: if the option stops being honoured, these fail.
//
// The router is a local one rather than the app's, so nothing boots. What is under test is the adapter's
// serialisation seam, which that local router exercises exactly as `appRouter` would.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { WebSocketServer } from 'ws';
import { initTRPC } from '@trpc/server';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { observable } from '@trpc/server/observable';
import {
  _SERIALISATION_INPUTS,
  _SERIALISATION_MATRIX,
  _answer,
  type _SerialisationInput,
} from '@apackdev/sdk/testing/serialisation-matrix';
import { jsonSafeEncoder } from '../../src/transport/encoder.ts';

/** What a subscriber is told to emit, set per case before it subscribes */
let payloads: unknown[] = [];

const t = initTRPC.create();
const router = t.router({
  // Emits each payload in turn, then one plain marker so a case can prove the stream is still alive
  feed: t.procedure.subscription(() => observable<unknown>((emit) => {
    for (const payload of payloads) emit.next(payload);
    emit.next({ marker: 'still-here' });
    return () => {};
  })),
  echo: t.procedure.mutation(() => ({ big: 7n })),
});

let server: http.Server;
let wss: WebSocketServer;
let port: number;

beforeEach(async () => {
  payloads = [];
  server = http.createServer();
  wss = new WebSocketServer({ server });
  applyWSSHandler({ wss, router, createContext: () => ({}), experimental_encoder: jsonSafeEncoder });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Frames the server sent, collected until `done(frames)` is satisfied or the socket dies */
function collect(open: (socket: WebSocket) => void, done: (frames: Frame[]) => boolean): Promise<Frame[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames: Frame[] = [];
    const timer = setTimeout(() => { socket.close(); reject(new Error(`no satisfying frame in 4s; saw ${JSON.stringify(frames)}`)); }, 4_000);
    socket.addEventListener('open', () => open(socket));
    socket.addEventListener('message', (message) => {
      const text = String(message.data);
      // The adapter's keep-alive words are protocol, not JSON
      if (text === 'PING' || text === 'PONG') return;
      frames.push(JSON.parse(text) as Frame);
      if (!done(frames)) return;
      clearTimeout(timer);
      socket.close();
      resolve(frames);
    });
    // A dead socket is the failure this file exists to catch, so say so rather than timing out
    socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error(`the socket closed after ${frames.length} frame(s): ${JSON.stringify(frames)}`)); });
  });
}

type Frame = { id?: number | string; result?: { type: string; data?: unknown }; error?: { message: string } };

const subscribe = (socket: WebSocket) =>
  socket.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'subscription', params: { path: 'feed' } }));

/** The payloads a subscription actually delivered, less its `started` frame */
const delivered = (frames: Frame[]) => frames.filter((frame) => frame.result?.type === 'data').map((frame) => frame.result?.data);
const sawMarker = (frames: Frame[]) => delivered(frames).some((data) => (data as { marker?: string })?.marker === 'still-here');

describe('an outgoing value JSON refuses', () => {
  /**
   * The case the whole mechanism exists for. Before the encoder, this killed the subscription: the adapter
   * stringifies from the loop that drains it, so the throw was not the send's to catch.
   */
  it('sends a BigInt as its digits, and keeps delivering', async () => {
    payloads = [{ rows: [{ id: 1n, size: 9007199254740993n }] }];

    const frames = await collect(subscribe, sawMarker);

    expect(delivered(frames)[0], 'exact in value, a string in type').toEqual({ rows: [{ id: '1', size: '9007199254740993' }] });
    expect(sawMarker(frames), 'the stream outlived it').toBe(true);
  });

  // A BigInt nested in a class instance throws the same way, and is the shape a real query result takes
  it('reaches a BigInt inside a class instance', async () => {
    payloads = [{ row: new (class Row { readonly count = 3n; readonly label = 'notes'; })() }];

    const frames = await collect(subscribe, sawMarker);

    expect(delivered(frames)[0]).toEqual({ row: { count: '3', label: 'notes' } });
  });

  /**
   * A cycle is the case a replacer cannot save — `JSON.stringify` throws on one whatever the replacer says — so
   * it takes the second pass. What matters is not what replaces the loop but that the connection survives it.
   */
  it('cuts a cycle rather than dropping the connection', async () => {
    const looped: Record<string, unknown> = { name: 'flow' };
    looped.self = looped;
    payloads = [{ looped }];

    const frames = await collect(subscribe, sawMarker);

    expect(delivered(frames)[0]).toEqual({ looped: { name: 'flow', self: '[circular]' } });
    expect(sawMarker(frames), 'and the stream outlived it').toBe(true);
  });

  /**
   * The second pass has to describe a value the way `JSON.stringify` does, or the two paths disagree.
   *
   * `JSON.stringify` asks for `toJSON` first; a walk of own enumerable properties finds none on a Date and
   * yields `{}`. So a message carrying a cycle *and* a Date used to send the ISO string on the fast path and an
   * empty object on the fallback — the same value serialised two ways depending on what else was in the frame.
   */
  it('describes a Date the same way on the fallback path as on the fast one', async () => {
    const when = new Date('2026-01-02T03:04:05.000Z');

    payloads = [{ when }];
    const direct = await collect(subscribe, sawMarker);
    expect(delivered(direct)[0], 'the fast path, for comparison').toEqual({ when: '2026-01-02T03:04:05.000Z' });

    const looped: Record<string, unknown> = { when };
    looped.self = looped;
    payloads = [{ looped }];
    const viaFallback = await collect(subscribe, sawMarker);

    expect(delivered(viaFallback)[0], 'and the fallback, which has to agree')
      .toEqual({ looped: { when: '2026-01-02T03:04:05.000Z', self: '[circular]' } });
  });

  /**
   * The promise the module makes is that it never throws, and the fallback used to be the hole in it.
   *
   * `withoutCycles` reads properties, so a throwing getter — or a throwing `toJSON`, or a structure deeper than
   * the stack — threw from inside the `catch`, with nothing around it. That throw lands in the loop draining the
   * subscription, which is the exact failure the encoder exists to prevent: the fallback killed the stream it
   * was written to save. A placeholder frame keeps the channel alive and the id ties it to the request.
   */
  it('sends a placeholder rather than throwing when even the second pass fails', async () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'boom', { enumerable: true, get() { throw new Error('getter exploded'); } });
    payloads = [{ hostile }];

    const frames = await collect(subscribe, sawMarker);

    expect(delivered(frames)[0], 'described rather than sent, since it cannot be sent').toBe('[unserialisable]');
    expect(sawMarker(frames), 'and the stream outlived it, which is the whole point').toBe(true);
  });

  /**
   * Depth is the one bound this encoder does not have, and the reason it needs none.
   *
   * `redactSecrets` caps a walk at 50 levels and `truncateResult` at 10, because each is building a value
   * somebody reads. This one is putting a frame on a socket, where the honest answer to "too deep to serialise"
   * is to say so — so both passes are allowed to blow the stack and the third tier catches it. Nothing else
   * asserts that, and a depth cap added here later would be the thing that breaks it.
   */
  it('describes a structure too deep for either pass, rather than throwing', async () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let level = 0; level < 100_000; level++) deep = { next: deep };
    payloads = [{ deep }];

    const frames = await collect(subscribe, sawMarker);

    expect(delivered(frames)[0]).toBe('[unserialisable]');
    expect(sawMarker(frames), 'and the stream outlived it').toBe(true);
  });

  // The same value twice side by side is not a cycle, and must not be cut as one
  it('keeps a value that merely appears twice', async () => {
    const shared = { id: 'n1' };
    payloads = [{ left: shared, right: shared }];

    const frames = await collect(subscribe, sawMarker);

    expect(delivered(frames)[0]).toEqual({ left: { id: 'n1' }, right: { id: 'n1' } });
  });

  /**
   * The fast path, made observable.
   *
   * Only the fallback warns, and the fallback also handles BigInts — so without this case, deleting the
   * replacer changes no output byte and every other case here still passes while every BigInt message pays a
   * throw and a full walk. This is the one case that fails for that edit.
   */
  it('needs no fallback for a BigInt, and says so by not warning', async () => {
    const warnings: unknown[][] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args); });
    try {
      payloads = [{ id: 5n }];
      await collect(subscribe, sawMarker);
      expect(warnings, 'the replacer handled it, so nothing was cut').toEqual([]);

      const looped: Record<string, unknown> = {};
      looped.self = looped;
      payloads = [{ looped }];
      await collect(subscribe, sawMarker);
      expect(warnings.length, 'and a cycle does warn, so the absence above means something').toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  // Not only subscriptions: a mutation's result goes through the same encoder
  it('sends a mutation result carrying a BigInt', async () => {
    const frames = await collect(
      (socket) => socket.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'mutation', params: { path: 'echo' } })),
      (seen) => seen.some((frame) => frame.result?.type === 'data'),
    );

    expect(frames.at(-1)?.result?.data).toEqual({ big: '7' });
  });
});

/**
 * The row this pass answers in the shared matrix (`@apackdev/sdk/testing/serialisation-matrix`).
 *
 * The cases above say why each answer is what it is; this says that it still *is*. The matrix is the data behind
 * `docs/references/value-serialisation.md`, declared once because no package can import all five passes, and
 * asserted from the three suites that can each reach their own.
 */
describe('the row it answers in the serialisation matrix', () => {
  it.each(Object.entries(_SERIALISATION_INPUTS) as Array<[_SerialisationInput, () => unknown]>)(
    'for %s',
    (name, make) => {
      expect(_answer(() => JSON.parse(jsonSafeEncoder.encode(make())))).toBe(_SERIALISATION_MATRIX.encoder[name]);
    },
  );
});
