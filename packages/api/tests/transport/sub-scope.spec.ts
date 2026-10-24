// How far an outgoing message reaches, which is the one thing `bus.sub` decides.
//
// Two subscriptions are two windows. A message with no `client` is for both of them — that is what a notification
// is, and what every backend send was before a return address existed. A message naming a connection is an answer
// to something that connection asked, and must reach only it.
//
// The renderer's half of the reach question is `send-scope.spec.ts` (`@apackdev/host`), which pins that a backend
// send arrives in every window and an in-window send crosses none. It cannot cover this one: it has no API, and
// it simulates the bus by calling each window's client directly. The filter is server-side on purpose, so the
// window never sees a message that was not for it, and this is where that is checked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@apackdev/sdk/events';

const listeners = new Set<(message: Message) => void>();
vi.mock('@apackdev/host/bus', () => ({
  receiveClientEvent: () => {},
  UnknownClientEventError: class extends Error {},
}));
vi.mock('../../src/runtime/index.ts', () => ({ appStore: undefined, appPacks: {} }));
vi.mock('../../src/transport/emitter.ts', () => ({
  rootEvents: {
    onOutgoing: (callback: (message: Message) => void) => { listeners.add(callback); return () => listeners.delete(callback); },
    emitConnected: () => {},
    emitPackClientConnected: () => {},
  },
}));

const { systemBusRouter } = await import('../../src/transport/bus.ts');

/** What the backend puts on the bus, reaching every live subscription's filter */
const emitOutgoing = (message: Message) => { for (const callback of listeners) callback(message); };

/**
 * One window: its own connection id and whatever its subscription let through.
 *
 * It passes a real `closed` signal rather than casting the context, even though `sub` never reads one: a cast
 * hides a member the type requires, so the day a procedure does read it this would hand it `undefined` at
 * runtime instead of failing the typecheck the signal was made non-optional to get.
 */
async function windowNamed(client: string) {
  const received: Message[] = [];
  const observable = await systemBusRouter.createCaller({ client, closed: new AbortController().signal }).sub();
  observable.subscribe({ next: (message: Message) => { received.push(message); } });
  return { client, received, types: () => received.map((message) => message.event.type) };
}

const anEvent = (type: string, client?: string): Message => ({ to: 'default-setup/notes', event: { type }, ...(client ? { client } : {}) });

let main: Awaited<ReturnType<typeof windowNamed>>;
let popout: Awaited<ReturnType<typeof windowNamed>>;

beforeEach(async () => {
  listeners.clear();
  main = await windowNamed('c-main');
  popout = await windowNamed('c-popout');
});

describe('how far an outgoing message reaches', () => {
  // The behaviour every backend send has always had, and the half a return address must not quietly take away
  it('delivers a message that names no connection to every connection', () => {
    emitOutgoing(anEvent('NOTE_UPDATED'));

    expect(main.types()).toEqual(['NOTE_UPDATED']);
    expect(popout.types(), 'a notification is for every window').toEqual(['NOTE_UPDATED']);
  });

  it('delivers a message that names a connection only to that one', () => {
    emitOutgoing(anEvent('QUERY_RESULT', 'c-main'));

    expect(main.types(), 'the connection that asked').toEqual(['QUERY_RESULT']);
    expect(popout.types(), 'and no other').toEqual([]);
  });

  // The two halves have to coexist: an addressed answer must not stop the broadcasts flowing
  it('keeps both kinds flowing on one connection', () => {
    emitOutgoing(anEvent('NOTE_UPDATED'));
    emitOutgoing(anEvent('QUERY_RESULT', 'c-popout'));
    emitOutgoing(anEvent('THREAD_UPDATED'));

    expect(main.types()).toEqual(['NOTE_UPDATED', 'THREAD_UPDATED']);
    expect(popout.types()).toEqual(['NOTE_UPDATED', 'QUERY_RESULT', 'THREAD_UPDATED']);
  });

  // A connection that has gone, or one that never existed: the message is simply not delivered, never broadcast
  it('delivers nothing when the named connection is not subscribed', () => {
    emitOutgoing(anEvent('QUERY_RESULT', 'c-gone'));

    expect(main.types()).toEqual([]);
    expect(popout.types(), 'an unknown address is not a broadcast').toEqual([]);
  });

  // The message arrives whole, as it always has: the renderer's one warning for an undeliverable send names the
  // sender, which it can only do because the subscription carries the envelope rather than the event alone
  it('carries the envelope, the address included', () => {
    emitOutgoing({ to: 'default-setup/notes', from: 'default-setup', via: 'action:Add', event: { type: 'NOTE_UPDATED' }, client: 'c-main' });

    expect(main.received[0]).toEqual({ to: 'default-setup/notes', from: 'default-setup', via: 'action:Add', event: { type: 'NOTE_UPDATED' }, client: 'c-main' });
  });
});
