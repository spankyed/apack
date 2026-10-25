// A window's view subscriptions, over a real `applyWSSHandler` and real sockets: each connection hears its own
// subscription's results, two connections on one view share one watch, and a socket closing ends every
// subscription on it — which is what keeps the view host from outliving the windows that asked, with nothing
// watching for a window going away. Only the adapter supplies that last half, so a stub would assert nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { WebSocketServer } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { createEarsEngine } from '@apackdev/ears';
import { defineViews, type PackRegistration } from '@apackdev/sdk/framework';
import { createViewHost } from '@apackdev/host/views';
import { _byDeadline, _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { createRpcContext } from '../../src/transport/context.ts';

const engine = createEarsEngine({ isRelationKind: () => true, isRole: () => true, isEntityType: (name) => name === 'Note' });
const registration: PackRegistration = {
  id: 'notes',
  features: { notes: { views: defineViews({ titles: () => engine.query('Note').ids().map((id) => engine.getAttr(id, 'title')) }) } },
};
const views = createViewHost({ ears: () => engine, packs: { getPackRegistration: () => registration, onRegistrationChanged: () => () => {} } });

/** Told each time a subscription ends, so a case awaits the server's teardown rather than a delay */
const ended = new Set<() => void>();
vi.mock('../../src/runtime/index.ts', () => ({
  appViews: {
    watch: (...args: Parameters<typeof views.watch>) => {
      const stop = views.watch(...args);
      return () => { stop(); for (const notify of ended) notify(); };
    },
  },
}));

const { viewsRouter } = await import('../../src/transport/views.ts');

type Frame = { id?: number; result?: { type?: string; data?: { ok: boolean; value?: unknown } } };

let server: http.Server;
let wss: WebSocketServer;
let port: number;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  server = http.createServer();
  wss = new WebSocketServer({ server });
  applyWSSHandler({ wss, router: viewsRouter, createContext: createRpcContext });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) if (socket.readyState === WebSocket.OPEN) socket.close();
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A window: its socket, the results it heard, and a wait for one that satisfies `check` */
async function window() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  const results: unknown[] = [];
  socket.addEventListener('message', (message: MessageEvent) => {
    const text = String(message.data);
    if (text === 'PING' || text === 'PONG') return;
    const frame = JSON.parse(text) as Frame;
    if (frame.result?.type === 'data' && frame.result.data?.ok) results.push(frame.result.data.value);
  });
  await _byDeadline(new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('the socket would not open')), { once: true });
  }), 'the socket to open');
  return {
    socket,
    results,
    watch: (id: number) => socket.send(JSON.stringify({ id, jsonrpc: '2.0', method: 'subscription', params: { path: 'watch', input: { ref: 'notes/notes', view: 'titles' } } })),
    heard: (value: unknown, describe: string) => _whenSatisfied((notify) => {
      socket.addEventListener('message', notify);
      return () => socket.removeEventListener('message', notify);
    }, () => results.some((result) => JSON.stringify(result) === JSON.stringify(value)) || undefined, describe),
  };
}

/** Resolves once the view host holds `subscriptions`, re-read as each subscription ends */
const holds = (subscriptions: number, describe: string) => _whenSatisfied((notify) => {
  ended.add(notify);
  return () => ended.delete(notify);
}, () => views.stats().subscriptions === subscriptions || undefined, describe);

describe('views.watch', () => {
  it('shares one watch between windows, hands each the changes, and ends a window\'s subscriptions with its socket', async () => {
    engine.create('Note', { title: 'one' });
    const first = await window();
    const second = await window();
    first.watch(1);
    second.watch(1);
    await first.heard(['one'], 'the first window to hear the view');
    await second.heard(['one'], 'the second window to hear the view');
    expect(views.stats()).toEqual({ views: 1, subscriptions: 2 });
    expect(engine.admin.watchStats().watches).toBe(1);

    engine.create('Note', { title: 'two' });
    await first.heard(['one', 'two'], 'the first window to hear the change');
    await second.heard(['one', 'two'], 'the second window to hear the change');

    first.socket.close();
    await holds(1, 'the closed socket\'s subscription to end');
    expect(views.stats().views, 'the other window still holds the view').toBe(1);
    second.socket.close();
    await holds(0, 'the last subscription to end with its socket');
    expect(views.stats()).toEqual({ views: 0, subscriptions: 0 });
    expect(engine.admin.watchStats().watches).toBe(0);
  });
});
