// The end of a connection, published once, from the one place every call goes through.
//
// Four things hold state keyed by a connection — the participant claims, the settings leases, the
// performance recording owner and a terminal's grid — and each used to arm its own listener on the
// per-connection abort signal. Three got it right; the fourth is a pack, which could not reach the signal
// at all, so a terminal's size stayed owned by a window that had gone and every surviving window was
// refused. So the arming happens here and the end goes out on the bus.
import { describe, expect, it, vi } from 'vitest';
import { createConnectionWatch } from '../../src/transport/connections.ts';
import { RootEventEmitter } from '../../src/transport/emitter.ts';

/** A connection, with the end of it in the caller's hands */
function connection(client: string) {
  const ending = new AbortController();
  return { client, closed: ending.signal, end: () => { ending.abort(); } };
}

describe('watching a connection', () => {
  it('publishes its end once, however many calls arrived on it', () => {
    const emitConnectionEnded = vi.fn();
    const connections = createConnectionWatch({ emitConnectionEnded });
    const one = connection('c-one');

    for (let call = 0; call < 12; call += 1) connections.watch(one);
    one.end();

    expect(emitConnectionEnded.mock.calls).toEqual([['c-one']]);
  });

  it('arms the signal once, rather than once per call', () => {
    // The listener-per-call it replaced needed a `WeakSet<AbortSignal>` at its own call site to keep from
    // arming twice; the dedupe is the mechanism now, so no caller carries one
    const connections = createConnectionWatch({ emitConnectionEnded: () => {} });
    const one = connection('c-one');
    const listen = vi.spyOn(one.closed, 'addEventListener');

    for (let call = 0; call < 12; call += 1) connections.watch(one);

    expect(listen.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(1);
  });

  it('publishes a connection that was already over when it was first seen', () => {
    // The socket closed between the context being made and the call being handled. An `abort` listener
    // armed now would never fire, so whatever that call recorded would be held for the life of the process
    const emitConnectionEnded = vi.fn();
    const connections = createConnectionWatch({ emitConnectionEnded });
    const one = connection('c-one');
    one.end();

    connections.watch(one);

    expect(emitConnectionEnded.mock.calls).toEqual([['c-one']]);
  });

  it("keeps one connection's end to itself", () => {
    const emitConnectionEnded = vi.fn();
    const connections = createConnectionWatch({ emitConnectionEnded });
    const one = connection('c-one');
    const two = connection('c-two');
    connections.watch(one);
    connections.watch(two);

    two.end();

    expect(emitConnectionEnded.mock.calls).toEqual([['c-two']]);
  });
});

describe('telling the holders', () => {
  /**
   * **One holder failing must not keep another holder's state alive.**
   *
   * Every listener here is a different thing releasing what it kept for that connection. An `EventEmitter`
   * calls them in turn on one stack, so a holder that throws takes the rest of the release with it — which
   * turns one holder's bug into exactly the leak this event exists to prevent, and does it silently.
   *
   * Found by a case: a claims double with no `release` threw, and the settings leases it ran before went on
   * being held by a connection that had ended.
   */
  it('releases every holder even when one of them throws', () => {
    const bus = new RootEventEmitter();
    const released: string[] = [];
    bus.onConnectionEnded(() => { throw new Error('this holder is broken'); });
    bus.onConnectionEnded((client) => { released.push(client); });
    bus.onConnectionEnded(() => { throw new Error('and so is this one'); });
    bus.onConnectionEnded((client) => { released.push(`${client}-also`); });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.emitConnectionEnded('c-one');

    expect(released, 'the holders after the broken one still heard').toEqual(['c-one', 'c-one-also']);
  });

  it('says so when a holder fails, rather than losing it', () => {
    const bus = new RootEventEmitter();
    bus.onConnectionEnded(() => { throw new Error('this holder is broken'); });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.emitConnectionEnded('c-one');

    expect(reported).toHaveBeenCalled();
  });

  it('stops telling a holder that unsubscribed', () => {
    const bus = new RootEventEmitter();
    const released: string[] = [];
    const stop = bus.onConnectionEnded((client) => { released.push(client); });

    stop();
    bus.emitConnectionEnded('c-one');

    expect(released).toEqual([]);
  });
});
