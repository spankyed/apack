import type { StepDefinition } from '@apackdev/sdk/steps';
import { createMachine } from 'xstate';
import { nativeFrontendDeclarationFixture } from '@apackdev/sdk/testing';
// The renderer's frontend binding: SDK frontend code reaches the API client and the application actor only through it
import { afterEach, expect, it, vi } from 'vitest';

const mutate = vi.hoisted(() => vi.fn<(event: unknown) => Promise<void>>());
const secretsList = vi.hoisted(() => vi.fn(() => Promise.resolve({ secrets: [], status: { protection: 'os-keystore', backend: 'test' } })));
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/transport', () => ({ trpc: { bus: { send: { mutate } }, secrets: { list: { query: secretsList } } } }));
vi.mock('@/adapters/toast', () => ({ globalToast: { error: toastError } }));

const logWrite = vi.hoisted(() => vi.fn(() => Promise.resolve()));
(window as unknown as { electronAPI: unknown }).electronAPI = { rendererLog: { write: logWrite } };

const { bindRendererHost, disposeRendererRuntime, onRendererDispose, rendererClock } = await import('@/runtime');
const { fePacks } = await import('@/runtime/packs');
const { resolveName } = await import('@apackdev/sdk/ids');
const { hostClock, onHostDispose, secretsClient, untypedOpenSurface, getStepFrontendBindings, getDesignated, textEditorExtensionsRegistry } = await import('@apackdev/sdk/fe');
const { untypedTell } = await import('@apackdev/sdk/events');
const { unbindFeHost } = await import('@apackdev/sdk/runtime/internals');

const application = {
  getSnapshot: () => ({
    context: { surfaces: [{ id: 'default-setup/notes' }, { id: 'default-setup/settings' }], activeSurface: { id: 'default-setup/notes' }, defaultToggles: { canvas: false } },
  }),
  send: vi.fn(),
  system: { get: () => undefined },
};

const unhandled = vi.fn();
afterEach(() => {
  process.off('unhandledRejection', unhandled);
  disposeRendererRuntime();
  unbindFeHost();
  vi.clearAllMocks();
});

const settingsAddress = resolveName('default-setup/settings');

it("gives the SDK's frontend lookups the window's registered pack frontends", () => {
  const mentions = { extensions: {} };
  const icon = vi.fn();
  const note = { type: 'note', node: { label: 'Note' }, fe: { nodeConfig: { icon, category: 'data', connectionRules: { inputs: 1, outputs: 1 } } } } satisfies StepDefinition;
  const registration = {
    id: 'fe-host-pack',
    features: { notebookMain: { surface: { label: 'Notebook', state: createMachine({}) }, designation: 'notebook' } },
    steps: [note],
    textEditor: { mentions },
  };
  fePacks.registerPackFE({ kind: 'native', declaration: nativeFrontendDeclarationFixture(registration) }, registration);
  try {
    bindRendererHost(() => application as never);
    expect(textEditorExtensionsRegistry.getAll()).toEqual([{ packId: 'fe-host-pack', groupId: 'mentions', binding: mentions }]);
    expect(getStepFrontendBindings().get('note')?.binding).toEqual(note);
    expect(getStepFrontendBindings().get('note')?.binding.fe?.nodeConfig.icon).toBe(icon);
    expect(getStepFrontendBindings().get('note')).toMatchObject({ packId: 'fe-host-pack', declaration: { node: { label: 'Note' } } });
    note.node.label = 'Caller mutation';
    expect(getStepFrontendBindings().get('note')?.binding.node?.label).toBe('Note');
    expect(getDesignated('notebook')).toBe('fe-host-pack/notebookMain');
  } finally {
    fePacks.unregisterPackFE('fe-host-pack');
  }
});

it('binds before the application actor exists, naming it when SDK code reaches the actor too early', () => {
  // Read by the binding below before it is assigned, which is the case under test, so `const` would not compile.
  // eslint-disable-next-line prefer-const
  let created: typeof application | undefined;
  bindRendererHost(() => created as never);
  expect(() => untypedOpenSurface(settingsAddress)).toThrow(/isn't created yet/);
  created = application;
  untypedOpenSurface(settingsAddress);
  expect(application.send).toHaveBeenCalledWith({ type: 'OPEN_SURFACE', surface: 'default-setup/settings', events: [] });
});

it('gives secretsClient the API client and untypedOpenSurface the application actor', async () => {
  bindRendererHost(() => application as never);
  await expect(secretsClient.list()).resolves.toMatchObject({ secrets: [] });
  untypedOpenSurface(settingsAddress);
  expect(application.send).toHaveBeenCalledWith({ type: 'OPEN_SURFACE', surface: 'default-setup/settings', events: [] });
});

// Whether a ref names a registered surface is the shell's to answer, once pack frontends have loaded; a string that
// isn't a ref at all never reaches it
it('refuses a string that is not a ref, rather than asking the shell to open it', () => {
  bindRendererHost(() => application as never);
  expect(() => untypedOpenSurface('code')).toThrow(`"code" doesn't name a surface`);
  expect(application.send).not.toHaveBeenCalled();
});

it("sends to systems over the API client, reporting a rejected send to the console, the app's log and a toast, without an unhandled rejection or the payload", async () => {
  bindRendererHost(() => application as never);
  process.on('unhandledRejection', unhandled);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  mutate.mockRejectedValue(new Error('socket closed'));

  untypedTell('notes', { type: 'SAVE_NOTE', body: 'secret text' });
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(mutate).toHaveBeenCalledWith({ to: 'notes', call: expect.any(String), event: { type: 'SAVE_NOTE', body: 'secret text' } });
  expect(unhandled).not.toHaveBeenCalled();
  expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('SAVE_NOTE'));
  expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', source: 'fe-client' }));
  expect(toastError).toHaveBeenCalledWith(expect.stringContaining('SAVE_NOTE'));
  expect(JSON.stringify([consoleError.mock.calls, logWrite.mock.calls, toastError.mock.calls])).not.toContain('secret text');
});

it('exposes one shared ClockController and runs dispose hooks before closing it with zero waiting timers', () => {
  bindRendererHost(() => application as never);
  const controller = rendererClock();
  expect(controller).toBeDefined();
  expect(hostClock()).toBe(controller!.clock);

  const order: string[] = [];
  const cancelFirst = hostClock()!.after(60_000, () => {});
  const cancelSecond = hostClock()!.after(60_000, () => {});
  expect(controller!.waiting()).toBe(2);

  onRendererDispose(() => {
    order.push('first');
    cancelFirst();
    // Still open while teardown hooks run: another timer could still cancel cleanly before close
    expect(controller!.waiting()).toBe(0);
  });
  onHostDispose(() => {
    order.push('second');
    cancelSecond();
    expect(controller!.waiting()).toBe(1);
  });

  disposeRendererRuntime();

  expect(order).toEqual(['second', 'first']);
  expect(controller!.waiting()).toBe(0);
  expect(rendererClock()).toBeUndefined();
  expect(() => controller!.clock.after(10, () => {})).toThrowError(/closed/i);

  // Idempotent on repeat teardown
  expect(() => disposeRendererRuntime()).not.toThrow();
});

it('tears down registered hooks before closing the shared clock on window pagehide', () => {
  bindRendererHost(() => application as never);
  const controller = rendererClock()!;
  const cancel = hostClock()!.after(60_000, () => {});
  let waitingAtCleanup = -1;

  onHostDispose(() => {
    cancel();
    waitingAtCleanup = controller.waiting();
  });

  window.dispatchEvent(new Event('pagehide'));

  expect(waitingAtCleanup).toBe(0);
  expect(controller.waiting()).toBe(0);
  expect(rendererClock()).toBeUndefined();
  expect(() => controller.clock.after(10, () => {})).toThrowError(/closed/i);
});

it('runs remaining dispose hooks and closes the clock even when one hook throws', () => {
  bindRendererHost(() => application as never);
  const controller = rendererClock()!;
  const cancel = hostClock()!.after(60_000, () => {});
  const secondRan = vi.fn(() => { cancel(); });

  onHostDispose(secondRan);
  onHostDispose(() => { throw new Error('boom'); });

  expect(() => disposeRendererRuntime()).toThrow('boom');
  expect(secondRan).toHaveBeenCalledTimes(1);
  expect(controller.waiting()).toBe(0);
  expect(() => controller.clock.after(10, () => {})).toThrowError(/closed/i);
});

it('keeps the active runtime intact if bindRendererHost is called twice, and still wires pagehide when re-binding after a throwing teardown', () => {
  bindRendererHost(() => application as never);
  const firstController = rendererClock()!;
  onHostDispose(() => {
    throw new Error('prior teardown failed');
  });

  // Duplicate bind without unbind throws and leaves the first lifecycle running
  expect(() => bindRendererHost(() => application as never)).toThrow(/already bound/i);
  expect(rendererClock()).toBe(firstController);
  expect(() => firstController.clock.after(10, () => {})()).not.toThrow();

  // After unbinding, re-binding still wires pagehide on the new lifecycle even when the previous teardown throws
  unbindFeHost();
  expect(() => bindRendererHost(() => application as never)).toThrow('prior teardown failed');
  const secondController = rendererClock()!;
  expect(secondController).not.toBe(firstController);
  expect(() => firstController.clock.after(10, () => {})).toThrowError(/closed/i);

  window.dispatchEvent(new Event('pagehide'));
  expect(() => secondController.clock.after(10, () => {})).toThrowError(/closed/i);
});
