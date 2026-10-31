import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
// The window's client, over tRPC and Electron's API status: a backend that gave up before this window started
// listening is reported as main recorded it, message and stack apart, so the error page can lay them out.
import { afterEach, expect, it, vi } from 'vitest';

const ready = vi.fn(async () => {});
const mutate = vi.fn<(message: unknown) => Promise<void>>();
type Subscription = {
  onStarted(): void;
  onError(error: unknown): void;
  onData(message: import('@apackdev/sdk/events').Message): void;
  onConnectionStateChange(event: { state: string }): void;
};
const subscribe = vi.fn((_input: unknown, _handlers: Subscription) => ({ unsubscribe() {} }));
const catalogSubscribe = vi.fn((_input: unknown, _handlers: { onData(frame: import('@apackdev/host/fe').PackCatalogFrame): void; onError(error: unknown): void }) => ({ unsubscribe: vi.fn() }));
const openHost = vi.fn(async () => 'host-access');
const viewSubscribe = vi.fn((_request: unknown, _observer: Record<string, (value: unknown) => void>) => ({ unsubscribe: vi.fn() }));
vi.mock('@/transport', () => ({
  trpc: {
    views: { watch: { subscribe: viewSubscribe } },
    bus: { packClientReady: { mutate: ready }, sub: { subscribe }, send: { mutate: (m: unknown) => mutate(m) } },
    packs: { catalog: { subscribe: catalogSubscribe } },
    settings: { openHost: { mutate: openHost }, close: { mutate: async () => {} } },
  },
  reconnectApiClient: () => false,
}));
vi.mock('@/adapters/toast', () => ({ globalToast: { error: vi.fn() } }));

const { feClient } = await import('@/transport/client');
const { globalToast } = await import('@/adapters/toast');
const { disconnectWindowSettings } = await import('@/runtime/settings');

afterEach(async () => {
  disconnectWindowSettings();
  await Promise.resolve();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.mocked(globalToast.error).mockClear();
  mutate.mockReset();
  subscribe.mockClear();
  openHost.mockClear();
  catalogSubscribe.mockClear();
  viewSubscribe.mockClear();
  stopFeTestRuntime();
});

it('announces a connected shell only after a fresh validated settings snapshot on each connection', async () => {
  mutate.mockResolvedValue();
  const onConnected = vi.fn();
  const onDisconnected = vi.fn();
  const stop = feClient.subscribe({ onConnected, onDisconnected, onMessage() {}, onFailed: vi.fn() });
  try {
    const handlers = subscribe.mock.calls[0][1];
    for (const runId of ['first', 'second']) {
      const before = mutate.mock.calls.length;
      handlers.onStarted();
      await vi.waitFor(() => expect(mutate.mock.calls.length).toBeGreaterThan(before));
      expect(onConnected).toHaveBeenCalledTimes(runId === 'first' ? 0 : 1);
      const message = mutate.mock.calls.at(-1)![0] as import('@apackdev/sdk/events').Message;
      expect(message.event.type).toBe('GET_SETTINGS');
      handlers.onData({ to: 'host/settings', answering: message.call, event: {
        type: 'SETTINGS_LOADED', snapshot: {
          runId, revision: 0, status: 'ready', values: { app: { hotkeys: {}, personal: {}, projects: [] }, packs: {}, features: {} },
          catalog: { revision: 0, app: { schema: { type: 'object' }, defaults: {} }, packs: {}, features: {}, dependencies: {} },
        },
      } });
      await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(runId === 'first' ? 1 : 2));
      if (runId === 'first') {
        handlers.onConnectionStateChange({ state: 'connecting' });
        expect(onDisconnected).toHaveBeenCalledOnce();
      }
    }
    expect(openHost).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});

/**
 * **A send that fails tells the user; an answer that fails does not.**
 *
 * This is the same call `5ab702222` made for a send that stays inside the window, in the one path that leaves
 * it. A command someone gave is worth a toast — they are still there, and they can act on it. An answer has
 * nobody behind it: a surface asked, the answering side replied, and if the asking system no longer declares the
 * event the person gets a sentence about plumbing they did not cause. `Message.answering` is set by `reply` and
 * by nothing else, which is what makes it safe to branch on here.
 *
 * The log is unconditional in both: whoever can act on it is reading the Logs surface, not a toast.
 */
it('toasts a send that fails, because someone asked for it', async () => {
  mutate.mockRejectedValue(new Error('Unknown event "NOPE" for system "pack/feature"'));

  feClient.send({ to: 'pack/feature', event: { type: 'NOPE' } });
  await vi.waitFor(() => expect(globalToast.error).toHaveBeenCalled());

  expect(vi.mocked(globalToast.error).mock.calls[0]?.[0]).toContain("Couldn't send NOPE to pack/feature");
});

// Remove the `answering` guard in client.ts and this is the case that fails
it('does not toast an answer that fails, but still logs it', async () => {
  const write = vi.fn((_entry: { level: string; source: string; message: string }) => Promise.resolve());
  (window as unknown as { electronAPI: unknown }).electronAPI = { rendererLog: { write } };
  mutate.mockRejectedValue(new Error('Unknown event "ANSWER" for system "pack/asker"'));

  feClient.send({ to: 'pack/asker', event: { type: 'ANSWER' }, answering: 'c-asked' });
  await vi.waitFor(() => expect(write).toHaveBeenCalled());

  expect(globalToast.error, 'nobody is waiting on an answer to be told').not.toHaveBeenCalled();
  expect(write.mock.calls[0]?.[0], 'and the diagnostic still reaches the log').toMatchObject({
    source: 'fe-client',
    level: 'error',
  });
});

it('reports a backend that already gave up with the error main recorded, not its string', async () => {
  const error = { message: 'Max restart attempts reached', stack: 'Error: Max restart attempts reached\n    at ApiServer' };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    apiStatus: {
      getStatus: () => Promise.resolve({ running: false, error, restartAttempts: 3 }),
      onEvent: () => () => {},
    },
  };
  const onFailed = vi.fn();

  const stop = feClient.subscribe({ onConnected: () => {}, onDisconnected: () => {}, onMessage: () => {}, onFailed });
  await vi.waitFor(() => expect(onFailed).toHaveBeenCalled());
  stop();

  expect(onFailed).toHaveBeenCalledWith(error);
});

it('reports an API process that stopped, message and stack apart', async () => {
  let report: ((event: { type: string; error?: unknown }) => void) | undefined;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    apiStatus: {
      getStatus: () => Promise.resolve({ running: true, restartAttempts: 0 }),
      onEvent: (callback: typeof report) => { report = callback; return () => {}; },
    },
  };
  const onFailed = vi.fn();

  const stop = feClient.subscribe({ onConnected: () => {}, onDisconnected: () => {}, onMessage: () => {}, onFailed });
  report!({ type: 'api:stopped', error: { message: 'Backend process exited unexpectedly (code 1)', stack: 'at api' } });
  stop();

  expect(onFailed).toHaveBeenCalledWith({ message: 'Backend process exited unexpectedly (code 1)', stack: 'at api' });
});


it('acknowledges the accepted frontend lifetime rather than its pack name alone', async () => {
  await feClient.packClientReady('example', 'accepted-runtime');
  expect(ready).toHaveBeenCalledWith({ packId: 'example', registrationId: 'accepted-runtime' });
});

it('ignores callbacks from a stopped bus lifetime and closes its catalog subscription', async () => {
  mutate.mockResolvedValue();
  const onDisconnected = vi.fn(); const onFailed = vi.fn(); const onMessage = vi.fn();
  const stop = feClient.subscribe({ onConnected: vi.fn(), onDisconnected, onMessage, onFailed });
  const handlers = subscribe.mock.calls[0][1]; handlers.onStarted();
  expect(catalogSubscribe).toHaveBeenCalledOnce();
  const catalogSubscription = catalogSubscribe.mock.results[0].value;
  stop();
  handlers.onStarted(); handlers.onError(new Error('old')); handlers.onConnectionStateChange({ state: 'connecting' });
  handlers.onData({ to: 'host/settings', event: { type: 'OLD' } });
  expect(catalogSubscribe).toHaveBeenCalledOnce();
  expect(catalogSubscription.unsubscribe).toHaveBeenCalledOnce();
  expect(onDisconnected).not.toHaveBeenCalled(); expect(onFailed).not.toHaveBeenCalled(); expect(onMessage).not.toHaveBeenCalled();
});

it('feeds declaration data to the real window resource independently of settings bootstrap', async () => {
  mutate.mockResolvedValue();
  const { windowCatalog } = await import('@/runtime/catalog');
  const onConnected = vi.fn();
  const stop = feClient.subscribe({ onConnected, onDisconnected: vi.fn(), onMessage() {}, onFailed: vi.fn() });
  try {
    subscribe.mock.calls[0][1].onStarted();
    catalogSubscribe.mock.calls[0][1].onData({ runId: 'catalog-run', snapshot: {
      revision: 1, appSettings: { schema: { type: 'object' }, defaults: {} },
      packs: [], problems: [], sourcePacks: [], appPackSources: [], appPackSourceProblems: [],
      native: [{ id: 'cold-pack', features: { view: { description: 'Exercise cold metadata.', surface: { label: 'Cold metadata', state: 'never-load.ts' } } } }],
    } });
    expect(windowCatalog.status()).toBe('ready');
    expect(windowCatalog.getSnapshot()?.native[0].features?.view.surface?.label).toBe('Cold metadata');
    expect(onConnected).not.toHaveBeenCalled();
  } finally { stop(); }
  expect(windowCatalog.status()).toBe('disconnected');
});


it('preserves view results and ignores deliveries after a subscription has stopped', () => {
  const observer = vi.fn();
  const stop = feClient.watchView({ ref: 'pack/feature', view: 'page', args: { id: 'one' } }, observer);
  const callbacks = viewSubscribe.mock.calls[0][1];
  const update = { ok: true, value: ['one'], commit: 4 };
  callbacks.onData(update);
  expect(observer).toHaveBeenCalledWith(update);
  stop();
  callbacks.onData({ ok: true, value: ['late'], commit: 5 });
  callbacks.onError(Error('late error'));
  expect(observer).toHaveBeenCalledTimes(1);
});

it('carries request context and restores each delivery context separately', () => {
  const sent = { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' };
  const received = { traceparent: '00-33333333333333333333333333333333-4444444444444444-01' };
  const withCarrier = vi.fn<(carrier: unknown) => void>();
  startFeTestRuntime({ diagnostics: { capture: () => sent, withCarrier: (carrier, fn) => { withCarrier(carrier); return fn(); }, carryEvent() {}, withEvent: (_event, fn) => fn() } });
  const observer = vi.fn();
  const stop = feClient.watchView({ ref: 'pack/feature', view: 'page' }, observer);
  try {
    expect(viewSubscribe.mock.calls[0][0]).toMatchObject({ diagnostics: sent });
    viewSubscribe.mock.calls[0][1].onData({ ok: true, value: ['one'], commit: 1, diagnostics: { carrier: received, subscription: 'one', delivery: 1 } });
    expect(withCarrier.mock.calls[0][0]).toEqual(received);
    viewSubscribe.mock.calls[0][1].onData({ ok: true, value: ['background'], commit: 2 });
    expect(withCarrier.mock.calls[1][0], 'an uncorrelated update cannot inherit the subscription action').toBeUndefined();
  } finally { stop(); }
});

it('drops old view callbacks when an API reload starts a new subscription generation', () => {
  const original = { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' };
  const fresh = { traceparent: '00-33333333333333333333333333333333-4444444444444444-01' };
  startFeTestRuntime({ diagnostics: { capture: () => fresh, withCarrier: (_carrier, fn) => fn(), carryEvent() {}, withEvent: (_event, fn) => fn() } });
  let apiEvent!: (event: { type: string; reloaded: boolean }) => void;
  (window as unknown as { electronAPI: unknown }).electronAPI = { apiStatus: {
    getStatus: async () => ({ running: true }), onEvent: (listener: typeof apiEvent) => { apiEvent = listener; return () => {}; },
  } };
  const observer = vi.fn();
  const stopBus = feClient.subscribe({ onConnected() {}, onDisconnected() {}, onFailed() {}, onMessage() {} });
  const stopView = feClient.watchView({ ref: 'pack/feature', view: 'page', diagnostics: original }, observer);
  try {
    expect(viewSubscribe.mock.calls[0][0]).toMatchObject({ diagnostics: original });
    const old = viewSubscribe.mock.calls[0][1];
    apiEvent({ type: 'api:started', reloaded: true });
    expect(viewSubscribe).toHaveBeenCalledTimes(2);
    expect(viewSubscribe.mock.calls[1][0]).toMatchObject({ diagnostics: fresh });
    old.onData({ ok: true, value: 'stale', commit: 1 });
    old.onError(Error('stale error'));
    expect(observer).not.toHaveBeenCalled();
    viewSubscribe.mock.calls[1][1].onData({ ok: true, value: 'current', commit: 1 });
    expect(observer).toHaveBeenCalledWith({ ok: true, value: 'current', commit: 1 });
  } finally { stopView(); stopBus(); }
});
