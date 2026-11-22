import { createNativePackTestRegistry } from '@apackdev/host/testing';
// Being addressable without a pack having registered you.
//
// A system and a surface are addressable because a pack declared them; the bus checks every outgoing message
// against what the target surface says it receives, and drops one nothing declares. A driver is declared by
// nobody, which is why an agent could send to the app and the app could not send back — the gap this closes.
//
// A claimed name takes the same grammar as a feature ref, so nothing that reads a ref had to be taught about it.
// What it does not take is a declared event list: no pack describes a driver, so there is nothing to validate
// against and whatever it is sent reaches it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, type AnyActorRef } from 'xstate';
import { startTestRuntime, takeSystemErrors, testRootEvents } from '@apackdev/sdk/testing';
import { untypedBroadcast, type Message } from '@apackdev/sdk/events';
import { onLog } from '@apackdev/sdk/logger';
import { createAppBus } from '../../src/bus/index.ts';
import { createParticipantClaims } from '../../src/bus/participants.ts';
import { HOST } from '../../src/refs.ts';
import { HOST_ENTITY_TYPES } from '../../src/app-state/index.ts';
import { hostRegistration } from '../../src/features/registration.ts';

const registry = createNativePackTestRegistry();
startTestRuntime({ entityTypes: HOST_ENTITY_TYPES, packs: registry });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a name a connection claimed', () => {
  let bus: AnyActorRef;
  let claims: ReturnType<typeof createParticipantClaims>;
  const outgoing: Message[] = [];
  let stopOutgoing: () => void;
  const logged: string[] = [];
  let stopLog: () => void;

  const toDrive = () => outgoing.filter(({ to }) => to === HOST.drive);

  beforeEach(async () => {
    outgoing.length = 0;
    logged.length = 0;
    claims = createParticipantClaims();
    stopOutgoing = testRootEvents.onOutgoing((message) => { outgoing.push(message); });
    stopLog = onLog((entry) => { logged.push(entry.message); });
    registry.registerPack(hostRegistration());
    bus = createActor(createAppBus(registry, claims), { systemId: 'host/bus' }).start();
    testRootEvents.emitConnected();
    await flush();
  });

  afterEach(() => {
    bus.stop();
    stopOutgoing();
    stopLog();
    registry.unregisterPack('host');
    takeSystemErrors();
  });

  it('is addressed to the connection holding it', async () => {
    claims.claim(HOST.drive, 'c-driver');

    untypedBroadcast(HOST.drive, { type: 'QX_RESULT', rows: 1 });
    await flush();

    expect(toDrive()).toHaveLength(1);
    expect(toDrive()[0].client, 'the driver, and no window').toBe('c-driver');
  });

  // The point of the whole phase: a driver is sent to by name, not merely replied to
  it('takes a send from a system that never asked it anything', async () => {
    claims.claim(HOST.drive, 'c-driver');

    untypedBroadcast(HOST.drive, { type: 'ANYTHING_AT_ALL' });
    await flush();

    expect(toDrive()[0].event.type, 'no declared event list to fail against').toBe('ANYTHING_AT_ALL');
  });

  // An answer already carries the connection it is for, and must not be re-addressed by the claim
  it('leaves an answer addressed to the connection that asked', async () => {
    claims.claim(HOST.drive, 'c-driver');

    bus.send({ type: 'OUTGOING', message: { to: HOST.drive, event: { type: 'QX_RESULT' }, client: 'c-someone-else' } });
    await flush();

    expect(toDrive()[0].client).toBe('c-someone-else');
  });

  it('is dropped, and said so, when nobody holds it', async () => {
    untypedBroadcast(HOST.drive, { type: 'QX_RESULT' });
    await flush();

    expect(toDrive(), 'an unclaimed name is not a broadcast').toHaveLength(0);
    expect(logged.join('\n')).toContain(HOST.drive);
  });
});

describe('claiming', () => {
  it('refuses a name another connection holds', () => {
    const claims = createParticipantClaims();

    expect(claims.claim(HOST.drive, 'c-first')).toEqual({ ok: true });
    expect(claims.claim(HOST.drive, 'c-second'), 'two drivers running is a mistake worth surfacing')
      .toEqual({ ok: false, heldBy: 'c-first' });
  });

  // Claiming again on the same connection is how a reconnecting driver behaves, and is not a collision
  it('lets one connection re-claim what it already holds', () => {
    const claims = createParticipantClaims();

    claims.claim(HOST.drive, 'c-first');
    expect(claims.claim(HOST.drive, 'c-first')).toEqual({ ok: true });
  });

  it('frees the name when the connection goes', () => {
    const claims = createParticipantClaims();

    claims.claim(HOST.drive, 'c-first');
    claims.release('c-first');

    expect(claims.clientFor(HOST.drive)).toBeUndefined();
    expect(claims.claim(HOST.drive, 'c-second'), 'the next drive session finds it free').toEqual({ ok: true });
  });

  // Releasing a connection that claimed nothing is the ordinary case: every window's subscription does it
  it('is safe to release a connection that claimed nothing', () => {
    const claims = createParticipantClaims();

    expect(() => claims.release('c-window')).not.toThrow();
  });
});
