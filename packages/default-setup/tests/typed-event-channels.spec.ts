// Compile-time checks, run by `vue-tsc` (npm run typecheck:pack). Exact type equality and expected
// errors fail if the generated events regress to `any` or accept a wrong event.
import { resolveName } from '@apackdev/sdk/ids';
import { untypedOpenSurface } from '@apackdev/sdk/fe';
import { describe, expectTypeOf, it } from 'vitest';
import type { HostSurfaceEvents } from '@apackdev/sdk/events';
import type { ApplicationHotkeys } from '@apackdev/sdk/types';
import type { EARS } from '#generated/ears.ts';
import type { Services } from '#generated/services.ts';
import type { SurfaceInboxOf } from '@apackdev/sdk/events';
import { broadcastToSurface, sendToSystem, type SendableSurfaceEvents } from '#generated/events.ts';
import { openSurface } from '#generated/fe.ts';
import type { OutgoingActionEvents } from '#features/actions/be/types.ts';
import type { OutgoingFlowsEvents } from '#features/flows/be/types.ts';
import type { OutgoingThreadsEvents } from '#features/threads/be/types.ts';
import type { Contract as ThreadsContract } from '#features/threads/fe/contract.ts';
import type { Contract as FlowsContract } from '#features/flows/fe/contract.ts';

// The inbox each surface's contract declares, as codegen reads it
type ThreadsAccepts = SurfaceInboxOf<ThreadsContract>;
type FlowsAccepts = SurfaceInboxOf<FlowsContract>;

declare const actionEvent: OutgoingActionEvents;
declare const hotkeys: ApplicationHotkeys;
// What a content action receives
declare const services: Services;

describe('SendableSurfaceEvents', () => {
  it('maps each surface to exactly the events it receives', () => {
    // A surface receives its own feature's system's events, plus the inbox its `Contract` declares
    expectTypeOf<SendableSurfaceEvents['threads']>().toEqualTypeOf<OutgoingThreadsEvents | ThreadsAccepts>();
    expectTypeOf<SendableSurfaceEvents['flows']>().toEqualTypeOf<OutgoingFlowsEvents | FlowsAccepts>();
    expectTypeOf<SendableSurfaceEvents['host/application']>().toEqualTypeOf<HostSurfaceEvents['host/application']>();
  });

  it('has no entry for a surface nothing sends to', () => {
    // @ts-expect-error not a surface of this pack, its dependencies or the host
    expectTypeOf<SendableSurfaceEvents['unknown-surface']>().toBeNever();
  });
});

describe('broadcastToSurface', () => {
  // Wrapped in functions that never run: only their types are checked
  it('accepts an event the surface receives', () => {
    expectTypeOf(() => {
      broadcastToSurface('threads', { type: 'THREAD_CREATED', id: 't1' as EARS.EntityId, shortCode: 'T1', entityType: 'Thread' as EARS.Entity, timestamp: 0 });
      broadcastToSurface('flows', { type: 'FLOW.SELECT', flowId: 'Flow-1' as EARS.EntityId });
      broadcastToSurface('host/application', { type: 'APPLICATION_HOTKEYS', hotkeys });
      broadcastToSurface('host/application', { type: 'SURFACE_VISIBILITY_UPDATED', surfaceVisibility: { 'default-setup/notes': false } });
    }).toBeFunction();
  });

  it('rejects an event the surface does not receive', () => {
    expectTypeOf(() => {
      // @ts-expect-error the threads surface doesn't receive action events
      broadcastToSurface('threads', actionEvent);
      // @ts-expect-error not an application event
      broadcastToSurface('host/application', { type: 'SETTINGS_LOADED' });
      // @ts-expect-error unknown surface
      broadcastToSurface('unknown-surface', { type: 'ANYTHING' });
    }).toBeFunction();
  });
});

describe('sendToSystem', () => {
  // Wrapped in functions that never run: only their types are checked
  it('accepts an event the system receives', () => {
    expectTypeOf(() => {
      sendToSystem('notes', { type: 'DELETE_NOTE', id: 'Note-1' });
      // System to system, as a backend system sends another: the same typed send
      sendToSystem('brain', { type: 'TRIGGER_BRAIN_EVENT', eventType: 'thread.fork' });
      sendToSystem('threads', { type: 'REFRESH_THREADS' });
      // A role reaches whichever system plays it
      sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'thread.fork' });
      // The host's systems, by ref
      sendToSystem('host/bus', { type: 'PACK_CHANGED', packId: 'default-setup' });
    }).toBeFunction();
  });

  it('rejects an unknown system, an unknown event type, a missing field and a union system or type', () => {
    expectTypeOf((systemId: 'notes' | 'settings', brainIsDead: boolean) => {
      // @ts-expect-error not a system of this pack or its dependencies
      sendToSystem('unknown-system', { type: 'GET_SETTINGS' });
      // @ts-expect-error the settings system doesn't receive this event
      sendToSystem('settings', { type: 'DELETE_NOTE', id: 'Note-1' });
      // @ts-expect-error the brain doesn't receive what threads does, so a system can't send it one
      sendToSystem('brain', { type: 'REFRESH_THREADS' });
      // @ts-expect-error DELETE_NOTE needs an id
      sendToSystem('notes', { type: 'DELETE_NOTE' });
      // @ts-expect-error one system per send
      sendToSystem(systemId, { type: 'GET_SETTINGS' });
      // @ts-expect-error one event type per send
      sendToSystem('brain', { type: brainIsDead ? 'START_BRAIN' : 'RESTART_BRAIN' });
      // @ts-expect-error the bus receives only PACK_CHANGED from pack code
      sendToSystem('host/bus', { type: 'CLIENT_CONNECTED' });
    }).toBeFunction();
  });
});

describe('services.emitter in actions', () => {
  // Wrapped in functions that never run: only their types are checked
  it('accepts an event the surface or system receives', () => {
    expectTypeOf(() => {
      services.emitter.broadcastToSurface('default-setup/database', { type: 'AI_QUERY_LOADING' });
      services.emitter.sendToSystem('default-setup/notes', { type: 'DELETE_NOTE', id: 'Note-1' });
      services.emitter.sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'user.message' });
    }).toBeFunction();
  });

  it('rejects an event the surface or system does not receive', () => {
    expectTypeOf(() => {
      // @ts-expect-error the database surface doesn't receive this event
      services.emitter.broadcastToSurface('default-setup/database', { type: 'SET_PHASE', phase: 'Edit' });
      // @ts-expect-error unknown surface
      services.emitter.broadcastToSurface('unknown-surface', { type: 'ANYTHING' });
      // @ts-expect-error actions name every pack surface <pack>/<feature>, this pack's own too
      services.emitter.broadcastToSurface('database', { type: 'AI_QUERY_LOADING' });
      // @ts-expect-error DELETE_NOTE needs an id
      services.emitter.sendToSystem('default-setup/notes', { type: 'DELETE_NOTE' });
      // @ts-expect-error actions name every system <pack>/<feature>
      services.emitter.sendToSystem('notes', { type: 'DELETE_NOTE', id: 'Note-1' });
    }).toBeFunction();
  });
});

describe('openSurface', () => {
  // Wrapped in functions that never run: only their types are checked
  it("takes this pack's surfaces by feature id, and nothing it can't name", () => {
    expectTypeOf(() => {
      openSurface('notes');
      untypedOpenSurface(resolveName('settings', 'host'), { type: 'TAB.SELECT', tab: 'features' });
      // @ts-expect-error a misspelled ref names no surface
      openSurface('default-setp/notes');
      // @ts-expect-error nor does a misspelled feature id
      openSurface('noets');
      // @ts-expect-error a surface named by data opens through untypedOpenSurface, which checks it at run time
      openSurface('whatever.anything');
    }).toBeFunction();
  });
});
