import { afterEach, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useAppSettings } from '@apackdev/sdk/fe';
import { startFeTestRuntime } from '@apackdev/sdk/testing';
import type { Message } from '@apackdev/sdk/events';
import type { SettingsSnapshot } from '@apackdev/sdk/types';

const { send, openHost, openPack, close } = vi.hoisted(() => ({
  send: vi.fn(async (_message: Message & { settingsCredential?: string }) => {}),
  openHost: vi.fn(async () => 'host-access'), openPack: vi.fn(async () => 'pack-access'), close: vi.fn(async () => {}),
}));
vi.mock('@/transport', () => ({ trpc: {
  bus: { send: { mutate: send } },
  settings: { openHost: { mutate: openHost }, openPack: { mutate: openPack }, close: { mutate: close } },
} }));
import { windowSettings, settingsPort, connectWindowSettings, disconnectWindowSettings, settingsForPack } from '../../src/runtime/settings';

afterEach(async () => { disconnectWindowSettings(); await flush(); vi.clearAllMocks(); });
const snapshot: SettingsSnapshot = {
  runId: 'test-run', revision: 0, status: 'ready',
  values: { app: { hotkeys: {}, personal: {}, projects: [] }, packs: { example: { assistant: { name: 'Ada' } } }, features: { 'example/code': { limit: 3 } } },
  catalog: { revision: 0, app: { schema: { type: 'object' }, defaults: {} }, packs: {}, features: {}, dependencies: {} },
};
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
async function connect() {
  const ready = connectWindowSettings();
  await flush();
  windowSettings.receive({ to: 'host/settings', answering: send.mock.calls.at(-1)![0].call, event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot } } });
  expect(await ready).toBe(true);
}

it('binds shared settings without finding or starting the Settings view', async () => {
  const stop = startFeTestRuntime({ settings: settingsPort });
  const scope = effectScope();
  const app = scope.run(() => useAppSettings())!;
  expect(app.value).toBeUndefined();
  await connect();
  expect(app.value).toEqual(snapshot.values.app);
  expect(settingsPort.get({ kind: 'pack', packId: 'example', groupId: 'assistant' })).toEqual({ name: 'Ada' });
  expect(settingsPort.get({ kind: 'feature', featureRef: 'example/code' as import('@apackdev/sdk/ids').FeatureRef })).toEqual({ limit: 3 });
  scope.stop();
  stop();
});

it('writes directly through the transport and resolves only the correlated result', async () => {
  await connect();
  const write = settingsPort.update({ kind: 'app' }, ['personal', 'name'], 'Grace');
  await flush();
  const request = send.mock.calls.at(-1)![0];
  expect(request).toMatchObject({ to: 'host/settings', sender: 'host/settings', event: { type: 'UPDATE_SETTINGS', target: { kind: 'app' }, path: ['personal', 'name'], value: 'Grace' } });
  expect(request.settingsCredential).toBe('host-access');
  windowSettings.receive({ to: 'host/settings', answering: request.call, event: { type: 'ASK_FAILED', asked: 'UPDATE_SETTINGS', failure: { kind: 'refused', message: 'refused', problems: ['invalid'] } } });
  expect(await write).toEqual({ status: 'refused', problems: ['invalid'] });
  expect(settingsPort.get({ kind: 'app' })).toEqual(snapshot.values.app);
});

const acceptedPack = { registrationId: 'runtime', id: 'example', name: 'Example', version: '1.0.0', declarationRevision: 'declarations', buildRevision: 'build' };

it('issues loader-bound pack access from accepted identities and sends its credential outside the event', async () => {
  await connect();
  const binding = await settingsForPack(acceptedPack);
  expect(openPack).toHaveBeenCalledWith({ id: 'example', registrationId: 'runtime', declarationRevision: 'declarations', buildRevision: 'build' });
  const write = binding.port.reset({ kind: 'feature', featureRef: 'example/code' });
  await flush();
  const request = send.mock.calls.at(-1)![0];
  expect(request.settingsCredential).toBe('pack-access');
  expect(request.event).not.toHaveProperty('settingsCredential');
  windowSettings.receive({ to: 'host/settings', answering: request.call, event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: windowSettings.getSnapshot() } } });
  expect(await write).toEqual({ status: 'saved' });
  binding.dispose(); binding.dispose();
  expect(close).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledWith({ credential: 'pack-access' });
  expect((await binding.port.reset({ kind: 'app' })).status).toBe('refused');
  expect(settingsPort.status()).toBe('ready');
});

it('requires installed build identity and never falls back to host access', async () => {
  await connect();
  await expect(settingsForPack({ ...acceptedPack, buildRevision: undefined })).rejects.toThrow('build identity');
  expect(openPack).not.toHaveBeenCalled();
});

it('discards a provisional pack credential if its connection changes during issuance', async () => {
  await connect();
  let release!: (credential: string) => void;
  openPack.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const loading = settingsForPack(acceptedPack);
  await flush();
  disconnectWindowSettings();
  release('stale-access');
  await expect(loading).rejects.toThrow('connection changed');
  expect(close).toHaveBeenCalledWith({ credential: 'stale-access' });
});

it('keeps bootstrap pending until a validated correlated snapshot arrives', async () => {
  const ready = connectWindowSettings();
  let settled = false;
  void ready.then(() => { settled = true; });
  await flush();
  expect(settled).toBe(false);
  expect(openHost).toHaveBeenCalledOnce();
  const call = send.mock.calls.at(-1)![0].call;
  windowSettings.receive({ to: 'host/settings', answering: 'other-read', event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot } } });
  await flush();
  expect(settled).toBe(false);
  windowSettings.receive({ to: 'host/settings', answering: call, event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot } } });
  expect(await ready).toBe(true);
});

it('does not report a dropped bootstrap as a new connected shell', async () => {
  const ready = connectWindowSettings();
  disconnectWindowSettings();
  expect(await ready).toBe(false);
  await flush();
  expect(send).not.toHaveBeenCalled();
});
