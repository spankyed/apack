import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
// The window's client, over `windowTransport` (`muxTransport` → `@apackdev/link` + Control Lane) and Electron's API status.
import { afterEach, expect, it, vi } from 'vitest';
import type { Message } from '@apackdev/sdk/events';
import type { PackCatalogFrame } from '@apackdev/host/fe';
import type { ViewUpdate } from '@apackdev/sdk/framework';

type Subscriber = {
  onConnected(): void;
  onDisconnected(): void;
  onMessage(message: Message): void;
};

const linkSend = vi.fn<(message: Message) => Promise<void>>();
const linkAsk = vi.fn<(to: string, name: string, args: unknown, options?: { signal?: AbortSignal }) => Promise<{ ok: true; value: unknown } | { ok: false; failure: { kind: string; message: string } }>>();
const linkFollow = vi.fn<(
  feature: string,
  view: string,
  args: unknown,
  handlers: { onUpdate(u: ViewUpdate): void; onError(e: Error): void },
  diagnostics?: unknown,
) => { stop(): void }>(() => ({ stop: vi.fn() }));
const subscribeTransport = vi.fn((_handlers: Subscriber) => () => {});
const controlCall = vi.fn<(method: string, input?: unknown) => Promise<unknown>>(async (method) => {
  if (method === 'settings.openHost') return { credential: 'host-access' };
  return undefined;
});
const controlSubscribe = vi.fn((
  _method: string,
  _input: unknown,
  _handlers: { onData(frame: PackCatalogFrame): void; onEnd?(error?: unknown): void },
) => ({ unsubscribe: vi.fn(), closed: false }));

vi.mock('@/transport', () => ({
  windowTransport: {
    subscribe: subscribeTransport,
    controlCall,
    tryControlCall: controlCall,
    controlSubscribe,
    linkSend,
    linkAsk,
    linkFollow,
  },
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
  linkSend.mockReset();
  linkAsk.mockReset();
  linkFollow.mockClear();
  subscribeTransport.mockClear();
  controlCall.mockClear();
  controlSubscribe.mockClear();
  stopFeTestRuntime();
});

it('announces a connected shell only after a fresh validated settings snapshot on each connection', async () => {
  linkSend.mockResolvedValue();
  const onConnected = vi.fn();
  const onDisconnected = vi.fn();
  const stop = feClient.subscribe({ onConnected, onDisconnected, onMessage() {}, onFailed: vi.fn() });
  try {
    const handlers = subscribeTransport.mock.calls[0][0];
    for (const runId of ['first', 'second']) {
      const before = linkSend.mock.calls.length;
      handlers.onConnected();
      await vi.waitFor(() => expect(linkSend.mock.calls.length).toBeGreaterThan(before));
      expect(onConnected).toHaveBeenCalledTimes(runId === 'first' ? 0 : 1);
      const message = linkSend.mock.calls.at(-1)![0];
      expect(message.event.type).toBe('GET_SETTINGS');
      handlers.onMessage({
        to: 'host/settings',
        answering: message.call,
        event: {
          type: 'ASK_ANSWERED',
          asked: 'GET_SETTINGS',
          answer: {
            snapshot: {
              runId,
              revision: 0,
              status: 'ready',
              values: { app: { hotkeys: {}, personal: {}, projects: [] }, packs: {}, features: {} },
              catalog: { revision: 0, app: { schema: { type: 'object' }, defaults: {} }, packs: {}, features: {}, dependencies: {} },
            },
          },
        },
      });
      await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(runId === 'first' ? 1 : 2));
      if (runId === 'first') {
        handlers.onDisconnected();
        expect(onDisconnected).toHaveBeenCalledOnce();
      }
    }
    expect(controlCall.mock.calls.filter(([method]) => method === 'settings.openHost')).toHaveLength(2);
  } finally {
    stop();
  }
});

it('toasts a send that fails, because someone asked for it', async () => {
  linkSend.mockRejectedValue(new Error('Unknown event "NOPE" for system "pack/feature"'));

  feClient.send({ to: 'pack/feature', event: { type: 'NOPE' } });
  await vi.waitFor(() => expect(globalToast.error).toHaveBeenCalled());

  expect(vi.mocked(globalToast.error).mock.calls[0]?.[0]).toContain("Couldn't send NOPE to pack/feature");
});

it('does not toast an answer that fails, but still logs it', async () => {
  const write = vi.fn((_entry: { level: string; source: string; message: string }) => Promise.resolve());
  (window as unknown as { electronAPI: unknown }).electronAPI = { rendererLog: { write } };
  linkSend.mockRejectedValue(new Error('Unknown event "ANSWER" for system "pack/asker"'));

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
  expect(controlCall).toHaveBeenCalledWith('packs.clientReady', { packId: 'example', registrationId: 'accepted-runtime' });
});

it('queries ENTITY_EXISTS over @apackdev/link with AbortSignal propagation', async () => {
  const controller = new AbortController();
  linkAsk.mockResolvedValueOnce({ ok: true, value: { exists: true } });
  await expect(feClient.entityExists('Note-1' as never, controller.signal)).resolves.toBe(true);
  expect(linkAsk).toHaveBeenCalledWith('host/application', 'ENTITY_EXISTS', { id: 'Note-1' }, { signal: controller.signal });
});

it('ignores callbacks from a stopped bus lifetime and closes its catalog subscription', async () => {
  linkSend.mockResolvedValue();
  const onDisconnected = vi.fn();
  const onFailed = vi.fn();
  const onMessage = vi.fn();
  const stop = feClient.subscribe({ onConnected: vi.fn(), onDisconnected, onMessage, onFailed });
  const handlers = subscribeTransport.mock.calls[0][0];
  handlers.onConnected();
  expect(controlSubscribe).toHaveBeenCalledOnce();
  const catalogSubscription = controlSubscribe.mock.results[0].value;
  stop();
  handlers.onConnected();
  handlers.onDisconnected();
  handlers.onMessage({ to: 'host/settings', event: { type: 'OLD' } });
  expect(controlSubscribe).toHaveBeenCalledOnce();
  expect(catalogSubscription.unsubscribe).toHaveBeenCalledOnce();
  expect(onDisconnected).not.toHaveBeenCalled();
  expect(onFailed).not.toHaveBeenCalled();
  expect(onMessage).not.toHaveBeenCalled();
});

it('feeds declaration data to the real window resource independently of settings bootstrap', async () => {
  linkSend.mockResolvedValue();
  const { windowCatalog } = await import('@/runtime/catalog');
  const onConnected = vi.fn();
  const stop = feClient.subscribe({ onConnected, onDisconnected: vi.fn(), onMessage() {}, onFailed: vi.fn() });
  try {
    subscribeTransport.mock.calls[0][0].onConnected();
    controlSubscribe.mock.calls[0][2].onData({
      runId: 'catalog-run',
      snapshot: {
        revision: 1,
        appSettings: { schema: { type: 'object' }, defaults: {} },
        packs: [],
        problems: [],
        sourcePacks: [],
        appPackSources: [],
        appPackSourceProblems: [],
        native: [{ id: 'cold-pack', features: { view: { description: 'Exercise cold metadata.', surface: { label: 'Cold metadata', state: 'never-load.ts' } } } }],
      },
    });
    expect(windowCatalog.status()).toBe('ready');
    expect(windowCatalog.getSnapshot()?.native[0].features?.view.surface?.label).toBe('Cold metadata');
    expect(onConnected).not.toHaveBeenCalled();
  } finally {
    stop();
  }
  expect(windowCatalog.status()).toBe('disconnected');
});

it('preserves view results and ignores deliveries after a subscription has stopped', () => {
  const observer = vi.fn();
  const stop = feClient.watchView({ ref: 'pack/feature', view: 'page', args: { id: 'one' } }, observer);
  const callbacks = linkFollow.mock.calls[0][3];
  const update = { ok: true as const, value: ['one'], commit: 4 };
  callbacks.onUpdate(update);
  expect(observer).toHaveBeenCalledWith(update);
  stop();
  callbacks.onUpdate({ ok: true, value: ['late'], commit: 5 });
  callbacks.onError(Error('late error'));
  expect(observer).toHaveBeenCalledTimes(1);
});

it('carries request context and restores each delivery context separately', () => {
  const sent = { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' };
  const received = { traceparent: '00-33333333333333333333333333333333-4444444444444444-01' };
  const withCarrier = vi.fn<(carrier: unknown) => void>();
  startFeTestRuntime({ diagnostics: { capture: () => sent, withCarrier: (carrier, fn) => { withCarrier(carrier); return fn(); }, carryEvent() {}, withEvent: (_event, fn) => fn(), record() {} } });
  const observer = vi.fn();
  const stop = feClient.watchView({ ref: 'pack/feature', view: 'page' }, observer);
  try {
    expect(linkFollow.mock.calls[0][4]).toEqual(sent);
    linkFollow.mock.calls[0][3].onUpdate({ ok: true, value: ['one'], commit: 1, diagnostics: { carrier: received, subscription: 'one', delivery: 1 } });
    expect(withCarrier.mock.calls[0][0]).toEqual(received);
    linkFollow.mock.calls[0][3].onUpdate({ ok: true, value: ['background'], commit: 2 });
    expect(withCarrier.mock.calls[1][0], 'an uncorrelated update cannot inherit the subscription action').toBeUndefined();
  } finally {
    stop();
  }
});

it('drops old view callbacks when a reconnected transport session starts a new subscription generation', () => {
  linkSend.mockResolvedValue();
  const original = { traceparent: '00-11111111111111111111111111111111-2222222222222222-01' };
  const fresh = { traceparent: '00-33333333333333333333333333333333-4444444444444444-01' };
  startFeTestRuntime({ diagnostics: { capture: () => fresh, withCarrier: (_carrier, fn) => fn(), carryEvent() {}, withEvent: (_event, fn) => fn(), record() {} } });
  const observer = vi.fn();
  const stopBus = feClient.subscribe({ onConnected() {}, onDisconnected() {}, onFailed() {}, onMessage() {} });
  const handlers = subscribeTransport.mock.calls[0][0];
  handlers.onConnected();
  const stopView = feClient.watchView({ ref: 'pack/feature', view: 'page', diagnostics: original }, observer);
  try {
    expect(linkFollow.mock.calls[0][4]).toEqual(original);
    const old = linkFollow.mock.calls[0][3];
    // Backend restarts and hands over a fresh port generation
    handlers.onDisconnected();
    handlers.onConnected();
    expect(linkFollow).toHaveBeenCalledTimes(2);
    expect(linkFollow.mock.calls[1][4]).toEqual(fresh);
    old.onUpdate({ ok: true, value: 'stale', commit: 1 });
    old.onError(Error('stale error'));
    expect(observer).not.toHaveBeenCalled();
    linkFollow.mock.calls[1][3].onUpdate({ ok: true, value: 'current', commit: 1 });
    expect(observer).toHaveBeenCalledWith({ ok: true, value: 'current', commit: 1 });
  } finally {
    stopView();
    stopBus();
  }
});
