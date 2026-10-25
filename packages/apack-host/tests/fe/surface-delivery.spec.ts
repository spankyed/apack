// Handing an event to an actor names the participant it is for — and *only* that one.
//
// Two claims, and the second is the one that had no case until a probe went looking. A send made while
// handling a message carries the handler's ref, which is what the whole delivery scope is for; so a surface
// that reaches another actor's `send` directly, from inside its own delivery, hands that actor its own
// scope. Measured 2026-10-06: the shell handling a pack unload that way saw itself as the *packs surface*,
// with the packs system as its asker — so a send it made there would have been stamped with a surface that
// did not make it, and a handler it ran would have been handed a `reply` for a question asked of somebody
// else.
//
// That is why nothing may reach an actor's `send` around these two functions. `check:specifiers` cannot see
// the difference — both are `.send(` — so this is where the difference is held.
//
// **Two functions rather than one with a nullable address**, so a call site names what it is doing and the
// asked half cannot be called without an answerable address. Which one a case uses is therefore part of what
// it asserts, not an implementation detail of the fixture.
import { describe, expect, it } from 'vitest';
import { createActor, setup } from 'xstate';
import { _currentDelivery, _runDelivery, type _Delivery } from '@apackdev/sdk/events';
import { notifySurfaceActor, sendToSurfaceActor } from '../../src/fe/surface-delivery.ts';

/** An actor that records what was being handled each time it is given an event */
function recording() {
  const seen: Array<(Omit<_Delivery, 'event'> & { event?: unknown }) | undefined> = [];
  const actor = createActor(setup({}).createMachine({
    // What was being handled, and whether the event the actor handles is the one that delivery delivered
    on: { PING: { actions: ({ event }) => {
      const delivery = _currentDelivery();
      seen.push(delivery && { ...delivery, event: delivery.event === event ? 'this one' : delivery.event });
    } } },
  })).start();
  return { seen, actor };
}

/** A message being handled when the send is made, with somebody waiting on an answer to it */
const HANDLING: _Delivery = { receiver: 'pack/sender', asker: { kind: 'bus', ref: 'pack/asker' } };

describe('handing an actor an event nobody asked for', () => {
  it('names the receiver while it handles it, and nobody to answer', () => {
    const { seen, actor } = recording();

    notifySurfaceActor(actor, 'pack/receiver', { type: 'PING' });

    expect(seen).toEqual([{ receiver: 'pack/receiver', asker: undefined, event: 'this one' }]);
  });

  /**
   * **The case the funnel exists for.** The sender is mid-delivery and owes an answer to `pack/asker`; the
   * receiver must inherit none of that, or it answers a question nobody asked it.
   *
   * Replace the body of `notifySurfaceActor` with a bare `actor.send(event)` and this is what fails.
   */
  it('hands the receiver none of the scope the sender was in', () => {
    const { seen, actor } = recording();

    _runDelivery(HANDLING, () => {
      notifySurfaceActor(actor, 'pack/receiver', { type: 'PING' });
    });

    expect(seen, "the sender's ref, its asker and its event all stop here").toEqual([
      { receiver: 'pack/receiver', asker: undefined, event: 'this one' },
    ]);
  });

  // And the sender goes back to owing its own answer, so what it does after the send is unchanged
  it('gives the sender its own delivery back afterwards', () => {
    const { actor } = recording();
    let after: _Delivery | undefined;

    _runDelivery(HANDLING, () => {
      notifySurfaceActor(actor, 'pack/receiver', { type: 'PING' });
      after = _currentDelivery();
    });

    expect(after).toEqual(HANDLING);
    expect(_currentDelivery(), 'and nothing is left behind out here').toBeUndefined();
  });
});

describe('handing an actor an event someone is waiting on', () => {
  // Drop `asker` from the delivery `sendToSurfaceActor` opens and this is what fails
  it('carries the address it was given', () => {
    const { seen, actor } = recording();

    sendToSurfaceActor(actor, 'pack/receiver', { type: 'PING' }, { kind: 'window', ref: 'pack/curious' });

    expect(seen).toEqual([{ receiver: 'pack/receiver', asker: { kind: 'window', ref: 'pack/curious' }, event: 'this one' }]);
  });

  /**
   * The address is the asker's, never the sender's, which is the half the scope leak got wrong in the other
   * direction: an asker reaches the receiver only by being passed, so one the caller happens to be holding
   * does not come along.
   */
  it("carries that address and not the one the sender was holding", () => {
    const { seen, actor } = recording();

    _runDelivery(HANDLING, () => {
      sendToSurfaceActor(actor, 'pack/receiver', { type: 'PING' }, { kind: 'window', ref: 'pack/curious' });
    });

    expect(seen).toEqual([{ receiver: 'pack/receiver', asker: { kind: 'window', ref: 'pack/curious' }, event: 'this one' }]);
  });

  /**
   * **What the split buys, and the one thing a case can say about it.** The address is not optional here, so
   * a caller with a maybe-asker cannot pass it through and leave the question of "what if nobody asked"
   * unanswered — it picks a function instead. The two call sites that have that question
   * (`connection.ts`, and the shell's `deliverSurfaceEvents`) branch, and `surface-reply.spec.ts` holds what
   * each branch does.
   *
   * The compiler is what enforces it, so the assertion here is the edit that would make it fire: widen the
   * parameter back to `_Asker | undefined` and this line stops being a type error.
   */
  it('takes an address that cannot be absent', () => {
    const { actor } = recording();
    const maybe: _Delivery['asker'] = undefined;

    // @ts-expect-error — an asker that might be missing is not an address, and this is where that is refused
    sendToSurfaceActor(actor, 'pack/receiver', { type: 'PING' }, maybe);
  });
});
