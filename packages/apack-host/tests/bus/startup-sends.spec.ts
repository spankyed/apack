import { createNativePackTestRegistry } from '@apackdev/host/testing';
// A system sends as it starts — to another system, or its surface's first report — and the bus hears the root
// events before it starts any system, so nothing a system sends while starting is lost.
import { afterEach, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { untypedTell } from '@apackdev/sdk/events';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { createAppBus, type BackendBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const sender = state()({
  run: () => { untypedTell('boot-pack/receiver', { type: 'PING' }); },
});
const receiver = state<{ data: { pings: number } }, { type: 'PING' }>()({
  data: { pings: 0 },
  on: { PING: (_ev, { data }) => ({ data: { pings: data.pings + 1 } }) },
});

let bus: BackendBus | undefined;

afterEach(() => {
  bus?.stop();
  registry.unregisterPack('boot-pack');
});

it("delivers what a system sends as it starts to the system it's for", async () => {
  registry.registerPack({
    id: 'boot-pack',
    // The receiver starts first, so the send has somewhere to go once the bus hears it
    features: {
      receiver: { system: { machine: receiver, receives: ['PING'] } },
      sender: { system: { machine: sender, receives: [] } },
    },
  });
  bus = createAppBus(registry).start();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(bus.read('boot-pack/receiver')?.data.pings).toBe(1);
});
