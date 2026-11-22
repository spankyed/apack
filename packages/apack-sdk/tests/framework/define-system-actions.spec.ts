// What a system's action is handed beside XState's arguments: the connection the message it handles arrived on.
//
// `client` is the window an asker asked *from*, which is what a system needs to reach a surface in that same window
// (`sendToWindow`) — a feed beside an answer, say. It comes off one read at entry, and the last cases here are why: a
// handler that stores it and runs later still has the right window, where a send that looked the connection up when
// called would find none. A result is not an action's to send: it is an ask's answer (`answers`).
import { describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { defineSystem } from '../../src/framework/define-system.ts';
import { _runDelivery } from '../../src/events/index.ts';
import { startTestRuntime } from '../../src/testing/index.ts';

startTestRuntime();

type Contract = {
  context: { count: number };
  incoming: { type: 'ASK' } | { type: 'TELL'; note: string };
  outgoing: { type: 'ANSWERED' };
};

const spec = defineSystem<Contract>();

/** The event a door delivers: the very object the machine then hands its actions */
const message = { type: 'ASK' };

/** The arguments XState would hand an action handling that event, as far as these cases care */
const args = () => ({ context: { count: 0 }, event: message } as never);

/** A message a window sent, and one that named no sender */
const asked = { receiver: 'pack/feature', asker: { kind: 'connection', ref: 'pack/asker', client: 'c-1' }, event: message } as const;
const unasked = { receiver: 'pack/feature', event: message };

describe('the connection an action is handed', () => {
  const clientSeen = (delivery: Parameters<typeof _runDelivery>[0], event: unknown = message) => {
    let seen: string | undefined | 'untouched' = 'untouched';
    const table = spec.actions({ note: ({ client }) => { seen = client; } });
    _runDelivery(delivery, () => table.note({ context: { count: 0 }, event } as never, undefined));
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
   * An event the machine made while handling the message is not the message: a system telling its children something
   * of its own, inside the delivery of a window's ask, would otherwise address that window about it.
   */
  it('is absent for an event its machine made while handling the message', () => {
    expect(clientSeen(asked, { type: 'TELL', note: 'of its own' })).toBeUndefined();
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

describe('an action built from the spec', () => {
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
});

describe('an invoke input built from the spec', () => {
  // The actor gets the connection the same way, so work it does later can still reach that window
  it('hands the actor the connection', () => {
    const build = spec.input(({ client }) => ({ client }));

    expect(_runDelivery(asked, () => build(args())).client).toBe('c-1');
    expect(_runDelivery(unasked, () => build(args())).client).toBeUndefined();
  });
});
