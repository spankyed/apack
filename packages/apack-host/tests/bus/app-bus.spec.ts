import { createNativePackTestRegistry } from '@apackdev/host/testing';
// The app's bus on the SDK's bound root event bus (the test host's here): a connecting client reaches the
// registered systems, except those of a loaded pack with frontend code, which wait for the client to load it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { startTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import type { Message } from '@apackdev/sdk/events';
import { createAppBus, type BackendBus } from '../../src/bus/index.ts';
import { appState, HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { hostRegistration } from '../../src/features/registration.ts';

const registry = createNativePackTestRegistry();
const { registerPack, unregisterPack } = registry;
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });
// The app's state, which the application surface's CLIENT_CONNECTED reports
appState.update({ hasOnboarded: true });

const received: string[] = [];

/** A system that records each CLIENT_CONNECTED it receives */
function recorder(label: string) {
  return state<{}, { type: 'CLIENT_CONNECTED' }>()({
    on: { CLIENT_CONNECTED: () => { received.push(label); } },
  });
}

function registerRecorderPack(id: string) {
  registerPack({ id, features: { feature: { system: { machine: recorder(id), receives: ['CLIENT_CONNECTED'] } } } });
}

let bus: BackendBus;
let packDir: string;
const outgoing: Message[] = [];
let stopOutgoing: () => void;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  received.length = 0;
  outgoing.length = 0;
  stopOutgoing = testRootEvents.onOutgoing((event) => { outgoing.push(event); });
  // The app's own surfaces, as the API registers them: the application surface gets the shell's state
  registerPack(hostRegistration());
  registerRecorderPack('local-pack');
  // fe-pack is a loaded external pack whose bundle has frontend code
  packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-bus-'));
  fs.mkdirSync(path.join(packDir, 'runtime'));
  fs.writeFileSync(path.join(packDir, 'runtime', 'fe.js'), '');
  registry.registerPack({ id: 'fe-pack', features: { feature: { system: { machine: recorder('fe-pack'), receives: ['CLIENT_CONNECTED'] } } } }, { declarationRevision: 'fixture-revision',
    buildRevision: 'a'.repeat(64), buildFiles: { 'runtime/fe.js': 'b'.repeat(64) },
    eventContracts: { feature: { system: { incoming: [], outgoing: [] } } },
    id: 'fe-pack', name: 'fe-pack', version: '1.0.0', dir: packDir,
    manifest: { id: 'fe-pack', name: 'fe-pack', version: '1.0.0', features: { feature: { description: 'Feature declaration fixture.', system: { entry: 'system.ts' } } } },
  });
  bus = createAppBus(registry).start();
});

afterEach(() => {
  bus.stop();
  stopOutgoing();
  for (const id of ['local-pack', 'fe-pack']) unregisterPack(id);
  unregisterPack('host');
  fs.rmSync(packDir, { recursive: true, force: true });
});

describe('createAppBus', () => {
  // The window opens with the shell's state: which surfaces' tabs show and the surface the user last had open
  it("tells the application surface, on each connection, the tabs' visibility and the surface last open", async () => {
    appState.update({ surfaceVisibility: { 'local-pack/feature': false }, lastActiveSurface: 'local-pack/feature' });

    testRootEvents.emitConnected();
    await flush();

    expect(outgoing).toContainEqual({
      to: 'host/application',
      event: { type: 'CLIENT_CONNECTED', hasOnboarded: true, surfaceVisibility: { 'local-pack/feature': false }, lastActiveSurface: 'local-pack/feature' },
    });
  });

  it("reaches the registered systems when a client connects, and a frontend pack's once the client loaded it", async () => {
    testRootEvents.emitConnected();
    await flush();
    expect(received).toEqual(['local-pack']);
    expect(outgoing).toContainEqual({ to: 'host/application', event: expect.objectContaining({ type: 'CLIENT_CONNECTED', hasOnboarded: true }) });

    testRootEvents.emitPackClientConnected('fe-pack');
    await flush();
    expect(received).toEqual(['local-pack', 'fe-pack']);
  });

  it('routes a client event to the system it names', async () => {
    const pings: string[] = [];
    registerPack({
      id: 'ping-pack',
      features: {
        feature: {
          system: { machine: state<{}, { type: 'PING' }>()({ on: { PING: () => { pings.push('ping'); } } }), receives: ['PING'] },
          // The bus drops a send to a surface that declares no such event, so this case declares the two it sends
          surface: { receives: ['EARLY', 'LATE'] },
        },
      },
    });
    try {
      bus.stop();
      bus = createAppBus(registry).start();
      testRootEvents.emitConnected();
      testRootEvents.emitIncoming({ to: 'ping-pack/feature', event: { type: 'PING' } });
      await flush();
      expect(pings).toEqual(['ping']);
    } finally {
      unregisterPack('ping-pack');
    }
  });

  it('routes events to systems before any client connects, and holds back sends to surfaces until one does', async () => {
    const pings: string[] = [];
    registerPack({
      id: 'ping-pack',
      features: {
        feature: {
          system: { machine: state<{}, { type: 'PING' }>()({ on: { PING: () => { pings.push('ping'); } } }), receives: ['PING'] },
          // The bus drops a send to a surface that declares no such event, so this case declares the two it sends
          surface: { receives: ['EARLY', 'LATE'] },
        },
      },
    });
    try {
      bus.stop();
      bus = createAppBus(registry).start();
      // A schedule tick or a `fire` step at boot, with no window open yet
      testRootEvents.emitIncoming({ to: 'ping-pack/feature', event: { type: 'PING' } });
      testRootEvents.emitSurfaceSend({ to: 'ping-pack/feature', event: { type: 'EARLY' } });
      await flush();
      expect(pings).toEqual(['ping']);
      expect(outgoing).toEqual([]);

      testRootEvents.emitConnected();
      testRootEvents.emitSurfaceSend({ to: 'ping-pack/feature', event: { type: 'LATE' } });
      await flush();
      expect(outgoing.map(({ event }) => event.type)).toContain('LATE');
      expect(outgoing.map(({ event }) => event.type)).not.toContain('EARLY');
    } finally {
      unregisterPack('ping-pack');
    }
  });
});
