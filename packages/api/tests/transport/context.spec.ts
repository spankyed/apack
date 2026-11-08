// The context is one connection's identity, and two things have to hold: it is different per connection, and
// the signal it carries actually arrives and fires when the socket closes.
//
// The first is checked by calling `createRpcContext` directly. The second cannot be — handing it a signal and
// then asserting the signal is there proves nothing about the adapter, which is the only thing that supplies
// one in production. So the last case runs a real `applyWSSHandler` over a real socket with this module's own
// `createRpcContext`, for `encoder.spec.ts`'s reason: the failure is silent. Every participant claim is released
// from `ctx.closed` (`bus.ts`), so a tRPC bump that stopped passing `info.signal` would leak every claim for
// the life of the process and no unit test would notice.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { WebSocketServer } from 'ws';
import { initTRPC } from '@trpc/server';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { observable } from '@trpc/server/observable';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { createRpcContext, type RpcContext } from '../../src/transport/context.ts';

/** A connection as the adapter describes one, which is the only shape `createRpcContext` accepts */
const connection = () => ({ info: { signal: new AbortController().signal } });

describe('createRpcContext', () => {
  it('names the connection', () => {
    expect(createRpcContext(connection()).client).toMatch(/^c-/);
  });

  /**
   * The case that matters, and the one a constant minter fails. Two connections sharing an id would make every
   * reply go to whichever of them asked last, which is the bug this whole mechanism exists to prevent — and it
   * would look like it worked for as long as only one window was open.
   */
  it('gives every connection a different name', () => {
    const ids = Array.from({ length: 50 }, () => createRpcContext(connection()).client);
    expect(new Set(ids).size, 'no two connections share an id').toBe(ids.length);
  });
});

/**
 * What the adapter hands `createRpcContext`, asserted through the adapter.
 *
 * The router is a local one so nothing boots — what is under test is the seam, not the app. The procedure
 * reports the context it was given and arms a listener on it, so one call answers all three halves: the signal
 * is there, it has *not* fired while the connection is open, and it fires once the socket closes.
 *
 * **The middle one is what says this is the connection's signal and not an operation's**, which is the whole
 * reason `info.signal` may be required — the adapter keeps two controllers, one per connection and one per
 * call, and `ctx.closed` must be the first. It is settled *causally* rather than by elapsed time: the case ends
 * a whole operation, by starting a subscription and stopping it, and the `stopped` frame coming back is the
 * evidence that it ended. The connection is still open at that point, so a per-call signal would have aborted
 * and this one must not have.
 *
 * Nothing here waits for a duration — each step awaits the frame that says it happened, and the only number is
 * a deadline that never runs when the code works. What that leaves unguarded is a signal with no relationship
 * to anything, such as a stray timer; ruling that out would take waiting a while and finding nothing, which is
 * the duration-shaped assertion these cases exist to avoid.
 */
describe('the connection signal the adapter supplies', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;
  /** Set by the procedure, so a case can read what the adapter gave it after the socket is gone */
  let seen: { hasSignal: boolean; aborted: boolean } | undefined;
  /** Settles when the signal the procedure was given fires, so the case awaits the abort rather than a delay */
  let abortFired!: Promise<void>;
  let fired: () => void = () => {};
  /** The socket a case opened, so a failed case cannot leave the server waiting on it in teardown */
  let open: WebSocket | undefined;

  const t = initTRPC.context<RpcContext>().create();
  const router = t.router({
    // Never completes on its own, so stopping it is the test's doing and the connection outlives it
    feed: t.procedure.subscription(() => observable<number>(() => () => {})),
    look: t.procedure.query(({ ctx }) => {
      const record = { hasSignal: ctx.closed instanceof AbortSignal, aborted: false };
      ctx.closed.addEventListener('abort', () => { record.aborted = true; fired(); }, { once: true });
      seen = record;
      return { client: ctx.client };
    }),
  });

  beforeEach(async () => {
    seen = undefined;
    abortFired = new Promise<void>((resolve) => { fired = resolve; });
    server = http.createServer();
    wss = new WebSocketServer({ server });
    // This module's own createRpcContext, which is the point: a stub would assert nothing about the adapter
    applyWSSHandler({ wss, router, createContext: createRpcContext });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    if (open !== undefined && open.readyState === WebSocket.OPEN) open.close();
    open = undefined;
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

type Frame = { id?: unknown; result?: { type?: string } };

/** Every frame the server sent, accumulated for the socket's life so a waiter can read what has arrived */
function framesOf(socket: WebSocket): Frame[] {
  const frames: Frame[] = [];
  socket.addEventListener('message', (message: MessageEvent) => {
    const text = String(message.data);
    // The adapter's keep-alive words are protocol, not JSON
    if (text === 'PING' || text === 'PONG') return;
    frames.push(JSON.parse(text) as Frame);
  });
  return frames;
}

/** Resolves once a frame of `type` has arrived, re-reading what has on each message rather than on a timer */
const sawFrame = (socket: WebSocket, frames: Frame[], type: string, describe: string) => _whenSatisfied(
  (notify) => {
    socket.addEventListener('message', notify);
    return () => socket.removeEventListener('message', notify);
  },
  () => frames.some((frame) => frame.result?.type === type) || undefined,
  describe,
);

  it('is there, outlives one operation, and ends with the connection', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    open = socket;
    const frames = framesOf(socket);
    await (new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('the socket would not open')), { once: true });
      }));

    // One query, which is what arms the listener on the context's signal
    socket.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'query', params: { path: 'look' } }));
    await sawFrame(socket, frames, 'data', 'the query to be answered');

    expect(seen?.hasSignal, 'the adapter passed info.signal, which `closed` is not optional about').toBe(true);

    /**
     * One whole operation, begun and ended, while the connection stays open — which is the thing a per-call
     * signal aborts on. The `stop` waits for `started`: sent in the same breath as the subscribe it raced the
     * adapter registering it, and stopped nothing.
     */
    socket.send(JSON.stringify({ id: 2, jsonrpc: '2.0', method: 'subscription', params: { path: 'feed' } }));
    await sawFrame(socket, frames, 'started', 'the subscription to start');
    socket.send(JSON.stringify({ id: 2, jsonrpc: '2.0', method: 'subscription.stop' }));
    await sawFrame(socket, frames, 'stopped', 'the subscription to report that it stopped');

    expect(seen?.aborted, 'an operation ended and this did not fire, so it is the connection\'s').toBe(false);

    socket.close();
    await abortFired;

    expect(seen?.aborted, 'and it fired on the close, which is what releases a claim').toBe(true);
  });
});
