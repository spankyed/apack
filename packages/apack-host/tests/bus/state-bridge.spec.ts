import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, setup, type AnyActorRef } from 'xstate';
import { answered, forNet } from '@apackdev/state';
import { untypedAsk, type Message } from '@apackdev/sdk/events';
import {
  isState,
  packSystem,
  type HostLifecycleEvents,
  type SystemMatchesContract,
} from '@apackdev/sdk/framework';
import { resolveName } from '@apackdev/sdk/ids';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { createAppBus } from '../../src/bus/index.ts';

const PACK_ID = 'state-bridge-pack';
const COUNTER = `${PACK_ID}/counter`;
const BRAIN = `${PACK_ID}/brain`;

type CounterContract = {
  context: { count: number };
  incoming: { type: 'OPEN' } | { type: 'CLOSE' } | { type: 'INCREMENT' } | { type: 'PING_BRAIN' } | { type: 'BAD_BROADCAST' };
  outgoing: { type: 'COUNTED'; count: number };
  asks: {
    READ: { answer: { count: number } };
    COUNT: { answer: { count: number } };
    FIND: { args: { id: string }; answer: { id: string }; refuses: { 'not-found': { id: string } } };
    WAIT: { answer: { count: number } };
    STREAM: { answer: { count: number }; progress: number };
  };
};

interface TestNet {
  systems: {
    counter: {
      events: CounterContract['incoming'];
      asks: {
        READ: { args: {}; answer: { count: number } };
        COUNT: { args: {}; answer: { count: number } };
        FIND: { args: { id: string }; answer: { id: string }; refuses: { 'not-found': { id: string } } };
        WAIT: { args: {}; answer: { count: number } };
        STREAM: { args: {}; answer: { count: number }; progress: number };
      };
    };
  };
  surfaces: {
    counter: { events: CounterContract['outgoing'] | { type: 'UNDECLARED_EVENT' } };
  };
  views: {};
  peers: {
    'role:brain': { events: { type: 'RESTART_BRAIN' } };
  };
}

const packState = forNet<TestNet>((name) => resolveName(name, PACK_ID));

type CounterShape = {
  data: { count: number };
  states: {
    closed: {};
    open: {};
  };
};

type CounterEvents =
  | CounterContract['incoming']
  | Extract<HostLifecycleEvents, { type: 'SEND_STATE' | 'CLIENT_CONNECTED' }>;

let releaseWait: ((count: number) => void) | undefined;
let releaseStream: ((count: number) => void) | undefined;
let streamAborted: boolean | undefined;
let exitCount = 0;

function buildCounterState() {
  return packState<CounterShape, CounterEvents, TestNet['systems']['counter']['asks']>()({
    data: { count: 41 },
    initial: 'closed',
    run: ({ onExit }) => {
      onExit(() => { exitCount++; });
    },
    on: {
      SEND_STATE: (_ev, { data, broadcast }) => {
        broadcast('counter', { type: 'COUNTED', count: data.count });
      },
      CLIENT_CONNECTED: () => {},
      INCREMENT: (_ev, { data }) => ({ data: { count: data.count + 1 } }),
      PING_BRAIN: (_ev, { tell }) => {
        tell({ peer: 'role:brain' }, { type: 'RESTART_BRAIN' });
      },
      BAD_BROADCAST: (_ev, { broadcast }) => {
        broadcast('counter', { type: 'UNDECLARED_EVENT' });
      },
    },
    answers: {
      READ: (_args, { data }) => ({ count: data.count }),
      FIND: (args, { refuse }) => {
        if (args.id === 'missing') throw refuse('not-found', `Missing ${args.id}`, { id: args.id });
        return { id: args.id };
      },
      WAIT: async () => {
        const count = await new Promise<number>((resolve) => { releaseWait = resolve; });
        return answered({ count }, { data: (d) => { d.count = count; } });
      },
      STREAM: async (_args, { progress, signal }) => {
        progress(1);
        progress(2);
        const count = await new Promise<number>((resolve) => { releaseStream = resolve; });
        streamAborted = signal.aborted;
        if (!signal.aborted) progress(3);
        return { count };
      },
    },
    states: {
      closed: {
        on: { OPEN: () => ({ at: 'open' }) },
      },
      open: {
        on: { CLOSE: () => ({ at: 'closed' }) },
        answers: {
          COUNT: (_args, { data }) => answered({ count: data.count + 1 }, { data: { count: data.count + 1 } }),
        },
      },
    },
  });
}

// Type-level check: SystemMatchesContract accepts @apackdev/state backend systems.
type _MatchesCheck = SystemMatchesContract<ReturnType<typeof buildCounterState>, CounterContract>;
const _assertMatches: _MatchesCheck = true;
void _assertMatches;

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

let bus: AnyActorRef;
const brainEvents: Array<{ type: string }> = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const send = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

const brainMachine = setup({
  types: { events: {} as { type: 'RESTART_BRAIN' } },
}).createMachine({
  id: 'brain',
  on: {
    RESTART_BRAIN: { actions: ({ event }) => { brainEvents.push(event); } },
  },
});

function registerCounterPack() {
  const counterState = buildCounterState();
  expect(isState(counterState)).toBe(true);
  const sys = packSystem(counterState, {
    incoming: ['OPEN', 'CLOSE', 'INCREMENT', 'PING_BRAIN', 'BAD_BROADCAST', 'READ', 'COUNT', 'FIND', 'WAIT', 'STREAM'],
  });
  registry.registerPack({
    id: PACK_ID,
    features: {
      counter: {
        system: {
          ...sys,
          asks: { READ: [], COUNT: [], FIND: ['not-found'], WAIT: [], STREAM: [] },
        },
        surface: { receives: ['COUNTED'] },
      },
      brain: {
        designation: 'brain',
        system: { machine: brainMachine, receives: ['RESTART_BRAIN'] },
      },
    },
  });
}

beforeEach(async () => {
  releaseWait = undefined;
  releaseStream = undefined;
  streamAborted = undefined;
  exitCount = 0;
  brainEvents.length = 0;
  registerCounterPack();
  bus = createActor(createAppBus(registry), { systemId: 'host/bus' }).start();
  testRootEvents.emitConnected();
  await flush();
  takeSystemErrors();
});

afterEach(() => {
  bus.stop();
  if (registry.getPackRegistration(PACK_ID)) registry.unregisterPack(PACK_ID);
  takeSystemErrors();
});

describe('backend @apackdev/state bus bridge', () => {
  it('handles tells, updates XState snapshot, and notifies subscribers', () => {
    const actor = bus.system.get(COUNTER)!;
    expect(actor.getSnapshot()).toMatchObject({ status: 'active', value: 'closed', context: { count: 41 } });

    const seen: Array<{ value: unknown; count: unknown }> = [];
    const sub = actor.subscribe((snap: { value: unknown; context: { count: unknown } }) => {
      seen.push({ value: snap.value, count: snap.context.count });
    });

    send({ to: COUNTER, event: { type: 'OPEN' } });
    send({ to: COUNTER, event: { type: 'INCREMENT' } });
    sub.unsubscribe();

    expect(actor.getSnapshot()).toMatchObject({ status: 'active', value: 'open', context: { count: 42 } });
    expect(seen).toEqual([
      { value: 'open', count: 41 },
      { value: 'open', count: 42 },
    ]);
  });

  it('delivers lifecycle events and routes broadcasts through bus surface validation', async () => {
    const outgoing: Message[] = [];
    const stop = testRootEvents.onOutgoing((msg) => outgoing.push(msg));
    try {
      send({ to: COUNTER, event: { type: 'INCREMENT' } });
      send({ to: COUNTER, event: { type: 'SEND_STATE' } });
      await flush();
    } finally {
      stop();
    }

    expect(outgoing).toContainEqual(expect.objectContaining({
      to: COUNTER,
      from: PACK_ID,
      sender: COUNTER,
      event: { type: 'COUNTED', count: 42 },
    }));
  });

  it('reports and drops undeclared surface broadcasts', async () => {
    const outgoing: Message[] = [];
    const stop = testRootEvents.onOutgoing((msg) => outgoing.push(msg));
    try {
      send({ to: COUNTER, event: { type: 'BAD_BROADCAST' } });
      await flush();
    } finally {
      stop();
    }

    expect(outgoing.filter((m) => m.event.type === 'UNDECLARED_EVENT')).toEqual([]);
    const errors = takeSystemErrors();
    expect(errors.some((e) => e.operation === 'broadcast' && e.message.includes('UNDECLARED_EVENT'))).toBe(true);
  });

  it('answers sync asks, mutating state via answered(), and returns unavailable when not accepted in state', async () => {
    expect(await untypedAsk(COUNTER, { type: 'READ' })).toEqual({ ok: true, value: { count: 41 } });

    const refused = await untypedAsk(COUNTER, { type: 'COUNT' });
    expect(refused).toEqual({
      ok: false,
      failure: { kind: 'unavailable', message: expect.any(String) },
    });

    send({ to: COUNTER, event: { type: 'OPEN' } });
    expect(await untypedAsk(COUNTER, { type: 'COUNT' })).toEqual({ ok: true, value: { count: 42 } });
    expect(bus.system.get(COUNTER)!.getSnapshot()).toMatchObject({ value: 'open', context: { count: 42 } });
  });

  it('answers async asks and updates snapshot on completion', async () => {
    const pending = untypedAsk(COUNTER, { type: 'WAIT' });
    await flush();
    expect(releaseWait).toBeDefined();
    releaseWait!(99);
    expect(await pending).toEqual({ ok: true, value: { count: 99 } });
    await flush();
    expect(bus.system.get(COUNTER)!.getSnapshot()).toMatchObject({ context: { count: 99 } });
  });

  it('forwards structured refusals with refusal data', async () => {
    expect(await untypedAsk(COUNTER, { type: 'FIND', id: 'abc' })).toEqual({ ok: true, value: { id: 'abc' } });
    expect(await untypedAsk(COUNTER, { type: 'FIND', id: 'missing' })).toEqual({
      ok: false,
      failure: { kind: 'not-found', message: 'Missing missing', id: 'missing' },
    });
  });

  it('streams progress updates and cancels in-flight asks on abort', async () => {
    const heard: unknown[] = [];
    const controller = new AbortController();
    const pending = untypedAsk(COUNTER, { type: 'STREAM' }, {
      signal: controller.signal,
      heard: (u) => heard.push(u),
    });
    await flush();
    expect(heard).toEqual([1, 2]);

    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');

    releaseStream!(123);
    await flush();
    expect(streamAborted).toBe(true);
    expect(heard).toEqual([1, 2]);
  });

  it('answers window-addressed asks on the originating connection', async () => {
    const outgoing: Message[] = [];
    const stop = testRootEvents.onOutgoing((msg) => outgoing.push(msg));
    try {
      send({ to: COUNTER, event: { type: 'READ' }, sender: COUNTER, client: 'win-1', call: 'call-win-1' });
      await flush();
    } finally {
      stop();
    }

    expect(outgoing).toContainEqual(expect.objectContaining({
      to: COUNTER,
      client: 'win-1',
      answering: 'call-win-1',
      event: { type: 'ASK_ANSWERED', asked: 'READ', answer: { count: 41 } },
    }));
  });

  it('routes role peer tells to the designated system on the bus', async () => {
    send({ to: COUNTER, event: { type: 'PING_BRAIN' } });
    await flush();
    expect(brainEvents).toEqual([{ type: 'RESTART_BRAIN' }]);
    expect(bus.system.get(BRAIN)).toBeDefined();
  });

  it('stops cleanly on RELOAD_PACK and TEARDOWN_PACK, invoking onExit and afterStop', async () => {
    send({ to: COUNTER, event: { type: 'OPEN' } });
    send({ to: COUNTER, event: { type: 'INCREMENT' } });
    expect(bus.system.get(COUNTER)!.getSnapshot()).toMatchObject({ value: 'open', context: { count: 42 } });

    bus.send({ type: 'RELOAD_PACK', packId: PACK_ID, systemIds: [COUNTER] });
    await flush();
    expect(exitCount).toBe(1);
    expect(bus.system.get(COUNTER)!.getSnapshot()).toMatchObject({ status: 'active', value: 'closed', context: { count: 41 } });

    let afterStopCalled = false;
    bus.send({ type: 'TEARDOWN_PACK', packId: PACK_ID, systemIds: [COUNTER], afterStop: () => { afterStopCalled = true; } });
    await flush();
    expect(exitCount).toBe(2);
    expect(afterStopCalled).toBe(true);
  });
});
