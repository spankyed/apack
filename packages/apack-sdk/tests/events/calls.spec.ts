// Every send names a call, an answer names the call it answers, and the two verbs a pack reads it through.
//
// Correlation is a three-step obligation — mint, store, settle — and a per-feature implementation can fail
// at any one of the three independently: mint and never store, declare a field and mint nothing, store and
// never clear. The envelope is what removes the first and third from a feature's hands: the send mints and
// `reply` echoes, so a feature only stores.
//
// What is asserted here is the half no feature can see: that a send stamps a call at all, that an answer
// names the request's rather than its own, that the reserved key reaches the receiver's event, and that
// `answersCall`/`settleCall` refuse what a hand-written comparison would accept.
import { describe, expect, it } from 'vitest';
import {
  _CALL_KEY, _callOf, answersCall, newCall, recordCall, settleCall, untypedBroadcast,
  untypedTell, _callOn, _replyTo, type Message,
} from '../../src/events/index.ts';
import { startTestRuntime, testRootEvents } from '../../src/testing/index.ts';

startTestRuntime({ packs: { surfaceIds: () => ['pack/surface'], systemIds: () => ['pack/system'] } as never });

/** Everything the bus saw while `body` ran, both directions */
function onBus(body: () => void): Message[] {
  const seen: Message[] = [];
  const stops = [testRootEvents.onSurfaceSend((m) => seen.push(m)), testRootEvents.onIncoming((m) => seen.push(m))];
  try { body(); } finally { for (const stop of stops) stop(); }
  return seen;
}

describe('a call is minted by the send', () => {
  /**
   * **The invariant the whole design rests on**, and the one a feature cannot check for itself: a send is
   * named whether or not anybody asked for the name. Drop the mint from `createSends` and this is what fails.
   *
   * It is asserted over both verbs rather than one, because each builds its own envelope — the file this
   * guards has four such lines, and a mint added to three of them would read as done.
   */
  it('names every send, asked for or not', () => {
    const seen = onBus(() => {
      untypedBroadcast('pack/surface', { type: 'NEWS' });
      untypedTell('pack/system', { type: 'DO_IT' });
    });

    expect(seen.map(({ call }) => typeof call)).toEqual(['string', 'string']);
    expect(new Set(seen.map(({ call }) => call)).size, 'and each send its own').toBe(2);
  });

  // The ask that needs its id before the send happens supplies one, and is answered with what it supplied
  it('uses the call it was given, and hands it back', () => {
    const call = newCall();
    let returned: string | undefined;
    const seen = onBus(() => { returned = untypedTell('pack/system', { type: 'DO_IT' }, { call }); });

    expect(seen[0]?.call, 'the envelope carries the one supplied').toBe(call);
    expect(returned, 'and the send answers with it, so a caller that minted none can still store it').toBe(call);
  });

  /**
   * A burst, which is the case a clock cannot separate and the counter is for: these all land in the same
   * millisecond, so nothing timestamp-derived would tell them apart.
   */
  it('mints distinct calls, however many share a millisecond', () => {
    const minted = Array.from({ length: 1000 }, () => newCall());

    expect(new Set(minted).size, 'every one distinct').toBe(minted.length);
  });
});

describe('an answer names the call it answers', () => {
  /**
   * `reply` reads the call off the **delivery**, not the event — the same reason it reads the asker there.
   * An answer built after an `await`, or from a callback stored earlier, still names the right request.
   */
  it('echoes the call being handled, and mints its own besides', () => {
    const seen = onBus(() => {
      _replyTo({ receiver: 'pack/system', asker: { kind: 'bus', ref: 'pack/asker' }, call: 'c-the-ask' })?.({ type: 'DONE' });
    });

    expect(seen[0]?.answering, 'the request it answers').toBe('c-the-ask');
    expect(seen[0]?.call, 'and its own, because an answer is a send and may itself be answered')
      .toEqual(expect.any(String));
    expect(seen[0]?.call).not.toBe('c-the-ask');
  });

  // A request that carried no call cannot be answered by name, and `reply` says so rather than inventing one
  it('leaves it absent when the request named none', () => {
    const seen = onBus(() => {
      _replyTo({ receiver: 'pack/system', asker: { kind: 'bus', ref: 'pack/asker' } })?.({ type: 'DONE' });
    });

    expect(seen[0]?.answering).toBeUndefined();
  });
});

describe('the reserved key a door injects', () => {
  /**
   * **Only an answer carries one, and the alternative is the trap.** Injecting the message's `call` as well
   * would name a call on every delivered event — but a request's own call has no reader there: whoever
   * receives a request answers it with `reply`, which takes the call from the delivery. What it would buy
   * instead is a `_call` on every notification, which belongs to no ask, so a system recording what it heard
   * records one too.
   */
  it('is present on an answer and absent on anything else', () => {
    expect(_callOn({ answering: 'c-the-ask' })).toEqual({ [_CALL_KEY]: 'c-the-ask' });
    expect(_callOn({}), 'a request or a notification names no call it belongs to').toEqual({});
  });

  it('is what callOf reads back', () => {
    expect(_callOf({ type: 'DONE', ..._callOn({ answering: 'c-1' }) })).toBe('c-1');
    expect(_callOf({ type: 'NEWS' })).toBeUndefined();
  });

  /**
   * **The key is reserved, and this is the case that says so.** An event is an open bag — a pack may put any
   * field on one, which `outgoing-events.spec.ts` pins with a deliberate `surfaceId` collision — so the one
   * field a door writes has to win, or a pack could make its own answer look like it belonged to another
   * call. A pack rule refuses one written in pack source; this is what the runtime does if one arrives.
   */
  it('wins over a pack field of the same name', () => {
    const delivered = { type: 'DONE', [_CALL_KEY]: 'c-the-packs-own', ..._callOn({ answering: 'c-the-real-one' }) };

    expect(_callOf(delivered)).toBe('c-the-real-one');
  });

  // `string`, so a non-string arriving from anywhere reads as no call rather than as one
  it('reads a non-string as no call at all', () => {
    expect(_callOf({ type: 'DONE', [_CALL_KEY]: 7 })).toBeUndefined();
  });
});

/**
 * The question a pack asks instead of reading the call, and the case that is the reason it exists.
 *
 * **An empty slot answers nothing.** `_callOf(event) === context.pending` is `undefined === undefined` when
 * nothing is outstanding, so the obvious comparison admits an answer nobody asked for — and nothing
 * outstanding is the resting state, so that is the common path. Both spellings of an empty slot are
 * refused, because a machine may use either and neither should decide correctness.
 *
 * Mutation: drop `outstanding != null` and the first three cases fail here, plus one per feature in
 * `default-setup`.
 */
describe('answersCall', () => {
  const answer = (call: string) => ({ type: 'DONE', ..._callOn({ answering: call }) });

  it('refuses an uncorrelated answer when nothing is outstanding', () => {
    expect(answersCall({ type: 'DONE' }, null)).toBe(false);
    expect(answersCall({ type: 'DONE' }, undefined)).toBe(false);
  });

  it('refuses a correlated answer when nothing is outstanding either', () => {
    expect(answersCall(answer('c-1'), null)).toBe(false);
  });

  it('refuses an answer carrying no call while an ask is outstanding', () => {
    expect(answersCall({ type: 'DONE' }, 'c-1')).toBe(false);
  });

  it('takes the answer to the ask that is outstanding, and no other', () => {
    expect(answersCall(answer('c-1'), 'c-1')).toBe(true);
    expect(answersCall(answer('c-2'), 'c-1')).toBe(false);
  });
});

/**
 * The pair for a correlation holding several asks at once, where a single slot cannot say which.
 *
 * `settleCall` takes the event rather than a call, which is what keeps the raw value out of pack code —
 * and it hands back both halves, so read-and-remove is one step and remove-only is that step with
 * `recorded` dropped.
 */
describe('recordCall and settleCall', () => {
  const asked = (call: string) => ({ type: 'DONE', ..._callOn({ answering: call }) });

  it('settles the ask its answer names, leaving the others', () => {
    const pending = recordCall(recordCall({}, 'c-1', 'first'), 'c-2', 'second');

    const { recorded, pending: left } = settleCall(pending, asked('c-1'));

    expect(recorded).toBe('first');
    expect(left).toEqual({ 'c-2': 'second' });
  });

  it('settles nothing for an answer carrying no call, and leaves the record alone', () => {
    const pending = recordCall({}, 'c-1', 'first');

    const settled = settleCall(pending, { type: 'NEWS' });

    expect(settled.recorded).toBeUndefined();
    expect(settled.pending, 'the same record, not a copy missing something').toEqual(pending);
  });

  it('settles nothing twice for one ask', () => {
    const pending = recordCall({}, 'c-1', 'first');

    const once = settleCall(pending, asked('c-1'));
    const twice = settleCall(once.pending, asked('c-1'));

    expect(once.recorded).toBe('first');
    expect(twice.recorded, 'already settled').toBeUndefined();
  });

  // Immutable, because state transitions replace data rather than mutating it in place
  it('leaves the record it was given untouched', () => {
    const pending = recordCall({}, 'c-1', 'first');

    recordCall(pending, 'c-2', 'second');
    settleCall(pending, asked('c-1'));

    expect(pending).toEqual({ 'c-1': 'first' });
  });
});
