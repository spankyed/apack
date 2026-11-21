import { createNativePackTestRegistry } from '@apackdev/host/testing';
// A send to a system that declares no such event is reported, not ignored in silence.
//
// The bus has always checked the outgoing direction: a send to a surface that declares no such event is
// reported and dropped (`notify`). Inward it checked only whether the actor was running, so the event was
// delivered, the machine ignored it, and nothing said so — a typo or a stale event type simply stopped
// working.
//
// **What this nets is the untyped hatch**, which is where the asymmetry was. A pack's `tell` and a
// handler's `reply` are typed against a contract, so the compiler has those; `untypedTell` is for
// host code, tooling and a target that arrives as data, and its outward mirror
// (`untypedBroadcast`) was already caught here while this one was not.
//
// Measured 2026-10-06: nothing in either unit pool trips it, so the cases below are written rather than
// found. That makes them the only thing standing under the check — delete the report and the first one
// fails, which is the point of having it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, setup, type AnyActorRef } from 'xstate';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { untypedTell, type Message } from '@apackdev/sdk/events';
import { createAppBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const MEMOS = 'memo-pack/memos';

/** A system that declares one event, which is what makes any other one undeclared */
const memos = setup({}).createMachine({ on: { PING: { actions: () => {} } } });

let bus: AnyActorRef;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * What the bus reported about a send to a system, as a pack test would see it.
 *
 * Filtered by `operation`, because the bus also reports the host surface sends this fixture has no surfaces
 * registered for — unrelated noise that would otherwise be `reported()[0]`.
 */
const reported = () => takeSystemErrors()
  .filter((error) => error.operation === 'tell')
  .map((error) => error.message);

beforeEach(async () => {
  registry.registerPack({ id: 'memo-pack', features: { memos: { system: { machine: memos, receives: ['PING'] } } } });
  bus = createActor(createAppBus(registry), { systemId: 'host/bus' }).start();
  testRootEvents.emitConnected();
  await flush();
  takeSystemErrors();
});

afterEach(() => {
  bus.stop();
  registry.unregisterPack('memo-pack');
  takeSystemErrors();
});

const send = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

describe('a send to a system that declares no such event', () => {
  it('is reported, naming the system and the type', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    const [message] = reported();
    expect(message).toContain('Sent "NOT_DECLARED"');
    expect(message).toContain(`to the "${MEMOS}" system, which declares no such event`);
  });

  // The fix is the contract's, so the report says where to make it rather than only that something went wrong
  it('says what to do about it', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(reported()[0]).toContain("add it there, or send an event the system handles");
  });

  // Named where the send stamped a sender, as the outgoing side's drops are — one fewer clue otherwise
  it('names who sent it when the send said', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' }, from: 'memo-pack', via: 'action:Do It' });
    await flush();

    expect(reported()[0]).toContain('by "memo-pack" (action:Do It)');
  });

  /**
   * Once per distinct report, not once per send. A system in a retry loop would otherwise bury every other
   * diagnostic, and the key is what the message says rather than a second reading of the envelope.
   */
  it('reports a repeat once', async () => {
    for (let i = 0; i < 3; i++) send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(reported()).toHaveLength(1);
  });
});

describe('what it leaves alone', () => {
  it('says nothing about an event the system declares', async () => {
    send({ to: MEMOS, event: { type: 'PING' } });
    await flush();

    expect(reported()).toEqual([]);
  });

  /**
   * The events every system takes are the SDK's to declare, not a pack's, so a pack that never names
   * `FEATURE_SETTINGS_UPDATED` is not thereby wrong to receive one.
   */
  it('says nothing about an event every system receives', async () => {
    send({ to: MEMOS, event: { type: 'FEATURE_SETTINGS_UPDATED', settings: {} } });
    await flush();

    expect(reported()).toEqual([]);
  });

  /**
   * A system that declares `*` accepts anything, so there is nothing to report — the same exemption
   * `receiveClientEvent` makes of a client's send, and the reason both read the declaration rather than
   * guessing from the machine.
   */
  it('says nothing to a system that declares a wildcard', async () => {
    registry.unregisterPack('memo-pack');
    registry.registerPack({
      id: 'memo-pack',
      features: { memos: { system: { machine: memos, receives: ['*'] } } },
    });
    bus.stop();
    bus = createActor(createAppBus(registry), { systemId: 'host/bus' }).start();
    testRootEvents.emitConnected();
    await flush();
    takeSystemErrors();

    send({ to: MEMOS, event: { type: 'ANYTHING_AT_ALL' } });
    await flush();

    expect(reported()).toEqual([]);
  });

  // A system nothing registered is the existing "not found" warning's business, not this one's
  it('says nothing about a system that is not running', async () => {
    send({ to: 'memo-pack/absent', event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(reported()).toEqual([]);
  });

  /**
   * A machine with a catch-all transition is **still held to its declaration**, which is the deliberate
   * half of this check: `'*'` in `on` says the machine will route anything, where `receives` says what the
   * system accepts, and only the second is what a sender is checked against.
   *
   * default-setup's `code` system is the real instance — it routes every unmatched event to a child — and
   * it does not trip this because its contract declares all 157 of those child events. A typed
   * `tell` could not compile otherwise, so the declaration stays complete by construction, and
   * what is left for this check is the untyped hatch.
   *
   * The event is delivered either way: the machine handling or ignoring it is its business, and refusing
   * it here would be a second decision about the same message.
   */
  it('reports an undeclared event to a machine that routes everything, and still delivers it', async () => {
    const seen: string[] = [];
    registry.unregisterPack('memo-pack');
    registry.registerPack({
      id: 'memo-pack',
      features: {
        memos: {
          system: {
            machine: setup({}).createMachine({ on: { '*': { actions: ({ event }) => { seen.push(event.type); } } } }),
            receives: ['PING'],
          },
        },
      },
    });
    bus.stop();
    bus = createActor(createAppBus(registry), { systemId: 'host/bus' }).start();
    testRootEvents.emitConnected();
    await flush();

    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    await flush();

    expect(seen, 'reported, and delivered as before').toContain('NOT_DECLARED');
    takeSystemErrors();
  });
});

/**
 * The same split the outgoing side makes: `reply` and `tell` both land in this check, and advice to fix
 * a target sends the next reader to a call site with none in it.
 *
 * **The helper above still works, which is the design.** `answering` is its own field on the report, so
 * `operation` goes on meaning "the reports this function made" and a reader filtering for direction keeps
 * getting all of them. The first attempt made `operation` itself `'reply'`, which forced a second filter here
 * and — outside the specs — left `@apackdev/testing`'s fixture collecting one value while the bus sent two.
 */
describe('an answer to a system that declares no such event', () => {
  const answer = (type: string) => { send({ to: MEMOS, event: { type }, answering: 'c-asked' }); };
  const answers = () => reported();

  it('is marked as an answer, and still reported as this function\'s own', async () => {
    answer('NOT_DECLARED');
    await flush();

    const [error] = takeSystemErrors();
    expect(error?.answering).toBe(true);
    expect(error?.operation, 'so the direction filter above keeps finding it').toBe('tell');
  });

  it('says why an answer can be undeclared, rather than pointing at the contract alone', async () => {
    answer('NOT_DECLARED');
    await flush();

    const [message] = answers();
    expect(message).toContain('Answered "NOT_DECLARED"');
    expect(message, "the asking side's incoming is what reply cannot be checked against")
      .toContain("cannot be checked against the asking system's incoming");
  });

  /**
   * Keyed on `answering` for the same reason as the outgoing side: the wording varies by it, so a key that
   * ignored it would report whichever arrived first and suppress a different sentence.
   */
  it('reports a send and an answer of the same type separately', async () => {
    send({ to: MEMOS, event: { type: 'NOT_DECLARED' } });
    answer('NOT_DECLARED');
    await flush();

    const all = takeSystemErrors();
    expect(all).toHaveLength(2);
    expect(all.map((error) => error.answering)).toEqual([undefined, true]);
  });
});

describe('through the untyped send', () => {
  it('reports what untypedTell could not have been typed out of', async () => {
    untypedTell(MEMOS, { type: 'BUILT_FROM_DATA' });
    await flush();

    expect(reported()[0]).toContain('Sent "BUILT_FROM_DATA"');
  });
});
