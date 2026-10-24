// When a claimed name is given back.
//
// A name claimed on a connection has to be released by something, and which something is the whole content of
// this file. It was the subscription's teardown first, which is wrong twice over: a client that stopped
// subscribing but kept its socket lost a name it was still using, and a client that claimed without ever
// subscribing kept the name until the API process exited — so the next drive session was refused with nothing
// left for its user to close.
//
// The connection ending is the only event that means the claimer is gone, and the adapter gives it to
// `createRpcContext` as an abort signal (it aborts from `client.once('close')`, verified in
// `node_modules/@trpc/server/dist/ws-*.mjs`). These cases pin that, because the failure is invisible: a leaked
// claim looks like nothing at all until the session after next.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createParticipantClaims } from '@apackdev/host/bus';

const claims = createParticipantClaims();
vi.mock('@apackdev/host/bus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apackdev/host/bus')>();
  return { ...actual, receiveClientEvent: () => {} };
});
vi.mock('../../src/runtime/index.ts', () => ({ appStore: undefined, appPacks: {}, appClaims: claims }));
vi.mock('../../src/transport/emitter.ts', () => ({ rootEvents: { onOutgoing: () => () => {}, emitConnected: () => {}, emitPackClientConnected: () => {} } }));

const { systemBusRouter } = await import('../../src/transport/bus.ts');

/** Every connection a case opened, so each case cleans up only what it made */
const opened: string[] = [];

/** A connection, with the end of it in the caller's hands */
function connection(client: string) {
  opened.push(client);
  const ending = new AbortController();
  return { caller: systemBusRouter.createCaller({ client, closed: ending.signal }), end: () => ending.abort() };
}

// The registry is shared across cases because the mock is hoisted, so a case that claimed and never ended its
// connection would leak the name into the next one. Releasing by what this file opened keeps that local, and
// needs nothing from the registry that production does not already use.
afterEach(() => {
  for (const client of opened.splice(0, opened.length)) claims.release(client);
});

describe('a claimed name', () => {
  it('is held by the connection that claimed it', async () => {
    const driver = connection('c-driver');
    await driver.caller.claim({ as: 'host/drive' });

    expect(claims.clientFor('host/drive')).toBe('c-driver');
  });

  // The leak: claiming without subscribing used to hold the name until the API process exited
  it('is given back when the connection ends, even if it never subscribed', async () => {
    const driver = connection('c-driver');
    await driver.caller.claim({ as: 'host/drive' });

    driver.end();

    expect(claims.clientFor('host/drive'), 'free for the next session').toBeUndefined();
  });

  it('is then claimable by the next connection', async () => {
    const first = connection('c-first');
    await first.caller.claim({ as: 'host/drive' });
    first.end();

    const second = connection('c-second');
    await expect(second.caller.claim({ as: 'host/drive' })).resolves.toBeUndefined();
    expect(claims.clientFor('host/drive')).toBe('c-second');
  });

  // Two drivers really running is a mistake worth surfacing, so it is refused rather than taken over
  it('is refused while another live connection holds it', async () => {
    await connection('c-first').caller.claim({ as: 'host/drive' });

    await expect(connection('c-second').caller.claim({ as: 'host/drive' }))
      .rejects.toThrow(/already claimed by another connection/);
    expect(claims.clientFor('host/drive'), 'and the holder keeps it').toBe('c-first');
  });

  it('refuses a name that is not a participant ref', async () => {
    await expect(connection('c-driver').caller.claim({ as: 'drive' }))
      .rejects.toThrow(/doesn't name a participant/);
  });
});
