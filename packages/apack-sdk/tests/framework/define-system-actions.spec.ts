// What a handler is handed, which is the whole of this change: the answer for the message it is handling, or
// nothing when that message named no sender.
//
// It replaces an ambient `reply()` that read the delivery at the moment it was *called*. Two things were wrong
// with that and both are cases here: a handler's signature said nothing about whether an answer was owed — the
// defect that let `/set-setting` report success for every refused write — and an answer stored for later read
// whatever scope it was eventually called in, which is usually none.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { defineSystem } from '../../src/framework/define-system.ts';
import { _runDelivery, type Reply } from '../../src/events/index.ts';
import { startTestRuntime, testRootEvents } from '../../src/testing/index.ts';

startTestRuntime();

type Contract = {
  context: { count: number };
  incoming: { type: 'ASK' } | { type: 'TELL'; note: string };
  outgoing: { type: 'ANSWERED' };
};

const spec = defineSystem<Contract>();

/** What this system's `reply` takes: its contract's outgoing events, which is the bound the compiler now holds it to */
type Answer = Reply<Contract['outgoing']>;

/** The event a door delivers: the very object the machine then hands its actions */
const message = { type: 'ASK' };

/** The arguments XState would hand an action handling that event, as far as these cases care */
const args = () => ({ context: { count: 0 }, event: message } as never);

/** A message that named who sent it, and one that did not */
const asked = { receiver: 'pack/feature', asker: { kind: 'connection', ref: 'pack/asker', client: 'c-1' }, event: message } as const;
const unasked = { receiver: 'pack/feature', event: message };

let sent: Array<{ to?: string; type: string; client?: string }>;
let stopListening: () => void;

beforeEach(() => {
  sent = [];
  stopListening = testRootEvents.onSurfaceSend((message) => {
    sent.push({ to: message.to, type: message.event.type, client: message.client });
  });
});

afterEach(() => stopListening());

describe('an action built from the spec', () => {
  it('is handed the answer for the message it is handling', () => {
    const table = spec.actions({
      answer: ({ reply }) => { reply?.({ type: 'ANSWERED' }); },
    });

    _runDelivery(asked, () => table.answer(args(), undefined));

    expect(sent).toEqual([{ to: 'pack/asker', type: 'ANSWERED', client: 'c-1' }]);
  });

  /**
   * An event the machine made while handling the message is not the message: a system telling its children something
   * of its own, inside the delivery of another system's ask, would otherwise answer that asker about it.
   */
  it('is handed nothing for an event its machine made while handling the message', () => {
    let had: Answer | undefined = (() => {}) as Answer;
    const table = spec.actions({
      answer: ({ reply }) => { had = reply; },
    });

    _runDelivery(asked, () => table.answer({ context: { count: 0 }, event: { type: 'TELL', note: 'of its own' } } as never, undefined));

    expect(had).toBeUndefined();
  });

  /**
   * The case the nullability is for. `answerSettings` used to ask this of a global —
   * `_currentDelivery()?.asker === undefined` — and nothing made an author ask it at all.
   */
  it('is handed nothing when the message named no sender, so the fallback is the compiler\'s question', () => {
    let had: Answer | undefined = (() => {}) as Answer;
    const table = spec.actions({
      answer: ({ reply }) => { had = reply; },
    });

    _runDelivery(unasked, () => table.answer(args(), undefined));

    expect(had).toBeUndefined();
    expect(sent, 'and nothing was broadcast in its place — that is the handler\'s call, not ours').toEqual([]);
  });

  /**
   * The answer is bound by the contract's `outgoing`, which is the one thing `reply` was not checked against
   * until 2026-10-06 — every other send in the app is typed per receiver, and this one took any `{ type }` at
   * all. The bound is right because an answer *is* one of the things the system says.
   *
   * `@ts-expect-error` is the assertion: it fails the typecheck if the line ever starts compiling, so deleting
   * the `Reply<…>` parameter is caught here rather than by a dropped event at runtime.
   */
  it('refuses an answer the system never declared', () => {
    const table = spec.actions({
      answer: ({ reply }) => {
        // @ts-expect-error 'NOT_DECLARED' is not one of this contract's outgoing events
        reply?.({ type: 'NOT_DECLARED' });
      },
    });

    _runDelivery(asked, () => table.answer(args(), undefined));

    expect(sent, 'it still sends at runtime — the gate is the compiler, which is where a typo belongs')
      .toEqual([{ to: 'pack/asker', type: 'NOT_DECLARED', client: 'c-1' }]);
  });

  it('keeps a second argument, so an action named with params still reads them', () => {
    const seen: string[] = [];
    const table = spec.actions({
      refuse: (_args, { reason }: { reason: string }) => { seen.push(reason); },
    });

    _runDelivery(asked, () => table.refuse(args(), { reason: 'a backup is importing' }));

    expect(seen).toEqual(['a backup is importing']);
  });

  /**
   * An action creator's result is not a handler and must come through untouched: XState resolves it by an own
   * `resolve` property, which wrapping would hide. Identity rather than behaviour, because that is the claim.
   */
  it('passes an action creator\'s result through as it is', () => {
    const made = assign<{ count: number }, { type: 'ASK' }, undefined, { type: 'ASK' }, never>({ count: 1 });
    const table = spec.actions({ bump: made as never });

    expect(table.bump, 'the same object, not a wrapper around it').toBe(made);
  });

  /**
   * The gap this closes, and the reason `reply` is bound at entry rather than read at use.
   *
   * A callback registered inside one delivery and fired outside any — an event listener, a subscription, a
   * `.on('data')` — read no sender at all under the ambient `reply`, which then threw. Measured before this
   * existed: it answered `NONE`.
   */
  it('hands an answer that still works after its delivery has ended', () => {
    let later: (() => void) | undefined;
    const table = spec.actions({
      remember: ({ reply }) => { later = () => reply?.({ type: 'ANSWERED' }); },
    });

    _runDelivery(asked, () => table.remember(args(), undefined));
    expect(sent, 'nothing yet — the handler only stored it').toEqual([]);

    later!();

    expect(sent, 'answered the asker it was bound to, from outside any delivery').toEqual([
      { to: 'pack/asker', type: 'ANSWERED', client: 'c-1' },
    ]);
  });
});

/**
 * The connection the handler is serving, handed beside the answer.
 *
 * `reply` answers whoever asked; `client` is the window they asked *from*, which is what a system needs to
 * reach a *different* surface in that same window (`sendToWindow`). Both come off one read at entry, and the
 * last case here is why: a handler that stores it and runs later still has the right window, where a send
 * that looked the connection up when called would find none.
 */
describe('the connection an action is handed', () => {
  const clientSeen = (delivery: Parameters<typeof _runDelivery>[0]) => {
    let seen: string | undefined | 'untouched' = 'untouched';
    const table = spec.actions({ note: ({ client }) => { seen = client; } });
    _runDelivery(delivery, () => table.note(args(), undefined));
    return seen;
  };

  it('is the window the asker asked from', () => {
    expect(clientSeen(asked)).toBe('c-1');
  });

  // A system asking another system named no connection, so there is no window to address
  it('is absent when the ask came from no connection', () => {
    expect(clientSeen({ receiver: 'pack/feature', asker: { kind: 'bus', ref: 'pack/asker' } })).toBeUndefined();
  });

  it('is absent when the message named no sender at all', () => {
    expect(clientSeen(unasked)).toBeUndefined();
  });

  /**
   * The case that distinguishes bound from ambient, and the one that fails if this is ever looked up at
   * the moment a send is made: a handler routinely awaits before it acts, and the delivery is gone by then.
   */
  it('still names that window after the delivery has ended', async () => {
    let later: (() => string | undefined) | undefined;
    const table = spec.actions({
      remember: ({ client }) => { later = () => client; },
    });

    _runDelivery(asked, () => table.remember(args(), undefined));
    await Promise.resolve();

    expect(later!(), 'the window it was serving, from outside any delivery').toBe('c-1');
  });
});

describe('an invoke input built from the spec', () => {
  it('hands the actor an answer bound to the delivery that started it', () => {
    const build = spec.input(({ reply }) => ({ reply }));

    const { reply } = _runDelivery(asked, () => build(args()));
    reply?.({ type: 'ANSWERED' });

    expect(sent).toEqual([{ to: 'pack/asker', type: 'ANSWERED', client: 'c-1' }]);
  });

  it('hands nothing on when the message named no sender', () => {
    const build = spec.input(({ reply }) => ({ reply }));

    expect(_runDelivery(unasked, () => build(args())).reply).toBeUndefined();
  });

  // The actor gets the connection the same way, so work it does later can still reach that window
  it('hands the actor the connection too', () => {
    const build = spec.input(({ client }) => ({ client }));

    expect(_runDelivery(asked, () => build(args())).client).toBe('c-1');
    expect(_runDelivery(unasked, () => build(args())).client).toBeUndefined();
  });
});
