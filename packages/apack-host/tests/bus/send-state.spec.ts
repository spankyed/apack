import { createNativePackTestRegistry } from '@apackdev/host/testing';
// Asking a system to publish what it holds — the one thing every cause on this bus comes down to.
//
// A client connecting, a pack changing and the data being replaced are three facts with one consequence:
// every system says what it holds now. That consequence has a name of its own (`SEND_STATE`), so a system
// wires it once instead of once per cause, and a fact is left for what publishing cannot fix.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createActor, setup, type AnyActorRef } from 'xstate';
import { untypedSendToSystem } from '@apackdev/sdk/events';
import { startTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import { createAppBus } from '../../src/bus/index.ts';
import { HOST } from '../../src/refs.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const seen: Record<string, string[]> = {};
const typesSeen: Array<readonly string[] | undefined> = [];

/** A system whose whole behaviour is recording the events it declares, in the order they arrive */
const records = (feature: string, ...types: string[]) => setup({}).createMachine({
  on: Object.fromEntries(types.map((type) => [type, { actions: ({ event }: { event: { types?: readonly string[] } }) => {
    seen[feature].push(type);
    if (type === 'DATA_CHANGED_ELSEWHERE') typesSeen.push(event.types);
  } }])),
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let bus: AnyActorRef | undefined;

beforeEach(async () => {
  seen.watcher = [];
  seen.quiet = [];
  typesSeen.length = 0;
  registry.registerPack({
    id: 'data-pack',
    features: {
      // One system with something to tear down, and one with nothing. The second is the case that matters:
      // it is every system that never thought about any of this, and it must stay correct anyway
      watcher: { system: { machine: records('watcher', 'SEND_STATE', 'DATA_REPLACED', 'DATA_CHANGED_ELSEWHERE', 'CLIENT_CONNECTED'), receives: [] } },
      quiet: { system: { machine: records('quiet', 'SEND_STATE'), receives: [] } },
    },
  });
  bus = createActor(createAppBus(registry), { systemId: HOST.bus }).start();
  await settle();
});

afterEach(() => {
  bus?.stop();
  registry.unregisterPack('data-pack');
});

/** A client connecting, which is what makes the bus start asking systems to publish */
const connect = async () => {
  testRootEvents.emitConnected();
  await settle();
};

it('asks every system to publish when a client connects, and tells them one did', async () => {
  await connect();

  expect(seen.watcher).toEqual(['CLIENT_CONNECTED', 'SEND_STATE']);
  expect(seen.quiet, 'a system that only publishes needs no fact at all').toEqual(['SEND_STATE']);
});

it('tells every system the data was replaced, then asks each to publish', async () => {
  await connect();
  seen.watcher = [];
  seen.quiet = [];

  untypedSendToSystem(HOST.bus, { type: 'DATA_REPLACED' });
  await settle();

  // Told before being asked, so work held over rows that are gone is dropped before the system describes itself
  expect(seen.watcher).toEqual(['DATA_REPLACED', 'SEND_STATE']);
  expect(seen.quiet, 'and a system that declares no fact is refreshed anyway').toEqual(['SEND_STATE']);
});

it('tells every system another process changed the data, as that and not as a replacement, then asks each to publish', async () => {
  await connect();
  seen.watcher = [];
  seen.quiet = [];

  untypedSendToSystem(HOST.bus, { type: 'DATA_CHANGED_ELSEWHERE', types: ['Note'] });
  await settle();

  expect(seen.watcher).toEqual(['DATA_CHANGED_ELSEWHERE', 'SEND_STATE']);
  expect(seen.quiet).toEqual(['SEND_STATE']);
});

it('hands on which types another process changed', async () => {
  await connect();
  untypedSendToSystem(HOST.bus, { type: 'DATA_CHANGED_ELSEWHERE', types: ['Note'] });
  await settle();
  expect(seen.watcher).toContain('DATA_CHANGED_ELSEWHERE');
  expect(typesSeen).toEqual([['Note']]);
});

it('asks nobody to publish before a client has connected, and catches them up when one does', async () => {
  untypedSendToSystem(HOST.bus, { type: 'DATA_REPLACED' });
  await settle();

  // The fact still lands — a system holding work over rows that are gone must drop it whether or not anyone
  // is watching — but publishing to nobody is work with no audience
  expect(seen.watcher).toEqual(['DATA_REPLACED']);
  expect(seen.quiet, 'nothing to publish to').toEqual([]);

  await connect();

  expect(seen.quiet, 'the first connection asks everyone, so nothing is missed').toEqual(['SEND_STATE']);
});
