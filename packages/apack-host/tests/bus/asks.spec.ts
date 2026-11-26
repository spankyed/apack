import { createNativePackTestRegistry } from '@apackdev/host/testing';
// An ask is answered exactly once whatever happens to it: by the handler that takes it, or by the bus when nothing
// does — the system is not running, or the state it is in does not take the ask. And an answer to an ask this
// process is waiting on is that ask's, taken off before any system or surface sees it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { untypedAsk, type Message } from '@apackdev/sdk/events';
import { createAppBus, type BackendBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const COUNTER = 'counter-pack/counter';

/** What WAIT's handler waits on, which a case settles */
let release: (count: number) => void = () => {};
/** Whether STREAM's handler found its signal aborted when it was released */
let streamStopped: boolean | undefined;

type CounterShape = {
  data: { count: number };
  states: { closed: {}; open: {} };
};
type CounterEvents = { type: 'OPEN' } | { type: 'CLOSE' };
type CounterAsks = {
  COUNT: { args: {}; answer: { count: number } };
  READ: { args: {}; answer: { count: number } };
  WAIT: { args: {}; answer: { count: number } };
  STREAM: { args: {}; answer: { count: number }; progress: number };
};

/** A system that takes COUNT only while open, and READ in either state */
const counter = state<CounterShape, CounterEvents, CounterAsks>()({
  data: { count: 41 },
  initial: 'closed',
  answers: {
    READ: (_args, { data }) => ({ count: data.count }),
    WAIT: () => new Promise<number>((resolve) => { release = resolve; }).then((count) => ({ count })),
    // Tells its asker 1 and 2, waits to be released, then tells 3 and answers: what it was handed says whether to go on
    STREAM: async (_args, { progress, signal }) => {
      progress(1);
      progress(2);
      const count = await new Promise<number>((resolve) => { release = resolve; });
      streamStopped = signal.aborted;
      progress(3);
      return { count };
    },
  },
  states: {
    closed: { on: { OPEN: () => ({ at: 'open' }) } },
    open: {
      on: { CLOSE: () => ({ at: 'closed' }) },
      answers: {
        COUNT: (_args, { data }) => ({ count: data.count + 1 }),
      },
    },
  },
});

let bus: BackendBus;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const send = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

beforeEach(async () => {
  streamStopped = undefined;
  registry.registerPack({ id: 'counter-pack', features: { counter: {
    system: { machine: counter, receives: ['OPEN', 'CLOSE', 'COUNT', 'READ', 'WAIT', 'STREAM'], asks: { COUNT: [], READ: [], WAIT: [], STREAM: [] } },
    // The surface a window's ask comes from, which its answer goes back to
    surface: { receives: [] },
  } } });
  bus = createAppBus(registry).start();
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
      ok: false, failure: { kind: 'unavailable', message: expect.stringContaining('does not take COUNT') },
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

  it('hears what its handler tells it before the answer, in order', async () => {
    const heard: unknown[] = [];
    const asking = untypedAsk(COUNTER, { type: 'STREAM' }, { heard: (update) => { heard.push(update); } });
    await flush();
    expect(heard).toEqual([1, 2]);
    release(7);
    expect(await asking).toEqual({ ok: true, value: { count: 7 } });
    expect(heard).toEqual([1, 2, 3]);
    expect(streamStopped).toBe(false);
  });

  it('that its asker stops aborts its handler\'s signal, and nothing more of it is heard', async () => {
    const heard: unknown[] = [];
    const stopping = new AbortController();
    const asking = untypedAsk(COUNTER, { type: 'STREAM' }, { signal: stopping.signal, heard: (update) => { heard.push(update); } });
    await flush();
    stopping.abort(new Error('the asker moved on'));
    await expect(asking).rejects.toThrow('the asker moved on');
    await flush();
    release(7);
    await flush();
    expect(streamStopped).toBe(true);
    expect(heard).toEqual([1, 2]);
  });
});
