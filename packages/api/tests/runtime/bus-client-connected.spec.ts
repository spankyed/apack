// Systems send their startup data on CLIENT_CONNECTED. The bus sends it on every client connection, and to
// an activated pack's systems, except to external packs with frontend code: a client loads it after
// connecting (or after the activation) and asks for each pack once it tried, whatever that loaded. A
// reloaded pack's restarted systems get it too.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, setup, type AnyActorRef } from 'xstate';
import type { Message } from '@apackdev/sdk/events';
import { _memoryRunHistoryStore } from '@apackdev/sdk/testing';

vi.mock('@apackdev/host/app-state', async (importOriginal) => ({
  ...await importOriginal<typeof import('@apackdev/host/app-state')>(),
  appState: { get: () => ({ hasOnboarded: true }) },
}));

const { createNativePackTestRegistry } = await import('@apackdev/host/testing');
const registry = createNativePackTestRegistry();
const { registerPack, unregisterPack } = registry;
const { createAppBus, createBusMachine } = await import('@apackdev/host/bus');
const { rootEvents } = await import('../../src/transport/emitter.ts');

// The app's bus on the api's transport, as setup/backend.ts binds it (the services reach the store only when called)
const { bindHost } = await import('@apackdev/sdk/runtime');
const { createHostRuntime } = await import('@apackdev/host/services');
const { _createTestEngine } = await import('@apackdev/sdk/testing');
const { untypedBroadcastToSurface } = await import('@apackdev/sdk/events');
type EarsDatabase = import('@apackdev/ears').EarsDatabase;
bindHost(createHostRuntime({ runHistory: _memoryRunHistoryStore(), database: {} as EarsDatabase, engine: _createTestEngine(), transport: { rootEvents }, appVersion: '1.0.0', packs: registry }));
const backendSystem = createAppBus(registry);

const received: string[] = [];

/** A system that records each CLIENT_CONNECTED it receives, and each pack content it's told about */
function recorder(label: string) {
  return setup({}).createMachine({
    on: {
      CLIENT_CONNECTED: { actions: () => received.push(label) },
      PACK_CHANGED: { actions: ({ event }) => received.push(`${label}: changed ${(event as unknown as { packId: string }).packId}`) },
    },
  });
}

function pack(id: string, label = id) {
  return { id, features: { feature: { system: { machine: recorder(label), receives: ['CLIENT_CONNECTED'] } } } };
}

const packDirs: string[] = [];

/** An installed pack's origin, with the frontend files `files` names (runtime/fe.js, runtime/fe.css) on disk */
function loaded(id: string, files: string[], features: Record<string, { description: string; system: { entry: string } }> = { feature: { description: 'Record client connections.', system: { entry: 'system.ts' } } }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bus-client-connected-${id}-`));
  packDirs.push(dir);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), '');
  }
  return { eventContracts: Object.fromEntries(Object.keys(features).map(id => [id, { system: { incoming: [], outgoing: [] } }])), declarationRevision: 'fixture-revision', buildRevision: 'a'.repeat(64), buildFiles: Object.fromEntries(files.map(file => [file, 'b'.repeat(64)])), id, name: id, version: '1.0.0', dir, manifest: { id, name: id, version: '1.0.0', features } };
}

const withFrontend = ['runtime/fe.js'];

let bus: AnyActorRef;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  received.length = 0;
  registerPack(pack('first-pack'));
  bus = createActor(backendSystem, { systemId: 'host/bus' }).start();
});

afterEach(() => {
  bus.stop();
  for (const id of ['first-pack', 'second-pack', 'external-pack', 'notes-pack']) {
    try { unregisterPack(id); } catch { /* not registered */ }
  }
  for (const dir of packDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('CLIENT_CONNECTED on the bus', () => {
  it("reaches only a pack's systems when a client has loaded that pack's frontend", async () => {
    rootEvents.emitConnected();
    registerPack(pack('second-pack'), loaded('second-pack', withFrontend));
    bus.send({ type: 'ACTIVATE_PACK', packId: 'second-pack', systemIds: ['second-pack/feature'] });
    await flush();
    received.length = 0;

    rootEvents.emitPackClientConnected('second-pack');
    await flush();
    expect(received).toEqual(['second-pack']);

    rootEvents.emitPackClientConnected('first-pack');
    await flush();
    expect(received).toEqual(['second-pack', 'first-pack']);
  });

  it("reaches an activated pack's systems once, when a client has loaded its frontend", async () => {
    rootEvents.emitConnected();
    await flush();
    received.length = 0;
    registerPack(pack('second-pack'), loaded('second-pack', withFrontend));
    bus.send({ type: 'ACTIVATE_PACK', packId: 'second-pack', systemIds: ['second-pack/feature'] });
    await flush();
    expect(received).toEqual([]);

    rootEvents.emitPackClientConnected('second-pack');
    await flush();
    expect(received).toEqual(['second-pack']);
  });

  it("reaches an activated pack without frontend code once, when it's activated", async () => {
    rootEvents.emitConnected();
    await flush();
    received.length = 0;
    registerPack(pack('second-pack'), loaded('second-pack', ['runtime/fe.css']));
    bus.send({ type: 'ACTIVATE_PACK', packId: 'second-pack', systemIds: ['second-pack/feature'] });
    await flush();
    expect(received).toEqual(['second-pack']);
  });

  it('holds back every system of a pack with frontend code until a client tried loading it', async () => {
    bus.stop();
    registerPack({
      id: 'external-pack',
      features: {
        feature: { system: { machine: recorder('with surface'), receives: ['CLIENT_CONNECTED'] } },
        background: { system: { machine: recorder('without surface'), receives: ['CLIENT_CONNECTED'] } },
      },
    }, loaded('external-pack', withFrontend, { feature: { description: 'Publish client state.', system: { entry: 'system.ts' } }, background: { description: 'Run background work.', system: { entry: 'background.ts' } } }));
    registerPack(pack('second-pack'), loaded('second-pack', withFrontend));
    bus = createActor(backendSystem, { systemId: 'host/bus' }).start();

    rootEvents.emitConnected();
    await flush();
    expect(received).toEqual(['first-pack']);

    // A client announces a pack whatever its frontend load added: surfaces, none, or nothing as it failed
    rootEvents.emitPackClientConnected('external-pack');
    rootEvents.emitPackClientConnected('second-pack');
    await flush();
    expect(received).toEqual(['first-pack', 'with surface', 'without surface', 'second-pack']);
  });

  it('reaches the new actors of a reloaded pack, not the stopped ones', async () => {
    rootEvents.emitConnected();
    await flush();
    received.length = 0;
    unregisterPack('first-pack');
    registerPack(pack('first-pack', 'first-pack (reloaded)'));
    bus.send({ type: 'RELOAD_PACK', packId: 'first-pack', systemIds: ['first-pack/feature'] });
    await flush();
    expect(received).toEqual(['first-pack (reloaded)']);
  });

  it("reaches only the running systems of a reloaded pack that dropped a feature", async () => {
    unregisterPack('first-pack');
    registerPack({
      id: 'first-pack',
      features: {
        feature: { system: { machine: recorder('feature'), receives: ['CLIENT_CONNECTED'] } },
        dropped: { system: { machine: recorder('dropped'), receives: ['CLIENT_CONNECTED'] } },
      },
    });
    bus.stop();
    bus = createActor(backendSystem, { systemId: 'host/bus' }).start();
    rootEvents.emitConnected();
    await flush();
    received.length = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    unregisterPack('first-pack');
    registerPack(pack('first-pack', 'feature (reloaded)'));
    bus.send({ type: 'RELOAD_PACK', packId: 'first-pack', systemIds: ['first-pack/feature', 'first-pack/dropped'] });
    await flush();

    expect(received).toEqual(['feature (reloaded)']);
    expect(bus.system.get('first-pack/dropped')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// untypedBroadcastToSurface goes through the bus, as a system's emit does: nothing reaches a client before one connects
describe('untypedBroadcastToSurface on the bus', () => {
  // The surface's own pack declares what it receives, as in the app: a send to a surface no pack owns is
  // dropped, which is the check's job and not what this test is about
  beforeEach(() => {
    registerPack({
      id: 'notes-pack',
      features: { notes: { surface: { receives: ['BEFORE_CONNECT', 'AFTER_CONNECT'] } } },
    });
  });

  it('reaches clients only once one has connected', async () => {
    const outgoing: Message[] = [];
    const stop = rootEvents.onOutgoing((message) => { outgoing.push(message); });
    try {
      untypedBroadcastToSurface('notes-pack/notes', { type: 'BEFORE_CONNECT' });
      await flush();
      expect(outgoing).toEqual([]);

      rootEvents.emitConnected();
      await flush();
      untypedBroadcastToSurface('notes-pack/notes', { type: 'AFTER_CONNECT' });
      await flush();
      expect(outgoing.filter(({ event }) => event.type !== 'CLIENT_CONNECTED')).toEqual([{ to: 'notes-pack/notes', call: expect.any(String), event: { type: 'AFTER_CONNECT' } }]);
    } finally {
      stop();
    }
  });
});

describe('a bus given a subset of the registered systems', () => {
  let subsetBus: AnyActorRef;
  let connect: () => void;
  let packConnect: (packId: string) => void;

  beforeEach(() => {
    registerPack({
      id: 'second-pack',
      features: {
        feature: { system: { machine: recorder('second-pack'), receives: ['CLIENT_CONNECTED'] } },
        outside: { system: { machine: recorder('outside'), receives: ['CLIENT_CONNECTED'] } },
      },
    });
    const subset = new Map([['second-pack/feature', recorder('second-pack')]]);
    bus.stop();
    subsetBus = createActor(createBusMachine({
      registry,
      systems: () => subset,
      onOutgoing: () => {},
      listen: (send) => {
        connect = () => send({ type: 'CLIENT_CONNECTED' });
        packConnect = (packId) => send({ type: 'PACK_CLIENT_CONNECTED', packId });
        return () => {};
      },
    }), { systemId: 'host/bus' }).start();
    connect();
    received.length = 0;
  });

  afterEach(() => subsetBus.stop());

  it("sends a pack's CLIENT_CONNECTED only to the pack's systems it runs", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    packConnect('second-pack');
    await flush();
    expect(received).toEqual(['second-pack']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('activates and reloads only the systems it runs', async () => {
    subsetBus.send({ type: 'RELOAD_PACK', packId: 'second-pack', systemIds: ['second-pack/feature', 'second-pack/outside'] });
    await flush();
    expect(received).toEqual(['second-pack']);
    expect(subsetBus.system.get('second-pack/outside')).toBeUndefined();

    subsetBus.send({ type: 'TEARDOWN_PACK', systemIds: ['second-pack/feature'] });
    subsetBus.send({ type: 'ACTIVATE_PACK', packId: 'second-pack', systemIds: ['second-pack/feature', 'second-pack/outside'] });
    await flush();
    expect(subsetBus.system.get('second-pack/feature')).toBeDefined();
    expect(subsetBus.system.get('second-pack/outside')).toBeUndefined();
  });
});

// A pack installed, updated or rebuilt while the app runs content its data then; systems already running
// read what it written (the chat's slash commands, say), so the bus tells them all
describe('PACK_CHANGED on the bus', () => {
  it('reaches every running system, whichever pack changed', async () => {
    registerPack(pack('second-pack'));
    bus.send({ type: 'ACTIVATE_PACK', packId: 'second-pack', systemIds: ['second-pack/feature'] });
    rootEvents.emitConnected();
    await flush();
    received.length = 0;

    bus.send({ type: 'PACK_CHANGED', packId: 'second-pack' });
    await flush();

    expect(received).toEqual(['first-pack: changed second-pack', 'second-pack: changed second-pack']);
  });

  it("reaches the systems of a pack changed before any client connected, without a warning for one that isn't running", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPack(pack('second-pack'));

    bus.send({ type: 'PACK_CHANGED', packId: 'second-pack' });
    await flush();

    expect(received).toEqual(['first-pack: changed second-pack']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// A pack can be installed, uninstalled or rebuilt before a client ever connects: `apack pack dev` against a
// running backend, or a headless boot. The bus has to act on those either way.
describe('pack lifecycle before a client connects', () => {
  const systemIds = ['second-pack/feature'];
  const isRunning = (systemId: string) => bus.system.get(systemId) !== undefined;

  it('starts an activated pack’s systems, and sends their startup data once a client connects', async () => {
    registerPack(pack('second-pack'));

    bus.send({ type: 'ACTIVATE_PACK', packId: 'second-pack', systemIds });
    await flush();
    expect(isRunning('second-pack/feature'), 'the activated pack’s system is running').toBe(true);
    // No client yet, so nothing has been told to send startup data
    expect(received).toEqual([]);

    rootEvents.emitConnected();
    await flush();
    expect(received).toEqual(['first-pack', 'second-pack']);
  });

  it('stops a torn-down pack’s systems', async () => {
    // first-pack's system is spawned when the bus starts, so it is genuinely running to begin with
    expect(isRunning('first-pack/feature')).toBe(true);

    bus.send({ type: 'TEARDOWN_PACK', systemIds: ['first-pack/feature'] });
    await flush();
    expect(isRunning('first-pack/feature')).toBe(false);
  });

  it('restarts a reloaded pack’s systems', async () => {
    const before = bus.system.get('first-pack/feature');
    expect(before).toBeDefined();

    bus.send({ type: 'RELOAD_PACK', packId: 'first-pack', systemIds: ['first-pack/feature'] });
    await flush();
    // A fresh actor under the same id, not the one that was already running
    const after = bus.system.get('first-pack/feature');
    expect(after, 'the reloaded pack’s system is running again').toBeDefined();
    expect(after, 'it is a fresh actor, so the pack really was restarted').not.toBe(before);
    // Still no client: the fresh systems get their startup data from the first connection
    expect(received).toEqual([]);

    rootEvents.emitConnected();
    await flush();
    expect(received).toEqual(['first-pack']);
  });
});


it('waits for frontend readiness before requesting state from a reloaded frontend-bearing pack', async () => {
  const publishing = (label: string) => ({ id: 'first-pack', features: { feature: { system: {
    machine: setup({}).createMachine({ on: {
      CLIENT_CONNECTED: { actions: () => received.push(`${label}: connected`) },
      SEND_STATE: { actions: () => received.push(`${label}: state`) },
      PACK_CHANGED: { actions: () => received.push(`${label}: changed`) },
    } }), receives: ['CLIENT_CONNECTED'],
  } } } });
  unregisterPack('first-pack');
  const origin = loaded('first-pack', withFrontend);
  registerPack(publishing('initial'), origin);
  bus.stop();
  bus = createActor(backendSystem, { systemId: 'host/bus' }).start();
  rootEvents.emitConnected();
  await flush();
  expect(received).toEqual([]);
  rootEvents.emitPackClientConnected('first-pack');
  await flush();
  expect(received).toEqual(['initial: connected', 'initial: state']);
  received.length = 0;
  unregisterPack('first-pack');
  registerPack(publishing('replacement'), origin);
  bus.send({ type: 'RELOAD_PACK', packId: 'first-pack', systemIds: ['first-pack/feature'] });
  bus.send({ type: 'PACK_CHANGED', packId: 'first-pack' });
  bus.send({ type: 'DATA_REPLACED' });
  await flush();
  expect(received).toEqual(['replacement: changed']);
  rootEvents.emitPackClientConnected('first-pack');
  await flush();
  expect(received).toEqual(['replacement: changed', 'replacement: connected', 'replacement: state']);
});
