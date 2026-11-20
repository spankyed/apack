// The `connection` fixture's verbs, over a fake client. The frames beneath them are `engine/api-client.spec.ts`'s
// subject, against a real tRPC server; what is asked here is what the fixture adds on top: the claim, which answer
// an ask takes, what `next` counts as after it, and that a wait ends with the connection.
import { describe, expect, it } from 'vitest';
import { HOST } from '@apackdev/host/bus';
import { withClaim } from '../src/connection.ts';
import type { ApiClient, BusMessage } from '../src/engine/api-client.ts';

type Sent = Parameters<ApiClient['send']>[0];

/** A client that records what it was asked, and delivers what a case hands it */
function fakeApi(options: { refuse?: (message: Sent) => string | undefined } = {}) {
  const sent: Sent[] = [];
  const claimed: string[] = [];
  const order: string[] = [];
  const listeners = new Set<(message: BusMessage) => void>();
  const finishListeners = new Set<(reason: string) => void>();
  let failure: string | null = null;
  const api: ApiClient = {
    claim: async (ref) => { order.push('claim'); claimed.push(ref); },
    send: async (message) => {
      const refused = options.refuse?.(message);
      if (refused) throw new Error(refused);
      sent.push(message);
    },
    sendSettings: async () => { throw new Error('not used by the connection'); },
    loadedPacks: async () => [],
    openPackSettings: async () => 'access',
    onMessage: (listener) => { order.push('listen'); listeners.add(listener); return () => listeners.delete(listener); },
    onFinished: (listener) => { finishListeners.add(listener); return () => finishListeners.delete(listener); },
    get failure() { return failure; },
    close: async () => {},
  };
  return {
    api, sent, claimed, order,
    deliver: (message: BusMessage) => { for (const listener of listeners) listener(message); },
    finish: (reason: string) => { failure = reason; for (const listener of finishListeners) listener(reason); },
    /** Waits still listening for the connection to end; each wait holds one until it settles */
    waiting: () => finishListeners.size,
  };
}

const resolve = (name: string) => (name.includes('/') ? name : `e2e-fixture/${name}`);
/** Lets a send the connection awaited reach the fake before a case answers it */
const flush = async () => { for (let index = 0; index < 4; index++) await Promise.resolve(); };

it('claims its own name, listening first so nothing addressed to it arrives unheard', async () => {
  const fake = fakeApi();
  const connection = await withClaim(fake.api, { resolve });
  expect(fake.claimed).toEqual([HOST.e2eConnection]);
  expect(fake.order).toEqual(['listen', 'claim']);
  expect(connection.name).toBe(HOST.e2eConnection);
});

describe('ask', () => {
  it('takes the answer to its own call, whichever order answers arrive in and whatever else arrives', async () => {
    const fake = fakeApi();
    const connection = await withClaim(fake.api, { resolve });
    const first = connection.ask('memos', { type: 'GET', id: 1 });
    const second = connection.ask('host/settings', { type: 'GET', id: 2 }, { settingsCredential: 'access' });
    await flush();
    const [one, two] = fake.sent;
    expect(one).toMatchObject({ to: 'e2e-fixture/memos', sender: HOST.e2eConnection, event: { id: 1 } });
    expect(one).not.toHaveProperty('settingsCredential');
    expect(two).toMatchObject({ to: 'host/settings', sender: HOST.e2eConnection, settingsCredential: 'access' });
    expect(one.call).toBeTruthy();
    expect(two.call).not.toBe(one.call);

    fake.deliver({ to: 'e2e-fixture/memos', event: { type: 'GOT', of: 'a broadcast' } });
    fake.deliver({ to: HOST.e2eConnection, answering: two.call, event: { type: 'GOT', of: 2 } });
    fake.deliver({ to: HOST.e2eConnection, answering: one.call, event: { type: 'GOT', of: 1 } });
    expect(await first).toEqual({ type: 'GOT', of: 1 });
    expect(await second).toEqual({ type: 'GOT', of: 2 });
    expect(fake.waiting()).toBe(0);
  });

  it('rejects with the refusal of a send the API refuses, and stops waiting for its answer', async () => {
    const fake = fakeApi({ refuse: () => 'sending UPDATE_SETTINGS to host/settings: Settings access is unavailable (FORBIDDEN)' });
    const connection = await withClaim(fake.api, { resolve });
    await expect(connection.ask('host/settings', { type: 'UPDATE_SETTINGS' }, { settingsCredential: 'stale' }))
      .rejects.toThrow('Settings access is unavailable');
    expect(fake.waiting()).toBe(0);
  });

  it('fails a waiting ask with why the connection ended, and a later one at once', async () => {
    const fake = fakeApi();
    const connection = await withClaim(fake.api, { resolve });
    const waiting = connection.ask('memos', { type: 'GET' });
    await flush();
    fake.finish('the connection to the app closed');
    await expect(waiting).rejects.toThrow('e2e-fixture/memos, asked GET,: the connection to the app closed');
    await expect(connection.ask('memos', { type: 'GET' })).rejects.toThrow('the connection to the app closed');
  });
});

describe('next', () => {
  it('counts only what arrives after it was asked for, and keeps everything in messages', async () => {
    const fake = fakeApi();
    const connection = await withClaim(fake.api, { resolve });
    const done = { to: 'host/packs', event: { type: 'PACK_INSTALL_COMPLETE', packId: 'a' } };
    fake.deliver(done);
    const outcome = connection.next((event) => event.type === 'PACK_INSTALL_COMPLETE', 'the install of b');
    fake.deliver({ to: 'host/packs', event: { type: 'PACK_INSTALL_STARTED', packId: 'b' } });
    fake.deliver({ ...done, event: { ...done.event, packId: 'b' } });
    expect(await outcome).toEqual({ type: 'PACK_INSTALL_COMPLETE', packId: 'b' });
    expect(connection.messages.map((message) => message.event.packId)).toEqual(['a', 'b', 'b']);
  });

  it('names what it waited for when the connection ends first', async () => {
    const fake = fakeApi();
    const connection = await withClaim(fake.api, { resolve });
    const outcome = connection.next(() => false, 'the install of b');
    fake.finish('the app ended the event subscription');
    await expect(outcome).rejects.toThrow('the install of b: the app ended the event subscription');
  });
});
