import { createNativePackTestRegistry } from '@apackdev/host/testing';
// The counterpart of client-events.spec.ts: a client's event is checked against what a system accepts,
// and a system's event against what the surface declares it receives. A send nobody declared is reported
// as a system error and dropped, rather than thrown — the caller is a running system.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { onLog } from '@apackdev/sdk/logger';
import type { Message } from '@apackdev/sdk/events';
import { createAppBus, type BackendBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { hostRegistration } from '../../src/features/registration.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const machine = state()({});
/** The memos feature: a system that takes PING, and a surface receiving what the system sends it */
const memoFeatures = {
  memos: { system: { machine, receives: ['PING'] }, surface: { receives: ['MEMOS_CONNECTED', 'MEMO_ADDED'] } },
};

let bus: BackendBus;
const outgoing: Message[] = [];
/** What reached a surface, less the SYSTEM_ERROR events reportError sends there itself */
const delivered = () => outgoing.filter(({ event }) => event.type !== 'SYSTEM_ERROR' && event.type !== 'CLIENT_CONNECTED');
let stopOutgoing: () => void;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Sends to a surface are dropped until a client connects, so every case connects first */
async function connect(): Promise<void> {
  testRootEvents.emitConnected();
  await flush();
}

async function send(message: Message): Promise<void> {
  bus.send({ type: 'OUTGOING', message });
  await flush();
}

beforeEach(async () => {
  outgoing.length = 0;
  stopOutgoing = testRootEvents.onOutgoing((event) => { outgoing.push(event); });
  registry.registerPack({ id: 'memo-pack', features: memoFeatures });
  registry.registerPack(hostRegistration());
  bus = createAppBus(registry).start();
  await connect();
  // Each case measures its own sends, after host systems publish their initial state.
  outgoing.length = 0;
});

afterEach(() => {
  bus.stop();
  stopOutgoing();
  registry.unregisterPack('memo-pack');
  registry.unregisterPack('host');
  takeSystemErrors();
});

/**
 * What a dropped *answer* says, which is a different sentence from a dropped command.
 *
 * One path serves four senders — `untypedBroadcast`, the generated `broadcast`, `sendToWindow`
 * and `reply` — and a `reply` caller named no id, so address advice sends the next reader to a call site that
 * has none.
 *
 * **`answering` is its own field on the report, not a third `operation` value.** `operation` says which verb,
 * and two readers filter on it to mean *direction*: `undeclared-incoming.spec.ts`'s helper, and
 * `@apackdev/testing`'s fixture, which collects these to fail a test on a dropped send. The first attempt made
 * it `answering ? 'reply' : 'broadcast'` and shipped a regression — the fixture went on filtering for
 * one value while this sent two, so a dropped answer stopped failing any Playwright test, silently, there
 * being no case over the fixture. The case below that asserts `operation` is unchanged is what holds it.
 */
describe('a dropped answer', () => {
  const answer = (type: string) => send({ to: 'memo-pack/memos', event: { type }, answering: 'c-asked' });

  /**
   * **The report says it was an answer without changing what verb it says.** Both halves matter: lose the flag
   * and the diagnostic cannot tell the two apart; move it into `operation` and every reader filtering on that
   * for direction breaks, which is what happened the first time.
   *
   * Drop `answering` from the message `_replyTo` builds and the first assertion fails.
   */
  it('is marked as an answer, on its own field rather than as a verb', async () => {
    await answer('NOT_DECLARED');
    const [error] = takeSystemErrors();

    expect(error?.answering).toBe(true);
    expect(error?.operation, 'the verb this path is, which readers filter on for direction')
      .toBe('broadcast');
  });

  it('says why a reply can be undeclared at all, rather than giving address advice', async () => {
    await answer('NOT_DECLARED');
    const [error] = takeSystemErrors();
    expect(error?.message).toContain('Dropped the answer "NOT_DECLARED"');
    expect(error?.message, 'the asker cannot type-check an answer, which is the actionable part')
      .toContain('cannot be checked against the asking surface\'s inbox');
    expect(error?.message, 'a reply names no id, so there is none to check').not.toContain('Check the id');
  });

  // A surface nothing declares at all is a race rather than a mistake: nothing holds an asker open
  it('calls an answer to an unregistered surface a race', async () => {
    await send({ to: 'ghost-pack/ghost', event: { type: 'ANYTHING' }, answering: 'c-asked' });
    expect(takeSystemErrors()[0]?.message).toContain('most likely a race');
  });

  // An ordinary broadcast is untouched, which is what makes this a split rather than a reworded diagnostic
  it('leaves a dropped broadcast saying what it always said', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'NOT_DECLARED' } });
    const [error] = takeSystemErrors();
    expect(error?.operation).toBe('broadcast');
    expect(error?.answering, 'absent rather than false, as on the envelope').toBeUndefined();
    expect(error?.message).toContain('add it to that system\'s outgoing events');
  });

  /**
   * The dedupe is keyed on what the report *says*, so a key that ignored `answering` would report whichever
   * arrived first and suppress the other — two different sentences collapsed into one.
   *
   * Drop `answering` from the key and this is the case that fails.
   */
  it('reports a broadcast and an answer of the same type separately', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'NOT_DECLARED' } });
    await answer('NOT_DECLARED');
    const reported = takeSystemErrors();
    expect(reported).toHaveLength(2);
    expect(reported.map((e) => e.answering)).toEqual([undefined, true]);
  });

  // And the dedupe still works within each kind, so the key gained a field rather than losing its job
  it('still reports one answer once, however many times it is sent', async () => {
    await answer('NOT_DECLARED');
    await answer('NOT_DECLARED');
    expect(takeSystemErrors()).toHaveLength(1);
  });
});

describe('an event a system sends to a surface', () => {
  // Where it goes travels beside the event, so a field of the event's own is never taken for it
  it('reaches the client exactly as sent, a surfaceId field of its own included', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'memo-1', surfaceId: 'default-setup/notes' } });
    expect(delivered()).toEqual([{ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'memo-1', surfaceId: 'default-setup/notes' } }]);
  });

  it('is delivered when the surface declares it', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'memo-1' } });
    expect(delivered().map(({ event }) => event.type)).toEqual(['MEMO_ADDED']);
    expect(takeSystemErrors()).toEqual([]);
  });

  it('is dropped and reported when the surface declares no such type', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' } });
    expect(delivered()).toEqual([]);
    const [error] = takeSystemErrors();
    expect(error?.message).toContain('MEMO_SHREDDED');
    expect(error?.message).toContain('memo-pack/memos');
    expect(error?.message).toContain('declares no such event');
  });

  /**
   * `Message.from` is a label the generated sends stamp with their pack's id — the one place a pack's own sends
   * have a sender in scope. Nothing routes or refuses on it; it exists so a drop names who sent the event instead
   * of leaving that to a grep. `reportError` sends for a caller that is neither a pack nor an action and carries
   * none, so the message then reads the same minus the clue, and a drop that names no sender is not suspicious.
   */
  it('names the sending pack in the drop, when the send stamped one', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' }, from: 'other-pack' });
    expect(takeSystemErrors()[0]?.message).toContain('sent by "other-pack"');
  });

  /**
   * An action stamps both: its pack in `from`, itself in `via`. The pack alone would be the less useful half —
   * an action is content a user writes, and the pack running it is whichever pack's runtime ran the code. The
   * `via` here is the string that also names the action's logger, so this drop and that action's own log lines
   * are one grep apart.
   */
  it("names the action too, when an action's send is the one dropped", async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' }, from: 'other-pack', via: 'action:Shred Memo' });
    expect(takeSystemErrors()[0]?.message).toContain('sent by "other-pack" (action:Shred Memo)');
  });

  it('reads the same without a sender, rather than saying one is missing', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' } });
    const [error] = takeSystemErrors();
    expect(error?.message).toContain('Dropped "MEMO_SHREDDED" sent to');
    expect(error?.message).not.toMatch(/sent by|undefined/);
  });

  // The drop is reported once per surface/event pair, and two packs sending the same wrong event are two reports
  it('reports each sending pack, not just the first', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' }, from: 'one-pack' });
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' }, from: 'two-pack' });
    expect(takeSystemErrors()).toHaveLength(2);
  });

  // And each sending action, since the dedupe is keyed on the sentence: one report naming the first action would
  // tell whoever was debugging the second that it was the first
  it('reports each sending action of one pack, not just the first', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' }, from: 'one-pack', via: 'action:A' });
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' }, from: 'one-pack', via: 'action:B' });
    expect(takeSystemErrors().map((e) => e.message.match(/\(action:\w\)/)?.[0])).toEqual(['(action:A)', '(action:B)']);
  });

  /**
   * Still a SYSTEM_ERROR, so takeSystemErrors fails the pack test that left it — and `diagnostic`, so
   * the app doesn't raise a toast over it. The reader is whoever wrote the send, the message is already
   * in the Logs surface where they are looking, and the person using the app can do nothing about it.
   */
  it('is reported as a diagnostic, which is recorded and logged but not shown to the user', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' } });
    expect(takeSystemErrors().map((e) => e.severity)).toEqual(['diagnostic']);
  });

  // The case the notes bug's neighbours live in: a surface id nothing registered declares
  it('is dropped and reported when no pack declares that surface at all', async () => {
    await send({ to: 'ghost', event: { type: 'MEMO_ADDED' } });
    expect(delivered()).toEqual([]);
    const [error] = takeSystemErrors();
    expect(error?.message).toContain('ghost');
    expect(error?.message).toContain('no registered pack declares');
  });

  it("delivers to a host surface, whose types the host declares and no pack widens", async () => {
    await send({ to: 'host/application', event: { type: 'APPLICATION_HOTKEYS', hotkeys: {} } });
    expect(delivered().map(({ event }) => event.type)).toContain('APPLICATION_HOTKEYS');
    expect(takeSystemErrors()).toEqual([]);
  });

  // Onboarding's last action tells the shell to leave its onboarding layout; dropped, the shell waited for a reconnect
  it('delivers ONBOARDING_COMPLETE to the application surface', async () => {
    await send({ to: 'host/application', event: { type: 'ONBOARDING_COMPLETE' } });
    expect(delivered().map(({ event }) => event.type)).toContain('ONBOARDING_COMPLETE');
    expect(takeSystemErrors()).toEqual([]);
  });

  it('drops an event a host surface does not declare, so the host is checked like a pack', async () => {
    await send({ to: 'host/application', event: { type: 'APPLICATION_EXPLODE' } });
    expect(delivered().map(({ event }) => event.type)).not.toContain('APPLICATION_EXPLODE');
    expect(takeSystemErrors()[0]?.message).toContain('APPLICATION_EXPLODE');
  });

  // The packs view is driven entirely by a host system's sends. Checking sends without declaring the
  // host's own surfaces dropped every one of them, and the view stopped updating.
  it("delivers the packs system's sends to the packs surface", async () => {
    await send({ to: 'host/packs', event: { type: 'PACKS_LIST', packs: [] } });
    expect(delivered().map(({ event }) => event.type)).toEqual(['PACKS_LIST']);
    expect(takeSystemErrors()).toEqual([]);
  });
});

/**
 * Reporting a drop logs it, and a log event becomes a send to the logs surface. When that surface is the
 * one being dropped, reporting a drop produces another droppable send — and the send arrives as a fresh
 * OUTGOING event rather than a nested call, so the cycle grows the actor's queue instead of the call
 * stack. It stops responding rather than overflowing, which is why nothing that reasons about
 * re-entrancy within a transition catches it. The test has to drive a running bus for the same reason.
 */
describe('a drop whose report produces another droppable send', () => {
  it('reports the pair once and settles, rather than feeding itself', async () => {
    // Stands in for default-setup's logs system: every log event becomes a send to the logs surface,
    // which no pack here declares, so each send is dropped and reporting it logs again.
    const stopRelay = onLog(() => { bus.send({ type: 'OUTGOING', message: { to: 'default-setup/logs', event: { type: 'LOG_ADDED' } } }); });
    try {
      await send({ to: 'default-setup/logs', event: { type: 'LOG_ADDED' } });
      for (let i = 0; i < 5; i++) await flush();
      const errors = takeSystemErrors().filter((e) => e.message?.includes('default-setup/logs'));
      expect(errors).toHaveLength(1);
    } finally {
      stopRelay();
    }
  });

  it('still reports a different surface, so deduplication is per pair and not a global mute', async () => {
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' } });
    expect(takeSystemErrors().map((e) => e.message)).toHaveLength(1);
    // The same pair again is silent; a different type on the same surface is not
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' } });
    expect(takeSystemErrors()).toEqual([]);
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_BURNED' } });
    expect(takeSystemErrors()).toHaveLength(1);
  });
});

describe('surface delivery during transactional replacement', () => {
  it('keeps delivering through the incumbent after candidate refusal', async () => {
    const previous = registry.getPackRegistration('memo-pack');
    expect(() => registry.replacePack({ id: 'memo-pack', features: {} })).toThrow();
    expect(registry.getPackRegistration('memo-pack')).toBe(previous);
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'memo-1' } });
    expect(delivered()).toHaveLength(1);
    expect(takeSystemErrors()).toEqual([]);
  });

  it('delivers through an accepted replacement without suppressing invalid events', async () => {
    registry.replacePack({ id: 'memo-pack', features: memoFeatures });
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'memo-1' } });
    expect(delivered()).toHaveLength(1);
    await send({ to: 'memo-pack/memos', event: { type: 'MEMO_SHREDDED' } });
    expect(takeSystemErrors()).toHaveLength(1);
  });

  it('reports sends to a genuinely removed pack', async () => {
    registry.unregisterPack('memo-pack');
    outgoing.length = 0;
    try {
      await send({ to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', id: 'memo-1' } });
      expect(delivered()).toEqual([]);
      expect(takeSystemErrors()[0]?.message).toContain('no registered pack declares');
    } finally {
      registry.registerPack({ id: 'memo-pack', features: memoFeatures });
    }
  });
});

describe('a surface no pack declares', () => {
  it('has its sends dropped and reported', async () => {
    await send({ to: 'not-a-surface', event: { type: 'ANYTHING_AT_ALL' } });
    expect(delivered()).toEqual([]);
    expect(takeSystemErrors()[0]?.message).toContain('no registered pack declares');
  });
});
