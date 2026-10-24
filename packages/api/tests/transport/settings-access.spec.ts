import { boundEars } from '@apackdev/sdk/ears';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { Message } from '@apackdev/sdk/events';
import { resetTestData, startTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import type { PackOrigin } from '@apackdev/host/packs';
import { createAppBus, HOST } from '@apackdev/host/bus';
import { createSettingsSystem, hostRegistration, settingsEvents } from '@apackdev/host/features';
import { createSettingsAccess, createSettingsService, createSettingsStore } from '@apackdev/host/settings';
import { HOST_ENTITY_TYPES } from '@apackdev/host/app-state';
import { createWindowSettingsRuntime } from '@apackdev/host/fe';

const live = vi.hoisted(() => ({ packs: undefined as unknown as ReturnType<typeof createNativePackTestRegistry>, access: undefined as unknown as ReturnType<typeof createSettingsAccess> }));
vi.mock('../../src/runtime/index.ts', () => ({
  get appPacks() { return live.packs; }, get appSettingsAccess() { return live.access; },
  appClaims: { clientFor: () => undefined },
}));
vi.mock('../../src/transport/emitter.ts', async () => ({ rootEvents: (await import('@apackdev/sdk/testing')).testRootEvents }));
const { systemBusRouter } = await import('../../src/transport/bus.ts');
const { settingsRouter } = await import('../../src/transport/settings.ts');

const packs = createNativePackTestRegistry();
const admin = createSettingsService(createSettingsStore({ ears: boundEars, catalog: packs.settingsCatalog, onCatalogChanged: packs.onCatalogChanged }));
startTestRuntime({ packs, settings: admin, entityTypes: HOST_ENTITY_TYPES });
packs.registerPack(hostRegistration({ settings: { machine: createSettingsSystem(), receives: [...settingsEvents] } }));
const origins = new Map<string, PackOrigin>();
const stamp = { registrationId: 'runtime', id: 'consumer', declarationRevision: 'declarations', buildRevision: 'build' };
const origin = (): PackOrigin => ({ ...stamp, name: 'Consumer', version: '1.0.0', dir: '/fixture/consumer' });
const target = (groupId: string) => ({ kind: 'pack' as const, packId: 'owner', groupId });
let bus: ReturnType<typeof createActor<ReturnType<typeof createAppBus>>>;
let messages: Message[];
let stop: () => void;

function connection(client = 'window-one') {
  const closed = new AbortController();
  const context = { client, closed: closed.signal };
  return { closed, bus: systemBusRouter.createCaller(context), settings: settingsRouter.createCaller(context) };
}
beforeEach(() => {
  resetTestData();
  const definition = { defaults: { count: 1 }, schema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] } };
  packs.registerPack({ id: 'owner', settings: { shared: definition, private: { ...definition, access: 'owner' } } });
  packs.registerPack({ id: 'consumer', dependencies: { owner: '*' } });
  origins.set('consumer', origin());
  live.packs = packs;
  live.access = createSettingsAccess(admin, id => { const origin = origins.get(id); return origin ? { origin, registrationId: 'runtime' } : null; });
  messages = [];
  stop = testRootEvents.onOutgoing(message => { messages.push(message); });
  bus = createActor(createAppBus(packs), { systemId: HOST.bus }).start();
  testRootEvents.emitConnected();
});
afterEach(() => {
  bus.stop(); stop(); origins.clear();
  packs.unregisterPack('consumer'); packs.unregisterPack('owner');
  vi.restoreAllMocks();
});

const change = (groupId = 'shared') => ({ to: HOST.settings, sender: HOST.settings, call: 'change',
  event: { type: 'UPDATE_SETTINGS', target: target(groupId), path: ['count'], value: 2 } });
const answer = () => messages.find(message => message.answering === 'change')?.event;

it('refuses raw writes and sender/from/credential payload forgeries before reaching the writer', async () => {
  const client = connection();
  for (const input of [change(), { ...change(), from: 'host' },
    { ...change(), event: { ...change().event, settingsCredential: 'host', caller: 'host', access: { kind: 'host' } } }]) {
    await expect(client.bus.send(input)).rejects.toThrow('host-issued access');
  }
  expect(admin.getOverrides()).toEqual({});
});

it('enforces shared and owner-only policy at the actual settings action and preserves reply correlation', async () => {
  const client = connection();
  const settingsCredential = await client.settings.openPack(stamp);
  await client.bus.send({ ...change(), settingsCredential });
  expect(answer()).toMatchObject({ type: 'SETTINGS_SAVED', snapshot: expect.objectContaining({ status: 'ready' }) });
  expect(messages.find(message => message.answering === 'change')?.client).toBe('window-one');
  expect(admin.get(target('shared'))).toEqual({ count: 2 });
  messages.length = 0;
  await client.bus.send({ ...change('private'), from: 'owner', settingsCredential });
  expect(answer()).toMatchObject({ type: 'SETTINGS_REFUSED' });
  expect(admin.get(target('private'))).toEqual({ count: 1 });
  expect(messages.some(message => 'settingsCredential' in message || 'settingsCredential' in message.event)).toBe(false);
});

it('keeps a pack credential away from whole-document administration while trusted bootstrap can reset', async () => {
  const client = connection();
  const settingsCredential = await client.settings.openPack(stamp);
  await client.bus.send({ ...change(), settingsCredential });
  messages.length = 0;
  await client.bus.send({ ...change(), event: { type: 'RESET_ALL_SETTINGS' }, settingsCredential });
  expect(answer()).toMatchObject({ type: 'SETTINGS_REFUSED' });
  expect(admin.get(target('shared'))).toEqual({ count: 2 });
  messages.length = 0;
  const host = await client.settings.openHost();
  await client.bus.send({ ...change(), event: { type: 'RESET_ALL_SETTINGS' }, settingsCredential: host });
  expect(answer()).toMatchObject({ type: 'SETTINGS_SAVED', snapshot: expect.objectContaining({ status: 'ready' }) });
  expect(admin.getOverrides()).toEqual({});
});

it('rejects cross-connection, closed and stale runtime credentials', async () => {
  const first = connection();
  const other = connection('window-two');
  const settingsCredential = await first.settings.openPack(stamp);
  await expect(other.bus.send({ ...change(), settingsCredential })).rejects.toThrow('Settings access is unavailable');
  origins.set('consumer', origin());
  await expect(first.bus.send({ ...change(), settingsCredential })).rejects.toThrow('Settings access is unavailable');
  const replacement = await first.settings.openPack(stamp);
  first.closed.abort();
  await expect(first.bus.send({ ...change(), settingsCredential: replacement })).rejects.toThrow('host-issued access');
  expect(() => live.access.resolve('window-one', replacement)).toThrow('Settings access is unavailable');
  expect(admin.getOverrides()).toEqual({});
});

it('rechecks authority at delivery when a runtime disappeared after ingress accepted the request', async () => {
  const client = connection();
  const settingsCredential = await client.settings.openPack(stamp);
  const emit = testRootEvents.emitIncoming.bind(testRootEvents);
  vi.spyOn(testRootEvents, 'emitIncoming').mockImplementationOnce(message => {
    origins.delete('consumer');
    emit(message);
  });
  await client.bus.send({ ...change(), settingsCredential });
  expect(answer()).toMatchObject({ type: 'SETTINGS_REFUSED' });
  expect(admin.getOverrides()).toEqual({});
});

it('refuses a backend bus write with forged host labels and no host-side authority', () => {
  testRootEvents.emitIncoming({ ...change(), from: 'host', client: 'forged-window' });
  expect(answer()).toMatchObject({ type: 'SETTINGS_REFUSED' });
  expect(admin.getOverrides()).toEqual({});
});

it('shares window snapshots while applying the injected pack authority through the real transport and writer', async () => {
  const client = connection();
  const hostCredential = await client.settings.openHost();
  const packCredential = await client.settings.openPack(stamp);
  const window = createWindowSettingsRuntime({
    send: async message => { await client.bus.send({ ...message, settingsCredential: hostCredential }); },
  });
  const stopWindow = testRootEvents.onOutgoing(message => {
    if (!message.client || message.client === 'window-one') window.receive(message);
  });
  try {
    window.connected();
    await vi.waitFor(() => expect(window.port.status()).toBe('ready'));
    const binding = window.bindPort(stamp.id, async message => {
      await client.bus.send({ ...message, settingsCredential: packCredential });
    });
    expect(await binding.port.update(target('shared'), ['count'], 3)).toEqual({ status: 'saved' });
    expect(binding.port.get(target('shared'))).toEqual({ count: 3 });
    expect(window.port.get(target('shared'))).toEqual({ count: 3 });
    expect(await binding.port.update(target('private'), ['count'], 3)).toMatchObject({ status: 'refused' });
    expect(admin.get(target('private'))).toEqual({ count: 1 });
    expect(await window.port.update(target('private'), ['count'], 4)).toEqual({ status: 'saved' });
    expect(binding.port.get(target('private'))).toEqual({ count: 4 });
    binding.dispose();
    expect(await binding.port.reset(target('shared'))).toMatchObject({ status: 'refused' });
    expect(await window.port.reset(target('shared'))).toEqual({ status: 'saved' });
    expect(admin.get(target('shared'))).toEqual({ count: 1 });
  } finally {
    window.dispose(); stopWindow(); client.closed.abort();
  }
});

it('registers connection cleanup once across distinct procedure context objects sharing a socket', async () => {
  const closed = new AbortController();
  const listen = vi.spyOn(closed.signal, 'addEventListener');
  const credentials: string[] = [];
  for (let index = 0; index < 12; index++) {
    credentials.push(await settingsRouter.createCaller({ client: 'shared-socket', closed: closed.signal }).openHost());
  }
  expect(listen.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(1);
  closed.abort();
  for (const credential of credentials) expect(() => live.access.resolve('shared-socket', credential)).toThrow('unavailable');
});


it('accepts frontend readiness only for the current installed runtime, including identical-origin replacement', async () => {
  packs.unregisterPack('consumer');
  const acceptedOrigin = origin();
  const registration = { id: 'consumer', dependencies: { owner: '*' } };
  packs.registerPack(registration, acceptedOrigin);
  const first = packs.getPackRuntime('consumer')!.registrationId;
  const ready = connection();
  try {
    await expect(ready.bus.packClientReady({ packId: 'consumer', registrationId: first })).resolves.toBeUndefined();
    packs.replacePack(registration, acceptedOrigin);
    await expect(ready.bus.packClientReady({ packId: 'consumer', registrationId: first })).rejects.toThrow('unavailable pack runtime');
    const current = packs.getPackRuntime('consumer')!.registrationId;
    expect(current).not.toBe(first);
    await expect(ready.bus.packClientReady({ packId: 'consumer', registrationId: current })).resolves.toBeUndefined();
    await expect(ready.bus.packClientReady({ packId: 'missing', registrationId: current })).rejects.toThrow('unavailable pack runtime');
  } finally { ready.closed.abort(); }
});
