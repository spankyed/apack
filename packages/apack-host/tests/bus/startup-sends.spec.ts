import { createNativePackTestRegistry } from '@apackdev/host/testing';
// A system sends as it starts — to another system, or its surface's first report — and the bus hears the root
// events before it starts any system, so nothing a system sends while starting is lost.
import { afterEach, expect, it } from 'vitest';
import { assign, createActor, setup, type AnyActorRef } from 'xstate';
import { untypedTell } from '@apackdev/sdk/events';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { createAppBus } from '../../src/bus/index.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const sender = setup({}).createMachine({ entry: () => untypedTell('boot-pack/receiver', { type: 'PING' }) });
const receiver = setup({ types: { context: {} as { pings: number } } }).createMachine({
  context: { pings: 0 },
  on: { PING: { actions: assign({ pings: ({ context }) => context.pings + 1 }) } },
});

let bus: AnyActorRef | undefined;

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
  bus = createActor(createAppBus(registry), { systemId: 'host/bus' }).start();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(bus.system.get('boot-pack/receiver').getSnapshot().context.pings).toBe(1);
});
