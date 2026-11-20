import { createNativePackTestRegistry } from '@apackdev/host/testing';
// An ask is answered exactly once whatever happens to it: by the handler that takes it, or by the bus when nothing
// does — the system is not running, or the state it is in does not take the ask. And an answer to an ask this
// process is waiting on is that ask's, taken off before any system or surface sees it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, setup, type AnyActorRef } from 'xstate';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { untypedAsk, type Message } from '@apackdev/sdk/events';
import { defineSystem } from '@apackdev/sdk/framework';
import { createAppBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const COUNTER = 'counter-pack/counter';

type Contract = {
  context: { count: number };
  incoming: { type: 'OPEN' } | { type: 'CLOSE' };
  outgoing: { type: 'COUNTED' };
  asks: { COUNT: { answer: { count: number } }; READ: { answer: { count: number } }; WAIT: { answer: { count: number } } };
};
const spec = defineSystem<Contract>();
/** What WAIT's handler waits on, which a case settles */
let release: (count: number) => void = () => {};
const answers = spec.answers({
  COUNT: ({ context }) => ({ count: context.count + 1 }),
  READ: ({ context }) => ({ count: context.count }),
  WAIT: () => new Promise<number>((resolve) => { release = resolve; }).then((count) => ({ count })),
});

/** A system that takes COUNT only while open, and READ in either state */
const counter = setup({ types: spec.types, actions: { ...answers.actions } }).createMachine({
  context: { count: 41 },
  initial: 'closed',
  on: { READ: answers.on.READ, WAIT: answers.on.WAIT },
  states: {
    closed: { on: { OPEN: 'open' } },
    open: { on: { COUNT: answers.on.COUNT, CLOSE: 'closed' } },
  },
});

let bus: AnyActorRef;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const send = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

beforeEach(async () => {
  registry.registerPack({ id: 'counter-pack', features: { counter: {
    system: { machine: counter, receives: ['OPEN', 'CLOSE', 'COUNT', 'READ', 'WAIT'], asks: { COUNT: [], READ: [], WAIT: [] } },
    // The surface a window's ask comes from, which its answer goes back to
    surface: { receives: [] },
  } } });
  bus = createActor(createAppBus(registry), { systemId: 'host/bus' }).start();
  testRootEvents.emitConnected();
  await flush();
  takeSystemErrors();
});

afterEach(() => {
  bus.stop();
  if (registry.getPackRegistration('counter-pack')) registry.unregisterPack('counter-pack');
  takeSystemErrors();
});

describe('an ask', () => {
  it('is answered by the handler that takes it, as a value its asker awaits', async () => {
    expect(await untypedAsk(COUNTER, { type: 'READ' })).toEqual({ ok: true, value: { count: 41 } });
  });

  it('is answered unavailable when the state the system is in does not take it', async () => {
    expect(await untypedAsk(COUNTER, { type: 'COUNT' })).toEqual({
      ok: false, failure: { kind: 'unavailable', message: expect.stringContaining('does not take "COUNT" in the state it is in') },
    });
    send({ to: COUNTER, event: { type: 'OPEN' } });
    expect(await untypedAsk(COUNTER, { type: 'COUNT' })).toEqual({ ok: true, value: { count: 42 } });
  });

  it('is answered unavailable when no system of that name is running', async () => {
    expect(await untypedAsk('counter-pack/nobody', { type: 'READ' })).toEqual({
      ok: false, failure: { kind: 'unavailable', message: expect.stringContaining('No "counter-pack/nobody" system is running') },
    });
  });

  it('is answered on the connection it arrived on, where a window asked', async () => {
    const answers: Message[] = [];
    const stop = testRootEvents.onOutgoing((message) => { answers.push(message); });
    try {
      send({ to: COUNTER, event: { type: 'READ' }, sender: COUNTER, client: 'c-window', call: 'c-ask-1' });
      await flush();
    } finally { stop(); }
    expect(answers).toEqual([expect.objectContaining({
      to: COUNTER, client: 'c-window', answering: 'c-ask-1',
      event: { type: 'ASK_ANSWERED', asked: 'READ', answer: { count: 41 } },
    })]);
  });

  it('that names no asker is handled, and nothing is answered', async () => {
    const sent: Message[] = [];
    const stops = [testRootEvents.onOutgoing((message) => { sent.push(message); }), testRootEvents.onIncoming((message) => { sent.push(message); })];
    try {
      send({ to: COUNTER, event: { type: 'COUNT' } });
      await flush();
    } finally { stops.forEach((stop) => stop()); }
    expect(sent).toEqual([]);
  });

  it('gives up on its answer when its signal aborts, and the answer that comes later goes nowhere', async () => {
    const giving = new AbortController();
    const asking = untypedAsk(COUNTER, { type: 'WAIT' }, { signal: giving.signal });
    giving.abort(new Error('the asker went'));
    await expect(asking).rejects.toThrow('the asker went');
    // Answered after the asker gave up: nothing is waiting on its call, so it is routed as any answer is, and dropped
    release(1);
    await flush();
    expect(takeSystemErrors()).toEqual([]);
  });
});
