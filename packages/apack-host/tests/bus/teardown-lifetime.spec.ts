import { afterEach, expect, it } from 'vitest';
import { state } from '@apackdev/state';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { startTestRuntime } from '@apackdev/sdk/testing';
import { createAppBus } from '../../src/bus/app.ts';
import { createBus, type BackendBus } from '../../src/bus/bus.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';

let bus: BackendBus | undefined;
afterEach(() => bus?.stop());

it('finishes state work and subscription cleanup before retiring runtime authority', () => {
  const registry = createNativePackTestRegistry();
  startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });
  const order: string[] = [];
  let retired = false;
  const read = () => { if (retired) throw new Error('Runtime authority retired before actor cleanup'); };
  const worker = state<{}, { type: 'STOP' }>()({
    run: ({ onExit }) => {
      onExit(() => {
        read();
        order.push('cleanup');
      });
    },
    on: {
      STOP: () => {
        bus!.send({ type: 'TEARDOWN_PACK', systemIds: ['worker/observer'], afterStop: () => { retired = true; order.push('retired'); } });
        read();
        order.push('current-action');
      },
    },
  });
  registry.registerPack({ id: 'worker', features: { observer: { system: { machine: worker, receives: ['STOP'] } } } });
  bus = createAppBus(registry).start();
  bus.getSystem('worker/observer')!.send({ type: 'STOP' });
  expect(order).toEqual(['current-action', 'cleanup', 'retired']);
  expect(bus.getSystem('worker/observer')).toBeUndefined();
});

it('drains messages queued before system shutdown before removing their declared inbox', () => {
  const registry = createNativePackTestRegistry();
  const order: string[] = [];
  const worker = state<{}, { type: 'STOP' }>()({
    run: ({ onExit }) => {
      onExit(() => {
        order.push('cleanup');
      });
    },
    on: {
      STOP: () => {
        bus!.send({ type: 'TEARDOWN_PACK', systemIds: ['worker/observer'], afterStop: () => {
          registry.unregisterPack('worker');
          order.push('retired');
        } });
        bus!.send({ type: 'OUTGOING', message: { to: 'worker/observer', event: { type: 'FINAL_STATE' } } });
      },
    },
  });
  registry.registerPack({ id: 'worker', features: { observer: {
    system: { machine: worker, receives: ['STOP'] }, surface: { receives: ['FINAL_STATE'] },
  } } });
  bus = createBus({ registry, listen: () => () => {},
    onOutgoing: () => { order.push('message'); },
  }).start();
  bus.send({ type: 'CLIENT_CONNECTED' });
  bus.send({ type: 'INCOMING', message: { to: 'worker/observer', event: { type: 'STOP' } } });
  expect(order).toEqual(['cleanup', 'message', 'retired']);
  expect(registry.getPackRegistration('worker')).toBeNull();
});
