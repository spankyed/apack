import { createNativePackTestRegistry } from '@apackdev/host/testing';
// Answering whoever asked, without the handler being told who that is.
//
// A system's handler is handed only the event and scope — nothing about the message's sender — so the
// bus names the message for the duration of the delivery and `_replyTo` reads it back. The two things that makes
// true are: the answer goes to the ref that asked rather than to a name the handler had to write, and it goes on
// the connection it was asked from rather than to every window.
//
// The case that carries the design is `answers each of two overlapping asks on its own connection`. Everything
// else here would also pass if the scope were a single module-level variable; only that one fails, because a
// handler that awaits before answering is the ordinary shape of backend work and two of them overlap constantly.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { given, state } from '@apackdev/state';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { _currentDelivery, _replyTo, _runDelivery, untypedBroadcast, untypedTell, type Message, type Reply } from '@apackdev/sdk/events';
import { _whenSatisfied } from '@apackdev/sdk/testing/waiting';
import { createAppBus, type BackendBus } from '../../src/bus/index.ts';
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

/** The answer for the message being delivered, read at entry as the `answers` table reads it */
const replyNow = (): Reply | undefined => _replyTo(_currentDelivery());

type AnsweringEvent =
  | { type: 'PING'; wait?: number; tag?: string }
  | { type: 'PING_TWICE'; tag?: string }
  | { type: 'ANNOUNCE' };

const answering = state<{}, AnsweringEvent>()({
  on: {
    PING: (event) => {
      const reply = replyNow();
      void after(event.wait ?? 0).then(() => {
        reply?.({ type: 'MEMO_ADDED', tag: event.tag });
      });
    },
    // Progress and then a result, which is the ordinary shape a second answer has
    PING_TWICE: (event) => {
      const reply = replyNow();
      reply?.({ type: 'MEMO_ADDED', tag: `${event.tag}-first` });
      reply?.({ type: 'MEMO_ADDED', tag: `${event.tag}-second` });
    },
    // Names its target rather than answering, which is what every system did before `reply` existed. The
    // envelope should still say who sent it, and that stamp is `createSends`' rather than `reply`'s.
    ANNOUNCE: () => {
      untypedBroadcast('memo-pack/memos', { type: 'MEMOS_CONNECTED' });
    },
  },
});

/**
 * A system that answers from inside a state's async `run` work entered by the transition,
 * capturing `reply` synchronously at transition time and passing it into the working state's data.
 */
type InvokingShape = {
  states: {
    idle: {};
    working: { data: { tag: string | undefined; reply: Reply | undefined } };
  };
};

const invoking = state<InvokingShape, { type: 'PING'; tag?: string }>()({
  initial: 'idle',
  states: {
    idle: {
      on: {
        PING: (event) => ({ at: 'working', data: { tag: event.tag, reply: replyNow() } }),
      },
    },
    working: {
      data: { tag: given, reply: given },
      run: async ({ data }) => {
        await after(5);
        data.reply?.({ type: 'MEMO_ADDED', tag: data.tag });
        return { at: 'idle' };
      },
      failed: () => ({ at: 'idle' }),
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
const asking = state<{}, { type: 'GO' } | { type: 'MEMO_ADDED'; tag?: string }>()({
  on: {
    GO: () => { untypedTell('memo-pack/memos', { type: 'PING', tag: 'from-a-system' }); },
    MEMO_ADDED: (event) => { answered.push(String(event.tag ?? '')); },
  },
});

const memoFeatures = {
  memos: { system: { machine: answering, receives: ['PING', 'PING_TWICE', 'ANNOUNCE'] }, surface: { receives: ['MEMOS_CONNECTED', 'MEMO_ADDED'] } },
  invoker: { system: { machine: invoking, receives: ['PING'] }, surface: { receives: ['MEMO_ADDED'] } },
  asker: { system: { machine: asking, receives: ['GO', 'MEMO_ADDED'] }, surface: { receives: ['MEMO_ADDED'] } },
};

let bus: BackendBus;
const outgoing: Message[] = [];
const answers = () => outgoing.filter(({ event }) => event.type === 'MEMO_ADDED');
let stopOutgoing: () => void;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What a client's send looks like once the API has stamped the connection it arrived on */
const ask = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

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
  bus = createAppBus(registry).start();
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

  it('answers each of two overlapping asks on its own connection', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING', wait: 40, tag: 'slow' }, sender: 'memo-pack/memos', client: 'c-main' });
    ask({ to: 'memo-pack/memos', event: { type: 'PING', wait: 5, tag: 'fast' }, sender: 'memo-pack/memos', client: 'c-popout' });
    await untilBus(() => answers().length === 2, 'both answers');

    const byTag = new Map(answers().map((message) => [message.event.tag as string, message.client]));
    expect(byTag.get('fast'), 'the second ask is answered on the second connection').toBe('c-popout');
    expect(byTag.get('slow'), 'and the first on the first, though it finished later').toBe('c-main');
  });

  it('answers from inside async state work', async () => {
    ask({ to: 'memo-pack/invoker', event: { type: 'PING', tag: 'invoked' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 1, 'the answer from async state work');

    expect(answers()).toEqual([
      { to: 'memo-pack/memos', event: { type: 'MEMO_ADDED', tag: 'invoked' }, sender: 'memo-pack/invoker', client: 'c-main', call: expect.any(String), answering: undefined },
    ]);
  });

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

  it('sends both when a handler answers twice, to the one connection that asked', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING_TWICE', tag: 'progress' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 2, 'both answers to go out');

    expect(answers().map(({ event }) => (event as { tag?: string }).tag)).toEqual(['progress-first', 'progress-second']);
    expect(answers().map(({ client }) => client), 'neither widened into a broadcast').toEqual(['c-main', 'c-main']);
  });
});

describe('an answer names the call it answers', () => {
  it('stamps the call the request was sent under, outward to a connection', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING', tag: 'to-a-window' }, sender: 'memo-pack/memos', client: 'c-main', call: 'c-the-ask' });
    await untilBus(() => answers().length === 1, 'the answer to go out');

    expect(answers().map(({ answering }) => answering)).toEqual(['c-the-ask']);
  });

  it('stamps it on the answer that goes back to a system', async () => {
    const incoming: Message[] = [];
    const stop = testRootEvents.onIncoming((message) => { incoming.push(message); });
    try {
      bus.send({ type: 'INCOMING', message: { to: 'memo-pack/asker', event: { type: 'GO' }, call: 'c-the-go' } });
      await untilBus(() => answered.length === 1, 'the asking system to be answered');

      const answer = incoming.find(({ event }) => event.type === 'MEMO_ADDED');
      expect(answer?.answering, 'the inward branch stamps it too').toEqual(expect.any(String));
      expect(answer?.answering, "and it is the PING's call, not the GO's").not.toBe('c-the-go');
    } finally {
      stop();
    }
  });

  it('leaves it absent when the request carried no call', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'PING', tag: 'uncorrelated' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => answers().length === 1, 'the answer to go out');

    expect(answers().map(({ answering }) => answering)).toEqual([undefined]);
  });

  it('leaves an ordinary send made inside a delivery unstamped', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'ANNOUNCE' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => outgoing.some(({ event }) => event.type === 'MEMOS_CONNECTED'), 'the announcement');

    const announced = outgoing.filter(({ event }) => event.type === 'MEMOS_CONNECTED');
    expect(announced[0]?.sender, 'it does carry the handler ref, which is why sender cannot distinguish them').toBe('memo-pack/memos');
    expect(announced[0]?.answering, 'but only reply stamps this').toBeUndefined();
  });
});

describe('a send made while handling says where an answer would go', () => {
  it('stamps the handling feature, not the pack', async () => {
    ask({ to: 'memo-pack/memos', event: { type: 'ANNOUNCE' }, sender: 'memo-pack/memos', client: 'c-main' });
    await untilBus(() => outgoing.some(({ event }) => event.type === 'MEMOS_CONNECTED'), 'the announcement');

    const announced = outgoing.filter(({ event }) => event.type === 'MEMOS_CONNECTED');
    expect(announced).toHaveLength(1);
    expect(announced[0].sender, 'the feature\'s ref, where `from` would be the pack alone').toBe('memo-pack/memos');
  });

  it('stamps nothing on a send made outside any delivery', async () => {
    untypedBroadcast('memo-pack/memos', { type: 'MEMOS_CONNECTED' });
    await untilBus(() => outgoing.some(({ event }) => event.type === 'MEMOS_CONNECTED'), 'the announcement');

    const announced = outgoing.filter(({ event }) => event.type === 'MEMOS_CONNECTED');
    expect(announced).toHaveLength(1);
    expect(announced[0].sender, 'nobody is being handled, so there is nobody to answer').toBeUndefined();
  });
});

describe('there is nothing to answer with', () => {
  it('hands nothing on when no message is being handled', () => {
    expect(_replyTo(undefined)).toBeUndefined();
  });

  it('hands nothing on when the message being handled named no sender', () => {
    expect(_runDelivery({ receiver: 'memo-pack/memos' }, () => _replyTo(_currentDelivery()))).toBeUndefined();
  });
});
