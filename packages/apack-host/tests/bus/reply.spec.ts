import { createNativePackTestRegistry } from '@apackdev/host/testing';
// Answering whoever asked, without the handler being told who that is.
//
// A system's handler is given `{ context, event, self, system }` and nothing about the message's sender, so the
// bus names the message for the duration of the delivery and `_replyTo` reads it back — which is what an ask's
// answer (`defineSystem`'s `answers`) is sent through, and what these fixtures call directly. The two things that makes
// true are: the answer goes to the ref that asked rather than to a name the handler had to write, and it goes on
// the connection it was asked from rather than to every window.
//
// The case that carries the design is `answers each of two overlapping asks on its own connection`. Everything
// else here would also pass if the scope were a single module-level variable; only that one fails, because a
// handler that awaits before answering is the ordinary shape of backend work and two of them overlap constantly.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, fromPromise, setup, type AnyActorRef, type AnyEventObject, type MachineContext } from 'xstate';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { _currentDelivery, _replyTo, _runDelivery, untypedBroadcast, untypedTell, type Message, type Reply } from '@apackdev/sdk/events';
import { defineHandlers } from '@apackdev/sdk/framework';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { createAppBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { hostRegistration } from '../../src/features/registration.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

/**
 * A delay inside a *handler*, which is the shape under test rather than a test waiting for anything: a backend
 * system's work is I/O, so it awaits before it answers, and that is what makes the delivery scope load-bearing.
 * The cases themselves await the answer (`untilBus`); see `@apackdev/sdk/testing/waiting` for why.
 */
const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A system that answers a PING with a MEMO_ADDED, waiting `wait` ms first so two asks can be put in flight
 * together. The handler names no address: that is the whole point of the file.
 */
// These fixtures declare no context, so their handlers take XState's own open `MachineContext`
const handlers = defineHandlers<MachineContext, AnyEventObject>();

/** The answer for the message being delivered, read at entry as the `answers` table reads it */
const replyNow = (): Reply | undefined => _replyTo(_currentDelivery());

const answering = setup({
  actions: handlers.actions({
    answer: async ({ event }) => {
      const reply = replyNow();
      await after((event as { wait?: number }).wait ?? 0);
      reply?.({ type: 'MEMO_ADDED', tag: (event as { tag?: string }).tag });
    },
    // Progress and then a result, which is the ordinary shape a second answer has
    answerTwice: ({ event }) => {
      const reply = replyNow();
      reply?.({ type: 'MEMO_ADDED', tag: `${(event as { tag?: string }).tag}-first` });
      reply?.({ type: 'MEMO_ADDED', tag: `${(event as { tag?: string }).tag}-second` });
    },
  }),
}).createMachine({
  on: {
    PING: { actions: 'answer' },
    PING_TWICE: { actions: 'answerTwice' },
    // Names its target rather than answering, which is what every system did before `reply` existed. The
    // envelope should still say who sent it, and that stamp is `createSends`' rather than `reply`'s.
    ANNOUNCE: {
      actions: () => { untypedBroadcast('memo-pack/memos', { type: 'MEMOS_CONNECTED' }); },
    },
  },
});

/**
 * A system that answers from inside an **invoked** actor rather than from the action itself.
 *
 * This is the shape the SDK's licence for the synchronous holder does not cover — its comment reads "none uses
 * `fromPromise`", which is a claim about today's pack code and not an invariant, and `host/settings` already
 * invokes one. The promise is created while the transition is being processed, which is inside the delivery, so
 * the question is whether that is enough for the scope to reach it.
 */
const invoking = setup({
  actors: {
    // The answer arrives through the actor's input, bound when the input was built — which happens while the
    // transition is being processed, inside the delivery
    answerLater: fromPromise(async ({ input }: { input: { tag?: string; reply?: Reply } }) => {
      await after(5);
      input.reply?.({ type: 'MEMO_ADDED', tag: input.tag });
    }),
  },
}).createMachine({
  initial: 'idle',
  states: {
    idle: { on: { PING: 'working' } },
    working: {
      invoke: {
        src: 'answerLater',
        input: handlers.input(({ event }) => ({ tag: (event as { tag?: string }).tag, reply: replyNow() })),
        onDone: 'idle',
        onError: 'idle',
      },
    },
  },
});

/**
 * Asks the answering system and records what comes back: the asker in a system-to-system round trip.
 *
 * It has a surface as well as a system, which is the point — a feature's two halves share one ref, so before
 * `reply` routed on the connection the answer went to this *surface*, in every window, and the system that
 * asked got nothing. The case below asserts both halves of that: the system has it, and no window did.
 */
const answered: string[] = [];
const asking = setup({}).createMachine({
  on: {
    GO: { actions: () => { untypedTell('memo-pack/memos', { type: 'PING', tag: 'from-a-system' }); } },
    MEMO_ADDED: { actions: ({ event }) => { answered.push(String((event as { tag?: string }).tag ?? '')); } },
  },
});

const memoFeatures = {
  memos: { system: { machine: answering, receives: ['PING', 'PING_TWICE', 'ANNOUNCE'] }, surface: { receives: ['MEMOS_CONNECTED', 'MEMO_ADDED'] } },
  invoker: { system: { machine: invoking, receives: ['PING'] }, surface: { receives: ['MEMO_ADDED'] } },
  asker: { system: { machine: asking, receives: ['GO', 'MEMO_ADDED'] }, surface: { receives: ['MEMO_ADDED'] } },
};

let bus: AnyActorRef;
const outgoing: Message[] = [];
const answers = () => outgoing.filter(({ event }) => event.type === 'MEMO_ADDED');
let stopOutgoing: () => void;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What a client's send looks like once the API has stamped the connection it arrived on */
const ask = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

/**
 * Re-reads `satisfied` whenever anything crosses the bus, so a case awaits its answer rather than a delay.
 *
 * Both directions, because an answer goes out to a connection or in to a system depending on who asked, and a
 * case should not have to know which to subscribe to. A negative assertion beside it — "and no window saw it" —
 * is safe once the positive one has arrived: one `reply` call makes one send, so when it has happened the
 * other has not. The case that answers twice calls it twice, and says so.
 */
const untilBus = (satisfied: () => boolean, describe: string) => _whenSatisfied(
  (notify) => {
    const stops = [testRootEvents.onOutgoing(notify), testRootEvents.onIncoming(notify)];
    return () => { for (const stop of stops) stop(); };
  },
  () => satisfied() || undefined,
  describe,
);

beforeEach(async () => {
  outgoing.length = 0;
  answered.length = 0;
  stopOutgoing = testRootEvents.onOutgoing((message) => { outgoing.push(message); });
  registry.registerPack({ id: 'memo-pack', features: memoFeatures });
  registry.registerPack(hostRegistration());
  bus = createActor(createAppBus(registry), { systemId: 'host/bus' }).start();
  testRootEvents.emitConnected();
  await flush();
});

afterEach(() => {
  bus.stop();
  stopOutgoing();
  registry.unregisterPack('memo-pack');
  registry.unregisterPack('host');
  takeSystemErrors();
});

describe('reply', () => {
  it('answers the ref that asked, on the connection it asked from', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 1, 'the answer to the ask');

    expect(answers()).toEqual([
      { to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', tag: undefined }, sender: 'memo-pack/memos', client: 'c-main', call: expect.any(String), answering: undefined },
    ]);
  });

  /**
   * The isolation that the whole mechanism rests on, and the only case here that a single shared variable fails.
   *
   * Two asks go in flight together from different connections; the first waits longer, so its answer is built
   * *after* the second delivery has already come and gone. Each must still answer its own asker.
   */
  it('answers each of two overlapping asks on its own connection', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING', wait: 40, tag: 'slow' }, sender: 'memo-pack/memos', client: 'c-main' });
    ask({ to: 'memo-pack/memos', event: { type: 'PING', wait: 5, tag: 'fast' }, sender: 'memo-pack/memos', client: 'c-popout' });
    await untilBus(() => answers().length === 2, 'both answers');

    const byTag = new Map(answers().map((message) => [message.event.tag as string, message.client]));
    expect(byTag.get('fast'), 'the second ask is answered on the second connection').toBe('c-popout');
    expect(byTag.get('slow'), 'and the first on the first, though it finished later').toBe('c-main');
  });

  /**
   * An answer sent from inside an invoked actor, which is the one delivery shape nothing asserted.
   *
   * It matters because `invoke` is ordinary XState and a system reaching for it has no reason to suspect that
   * answering becomes harder. If this ever regresses, a handler that looks correct stops being able to reply.
   */
  it('answers from inside an invoked actor', async () => {
    ask({ to: 'memo-pack/invoker', event: { type: 'PING', tag: 'invoked' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 1, 'the answer from the invoked actor');

    expect(answers()).toEqual([
      { to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', tag: 'invoked' }, sender: 'memo-pack/invoker', client: 'c-main', call: expect.any(String), answering: undefined },
    ]);
  });

  /**
   * The ask with no connection, which is a system's, and the case this routing exists for.
   *
   * It used to be answered outward and read as correct — "the answer is then for every window, as before" —
   * which was wrong twice: the system that asked never got it, and because a feature's system and surface share
   * one ref, a private answer went to that feature's surface in every open window. `answered` is the asking
   * *system*; `answers()` is what the windows saw.
   */
  it('answers the asking system when the ask came from no connection', async () => {
    bus.send({ type: 'INCOMING', message: { to: 'memo-pack/asker', event: { type: 'GO' } } });
    await untilBus(() => answered.length === 1, 'the asking system to be answered');

    expect(answered, 'the system that asked has its answer').toEqual(['from-a-system']);
    expect(answers(), 'and no window was sent it').toEqual([]);
  });

  it('still answers outward when the ask came from a connection', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING', tag: 'from-a-window' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 1, 'the answer to go out to the connection');

    expect(answers().map(({ client }) => client), 'one connection, not a broadcast').toEqual(['c-main']);
    expect(answered, 'and no system was sent it').toEqual([]);
  });

  /**
   * **A handler may answer more than once, and that is a decision** — `Reply`'s own comment has the reasoning:
   * there is no request id to answer against and no machine can await, so an answer is an event and two of
   * them are two events. A handler reporting progress and then a result is the ordinary shape.
   *
   * Pinned because every other case in this file answers exactly once, so dropping or refusing the second
   * answer would pass all of them — the decision would be reversed and nothing would notice. When a
   * correlating layer arrives, at-most-once belongs to *it*, where the request id exists.
   */
  it('sends both when a handler answers twice, to the one connection that asked', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING_TWICE', tag: 'progress' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 2, 'both answers to go out');

    expect(answers().map(({ event }) => (event as { tag?: string }).tag)).toEqual(['progress-first', 'progress-second']);
    expect(answers().map(({ client }) => client), 'neither widened into a broadcast').toEqual(['c-main', 'c-main']);
  });
});

/**
 * `Message.answering` says a `reply` built this, and the value of that claim is that nothing else sets it.
 *
 * Two readers depend on it being exact rather than a hint: the renderer's wire send keeps the log and drops the
 * toast for one of these, and the bus's two drop diagnostics name `reply` as the verb. A send that acquired the
 * flag some other way would silence a toast somebody is waiting for.
 */
describe('an answer names the call it answers', () => {
  /**
   * **The whole of what the envelope buys.** `answering` was `true` — "a reply built this" — and is the call
   * now, so the asker can tell this answer from one for a request it stopped waiting for. Nothing is declared
   * on either contract for it: the ask carries its call on the envelope and `reply` echoes it from the
   * delivery, which is why a handler that answers after an `await` still names the right request.
   */
  it('stamps the call the request was sent under, outward to a connection', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING', tag: 'to-a-window' }, sender: 'memo-pack/memos', client: 'c-main', call: 'c-the-ask' });
    await untilBus(() => answers().length === 1, 'the answer to go out');

    expect(answers().map(({ answering }) => answering)).toEqual(['c-the-ask']);
  });

  /**
   * The same for the inward branch, which is a different line of `_replyTo` — it is stamped once at construction
   * so all four branches carry it, and these two cases are the pair that would catch stamping per branch instead.
   */
  it('stamps it on the answer that goes back to a system', async () => {
    const incoming: Message[] = [];
    const stop = testRootEvents.onIncoming((message) => { incoming.push(message); });
    try {
      bus.send({ type: 'INCOMING', message: { to: 'memo-pack/asker', event: { type: 'GO' }, call: 'c-the-go' } });
      await untilBus(() => answered.length === 1, 'the asking system to be answered');

      // `GO` makes the asker send its own `PING`, so the answer to *that* names that send's call rather than
      // `c-the-go` — which is the point: a call identifies one send, not a chain of them
      const answer = incoming.find(({ event }) => event.type === 'MEMO_ADDED');
      expect(answer?.answering, 'the inward branch stamps it too').toEqual(expect.any(String));
      expect(answer?.answering, "and it is the PING's call, not the GO's").not.toBe('c-the-go');
    } finally {
      stop();
    }
  });

  // An ask that carried no call cannot be answered by name, and `reply` says so rather than inventing one
  it('leaves it absent when the request carried no call', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING', tag: 'uncorrelated' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 1, 'the answer to go out');

    expect(answers().map(({ answering }) => answering)).toEqual([undefined]);
  });

  /**
   * The invariant, and the one worth the case: a send made *while handling* a message is not thereby an answer,
   * however much scope it shares with one. `ANNOUNCE` makes the handler broadcast, which carries the handler's
   * ref for the same reason a reply does — so `sender` cannot tell the two apart and this field has to.
   */
  it('leaves an ordinary send made inside a delivery unstamped', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'ANNOUNCE' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => outgoing.some(({ event }) => event.type === 'MEMOS_CONNECTED'), 'the announcement');

    const announced = outgoing.filter(({ event }) => event.type === 'MEMOS_CONNECTED');
    expect(announced[0]?.sender, 'it does carry the handler ref, which is why sender cannot distinguish them').toBe('memo-pack/memos');
    expect(announced[0]?.answering, 'but only reply stamps this').toBeUndefined();
  });
});

describe('a send made while handling says where an answer would go', () => {
  /**
   * `reply` sets `sender` itself, so it would pass with no stamping anywhere. This covers the other half: an
   * ordinary `broadcast` made during a delivery carries the handler's own ref, which is what lets the
   * receiver answer *it* rather than having to be told. The stamp comes from the delivery because a pack's
   * generated sends know their pack and not which of its features called them.
   */
  it('stamps the handling feature, not the pack', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'ANNOUNCE' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => outgoing.some(({ event }) => event.type === 'MEMOS_CONNECTED'), 'the announcement');

    const announced = outgoing.filter(({ event }) => event.type === 'MEMOS_CONNECTED');
    expect(announced).toHaveLength(1);
    expect(announced[0].sender, 'the feature\'s ref, where `from` would be the pack alone').toBe('memo-pack/memos');
  });

  // Outside a delivery there is nobody to answer, so the field is absent rather than guessed at
  it('stamps nothing on a send made outside any delivery', async () => {
    untypedBroadcast('memo-pack/memos', { type: 'MEMOS_CONNECTED' });
    await untilBus(() => outgoing.some(({ event }) => event.type === 'MEMOS_CONNECTED'), 'the announcement');

    const announced = outgoing.filter(({ event }) => event.type === 'MEMOS_CONNECTED');
    expect(announced).toHaveLength(1);
    expect(announced[0].sender, 'nobody is being handled, so there is nobody to answer').toBeUndefined();
  });
});

/**
 * There is nothing to answer with, rather than an error raised for trying.
 *
 * These were three cases about `reply()`'s throws: no message being handled, a message that named no sender,
 * and an error naming the receiver so a stack with several systems in it said which one had nothing to answer.
 * A handler is handed its answer now, so the first two are an absent argument — the condition is read before
 * the handler runs rather than after it has decided to answer — and the third has no error left to name
 * anything. That diagnostic is the price of the shape, and it buys the thing it was diagnosing: a handler can
 * no longer be written as though an answer were always there.
 */
describe('there is nothing to answer with', () => {
  it('hands nothing on when no message is being handled', () => {
    expect(_replyTo(undefined)).toBeUndefined();
  });

  it('hands nothing on when the message being handled named no sender', () => {
    expect(_runDelivery({ receiver: 'memo-pack/memos' }, () => _replyTo(_currentDelivery()))).toBeUndefined();
  });
});
