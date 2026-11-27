import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answered, forNet, state } from '@apackdev/state';
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
import { createAppBus, createBus, HOST, type BackendBus } from '../../src/bus/index.ts';

const PACK_ID = 'bus-state-pack';
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

let bus: BackendBus;
const brainEvents: Array<{ type: string }> = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const send = (message: Message) => { bus.send({ type: 'INCOMING', message }); };

const brainState = state<{}, { type: 'RESTART_BRAIN' }>()({
  on: {
    RESTART_BRAIN: (event) => { brainEvents.push(event); },
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
        system: { machine: brainState, receives: ['RESTART_BRAIN'] },
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
  bus = createAppBus(registry).start();
  testRootEvents.emitConnected();
  await flush();
  takeSystemErrors();
});

afterEach(() => {
  bus.stop();
  if (registry.getPackRegistration(PACK_ID)) registry.unregisterPack(PACK_ID);
  takeSystemErrors();
});

describe('native @apackdev/state backend bus', () => {
  it('exposes the shared System and Port, handles tells, updates snapshots, and notifies subscribers', () => {
    expect(bus.port).toBe(bus.system.port);
    const sysRef = bus.getSystem(COUNTER)!;
    expect(sysRef.read()).toMatchObject({ at: 'closed', data: { count: 41 } });

    const seen: Array<{ at: unknown; count: unknown }> = [];
    const unsubscribe = sysRef.subscribe((snap) => {
      seen.push({ at: snap.at, count: snap.data.count });
    });

    send({ to: COUNTER, event: { type: 'OPEN' } });
    send({ to: COUNTER, event: { type: 'INCREMENT' } });
    unsubscribe();

    expect(sysRef.read()).toMatchObject({ at: 'open', data: { count: 42 } });
    expect(seen).toEqual([
      { at: 'open', count: 41 },
      { at: 'open', count: 42 },
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
    expect(bus.read(COUNTER)).toMatchObject({ at: 'open', data: { count: 42 } });
  });

  it('answers async asks and updates snapshot on completion', async () => {
    const pending = untypedAsk(COUNTER, { type: 'WAIT' });
    await flush();
    expect(releaseWait).toBeDefined();
    releaseWait!(99);
    expect(await pending).toEqual({ ok: true, value: { count: 99 } });
    await flush();
    expect(bus.read(COUNTER)).toMatchObject({ data: { count: 99 } });
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
    expect(bus.getSystem(BRAIN)).toBeDefined();
  });

  it('stops cleanly on RELOAD_PACK and TEARDOWN_PACK, invoking onExit and afterStop', async () => {
    send({ to: COUNTER, event: { type: 'OPEN' } });
    send({ to: COUNTER, event: { type: 'INCREMENT' } });
    expect(bus.read(COUNTER)).toMatchObject({ at: 'open', data: { count: 42 } });

    bus.send({ type: 'RELOAD_PACK', packId: PACK_ID, systemIds: [COUNTER] });
    await flush();
    expect(exitCount).toBe(1);
    expect(bus.read(COUNTER)).toMatchObject({ at: 'closed', data: { count: 41 } });

    let afterStopCalled = false;
    bus.send({ type: 'TEARDOWN_PACK', packId: PACK_ID, systemIds: [COUNTER], afterStop: () => { afterStopCalled = true; } });
    await flush();
    expect(exitCount).toBe(2);
    expect(afterStopCalled).toBe(true);
    expect(bus.getSystem(COUNTER)).toBeUndefined();
  });

  it('preserves true emitting sender and from across synchronous cross-system tell and Def.listen cascades', async () => {
    const externalListeners = new Set<() => void>();
    const fireExternal = () => { for (const fn of externalListeners) fn(); };

    interface CascadeNet {
      systems: {
        'alpha/driver': { events: { type: 'TRIGGER_TELL' } | { type: 'TRIGGER_LISTEN' }; asks: {} };
        'beta/worker': { events: { type: 'FROM_ALPHA' }; asks: {} };
        'gamma/watcher': { events: never; asks: {} };
      };
      surfaces: {
        'beta/worker': { events: { type: 'BETA_BROADCAST' } };
        'gamma/watcher': { events: { type: 'GAMMA_BROADCAST' } };
      };
      views: {};
      peers: {
        'role:brain': { events: { type: 'RESTART_BRAIN' } };
      };
    }
    const cascadeState = forNet<CascadeNet>();

    const alphaDriver = cascadeState<{}, { type: 'TRIGGER_TELL' } | { type: 'TRIGGER_LISTEN' }>()({
      on: {
        TRIGGER_TELL: (_ev, { tell }) => {
          tell('beta/worker', { type: 'FROM_ALPHA' });
        },
        TRIGGER_LISTEN: () => {
          fireExternal();
        },
      },
    });
    const betaWorker = cascadeState<{}, { type: 'FROM_ALPHA' }>()({
      on: {
        FROM_ALPHA: (_ev, { broadcast, tell }) => {
          broadcast('beta/worker', { type: 'BETA_BROADCAST' });
          tell({ peer: 'role:brain' }, { type: 'RESTART_BRAIN' });
        },
      },
    });
    const gammaWatcher = cascadeState<{ internal: { type: 'EXTERNAL_FIRED' } }, never>()({
      listen: ({ send }) => {
        const listener = () => send({ type: 'EXTERNAL_FIRED' });
        externalListeners.add(listener);
        return () => { externalListeners.delete(listener); };
      },
      internal: {
        EXTERNAL_FIRED: (_ev, { broadcast, tell }) => {
          broadcast('gamma/watcher', { type: 'GAMMA_BROADCAST' });
          tell({ peer: 'role:brain' }, { type: 'RESTART_BRAIN' });
        },
      },
    });

    const localReg = createNativePackTestRegistry();
    localReg.registerPack({
      id: 'alpha',
      features: { driver: { system: { machine: alphaDriver, receives: ['TRIGGER_TELL', 'TRIGGER_LISTEN'] } } },
    });
    localReg.registerPack({
      id: 'beta',
      features: {
        worker: {
          system: { machine: betaWorker, receives: ['FROM_ALPHA'] },
          surface: { receives: ['BETA_BROADCAST'] },
        },
      },
    });
    localReg.registerPack({
      id: 'gamma',
      features: {
        watcher: {
          system: { machine: gammaWatcher, receives: [] },
          surface: { receives: ['GAMMA_BROADCAST'] },
        },
      },
    });
    const roleBrain = state<{}, { type: 'RESTART_BRAIN' }>()({
      on: { RESTART_BRAIN: () => {} },
    });
    localReg.registerPack({
      id: 'host-brain',
      features: { brain: { designation: 'brain', system: { machine: roleBrain, receives: ['RESTART_BRAIN'] } } },
    });

    const outgoing: Message[] = [];
    const incomingToBrain: Message[] = [];
    const cascadeBus = createBus({
      registry: localReg,
      onOutgoing: (msg) => outgoing.push(msg),
      listen: () => () => {},
      onEvent: (ev) => {
        if (ev.type === 'INCOMING' && ev.message.to === 'host-brain/brain') {
          incomingToBrain.push(ev.message);
        }
      },
    }).start();
    cascadeBus.send({ type: 'CLIENT_CONNECTED' });

    try {
      // Cross-system synchronous tell cascade: alpha/driver -> beta/worker -> broadcast & role:brain
      cascadeBus.send({ type: 'INCOMING', message: { to: 'alpha/driver', event: { type: 'TRIGGER_TELL' } } });
      await flush();

      expect(outgoing).toContainEqual(expect.objectContaining({
        to: 'beta/worker',
        from: 'beta',
        sender: 'beta/worker',
        event: { type: 'BETA_BROADCAST' },
      }));
      expect(incomingToBrain[0]).toMatchObject({
        to: 'host-brain/brain',
        sender: 'beta/worker',
        event: { type: 'RESTART_BRAIN' },
      });

      // Def.listen cascade triggered synchronously inside alpha/driver's delivery: gamma/watcher -> broadcast & role:brain
      outgoing.length = 0;
      incomingToBrain.length = 0;
      cascadeBus.send({ type: 'INCOMING', message: { to: 'alpha/driver', event: { type: 'TRIGGER_LISTEN' } } });
      await flush();

      expect(outgoing).toContainEqual(expect.objectContaining({
        to: 'gamma/watcher',
        from: 'gamma',
        sender: 'gamma/watcher',
        event: { type: 'GAMMA_BROADCAST' },
      }));
      expect(incomingToBrain[0]).toMatchObject({
        to: 'host-brain/brain',
        sender: 'gamma/watcher',
        event: { type: 'RESTART_BRAIN' },
      });

      // Def.listen cascade triggered completely outside any delivery
      outgoing.length = 0;
      incomingToBrain.length = 0;
      fireExternal();
      await flush();

      expect(outgoing).toContainEqual(expect.objectContaining({
        to: 'gamma/watcher',
        from: 'gamma',
        sender: 'gamma/watcher',
        event: { type: 'GAMMA_BROADCAST' },
      }));
      expect(incomingToBrain[0]).toMatchObject({
        to: 'host-brain/brain',
        sender: 'gamma/watcher',
        event: { type: 'RESTART_BRAIN' },
      });
    } finally {
      cascadeBus.stop();
    }
  });

  it('settles queued TEARDOWN_PACK and SYSTEMS_STOPPED afterStop callbacks on bus.stop()', () => {
    const settled: string[] = [];
    const localBus = createBus({
      registry,
      onOutgoing: () => {},
      listen: () => () => {},
      onEvent: (ev) => {
        if (ev.type === 'INCOMING' && ev.message.event.type === 'OPEN') {
          // Enqueue teardowns while draining, then immediately stop the bus
          localBus.send({ type: 'TEARDOWN_PACK', systemIds: [COUNTER], afterStop: () => settled.push('queued-teardown') });
          localBus.send({ type: 'SYSTEMS_STOPPED', afterStop: () => settled.push('queued-stopped') });
          localBus.stop();
        }
      },
    }).start();

    localBus.send({ type: 'INCOMING', message: { to: COUNTER, event: { type: 'OPEN' } } });
    expect(settled).toEqual(['queued-teardown', 'queued-stopped']);

    // A TEARDOWN_PACK sent after bus.stop() also settles immediately rather than hanging
    localBus.send({ type: 'TEARDOWN_PACK', systemIds: [COUNTER], afterStop: () => settled.push('post-stop') });
    expect(settled).toEqual(['queued-teardown', 'queued-stopped', 'post-stop']);
  });

  it('resumes draining remaining queued events after an observer exception in drain()', async () => {
    let shouldThrow = true;
    const seen: string[] = [];
    const onError = vi.fn();
    const localBus = createBus({
      registry,
      onOutgoing: () => {},
      listen: () => () => {},
      onEvent: (ev) => {
        if (ev.type === 'INCOMING') {
          seen.push(ev.message.event.type);
          if (shouldThrow && ev.message.event.type === 'OPEN') {
            shouldThrow = false;
            localBus.send({ type: 'INCOMING', message: { to: COUNTER, event: { type: 'INCREMENT' } } });
            throw new Error('boom in first queued item');
          }
        }
      },
    }).start();
    localBus.onError(onError);

    try {
      expect(() => localBus.send({ type: 'INCOMING', message: { to: COUNTER, event: { type: 'OPEN' } } }))
        .toThrow('boom in first queued item');
      expect(onError).toHaveBeenCalledOnce();
      await flush();
      expect(seen).toEqual(['OPEN', 'INCREMENT']);
      expect(localBus.read(COUNTER)?.data.count).toBe(42);
    } finally {
      localBus.stop();
    }
  });

  it('rejects unrecognized and privileged lifecycle events addressed to HOST.bus via INCOMING', async () => {
    const afterStop = vi.fn();
    send({ to: HOST.bus, event: { type: 'TEARDOWN_PACK', packId: PACK_ID, systemIds: [COUNTER], afterStop } });
    send({ to: HOST.bus, event: { type: 'RELOAD_PACK', packId: PACK_ID, systemIds: [COUNTER] } });
    send({ to: HOST.bus, event: { type: 'SYSTEMS_STOPPED', afterStop } });
    await flush();

    // Counter must still be running untouched and privileged callbacks must never have executed
    expect(bus.getSystem(COUNTER)).toBeDefined();
    expect(afterStop).not.toHaveBeenCalled();
    expect(takeSystemErrors().length).toBeGreaterThanOrEqual(1);
  });
});
