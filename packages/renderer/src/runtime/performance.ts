import { createStartupViewReceipts, type StartupViewReceipt } from './startup-view-receipts.ts';
import { _parseStartupPerformance } from '@apackdev/sdk/runtime';
import type { _HostBridge } from '@apackdev/sdk/fe';
import type { _RendererPerformanceResources } from '@apackdev/sdk/runtime';
import { observeRendererLongTasks } from './renderer-observations.ts';
import type { PerformanceCarrier } from '@apackdev/sdk/runtime';
import { nextTick } from 'vue';
import type { ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';
import type { createPerformanceController, RecordingMode } from '@apackdev/host/diagnostics';
import { trpc } from '@/transport';

type Controller = ReturnType<typeof createPerformanceController>;
export interface PerformanceViewDelivery { request: ViewRequest; update: ViewUpdate; generation: number; delivery: number }
function createWindowRecording() {
  let controller: Controller | undefined;
  let startupAction: ReturnType<Controller['begin']>;
  let failedListeners = 0;
  let rendererLease: string | undefined;
  let rendererResourceFailed = false;
  let longTasks: ReturnType<typeof observeRendererLongTasks> | undefined;
  const rendererBridge = () => (window.electronAPI as _HostBridge | undefined)?.performance;
  let startupViews: ReturnType<typeof createStartupViewReceipts> | undefined;
  const listeners = new Set<(delivery: PerformanceViewDelivery) => void>();

  /** Ephemeral developer callbacks; no request arguments or results enter the span recorder. */
  function notifyPerformanceView(delivery: PerformanceViewDelivery) {
    if (!controller) return;
    if (startupViews && !startupViews.record(delivery)) failedListeners++;
    for (const listener of listeners) { try { listener(delivery); } catch { failedListeners++; } }
  }

  /** Loaded only after the authenticated backend admits a development/test recording. */
  const recording = {
    notify: notifyPerformanceView,
    get execution() { return controller?.execution; },
    async start(mode: RecordingMode, options?: { startup: true; carrier?: PerformanceCarrier }) {
      let admitted = false;
      try {
        await trpc.performance.start.mutate({ mode, ...(options?.startup && { startup: true }) });
        admitted = true;
        rendererResourceFailed = false;
        if (mode !== 'disabled') {
          try {
            const bridge = rendererBridge();
            if (!bridge) throw Error('Renderer diagnostics unavailable');
            rendererLease = (await bridge.start(mode)).id;
          } catch { rendererResourceFailed = true; }
          longTasks = observeRendererLongTasks();
        }
        const { createPerformanceController, BrowserRecordingContext } = await import('@apackdev/host/diagnostics');
        const resource = createPerformanceController(() => new BrowserRecordingContext());
        resource.start(mode);
        failedListeners = 0;
        controller = resource;
        if (options?.startup) startupAction = resource.execution.withCarrier(options.carrier, () => resource.begin('app.startup', { 'app.process': 'renderer' }));
        startupViews = startupAction ? createStartupViewReceipts() : undefined;
      } catch (error) {
        startupAction?.end('error');
        if (controller) await controller.stop().catch(() => {});
        controller = undefined;
        if (rendererLease) await rendererBridge()?.stop(rendererLease).catch(() => {});
        rendererLease = undefined; longTasks?.stop(); longTasks = undefined;
        if (admitted) await trpc.performance.stop.mutate().catch(() => {});
        throw error;
      }
    },
    lastStartupView(ref: string, view: string): StartupViewReceipt | undefined {
      return startupViews?.last(ref, view);
    },
    withinStartup<T>(fn: () => T): T { return startupAction ? startupAction.within(fn) : fn(); },
    begin(name: string, attributes?: Parameters<Controller['begin']>[1]) {
      if (!controller) throw new Error('No window performance recording is active');
      return controller.begin(name, attributes)!;
    },
    onView(listener: (delivery: PerformanceViewDelivery) => void) {
      if (!controller) throw new Error('No window performance recording is active');
      if (listeners.size >= 32) throw new Error('Too many performance view listeners');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async stop() {
      const resource = controller;
      if (!resource) throw new Error('No window performance recording is active');
      startupAction?.end();
      startupAction = undefined;
      controller = undefined;
      listeners.clear();
      startupViews = undefined;
      // Both owners are stopped even if the socket was lost. A failed report remains a failed trial.
      const lease = rendererLease; rendererLease = undefined;
      const [renderer, backend, resources] = await Promise.allSettled([resource.stop(), trpc.performance.stop.mutate(),
        lease ? Promise.resolve().then(() => {
          const bridge = rendererBridge();
          if (!bridge) throw Error('Renderer diagnostic bridge was lost');
          return bridge.stop(lease);
        }) : Promise.resolve(undefined)]);
      const stalls = longTasks?.stop(); longTasks = undefined;
      const captured: _RendererPerformanceResources | undefined = resources.status === 'fulfilled' ? resources.value : undefined;
      if (renderer.status === 'fulfilled') {
        if (captured) Object.assign(renderer.value, { rendererStatistics: captured.statistics, profiles: captured.profiles, profileFailures: captured.profileFailures });
        if (stalls) renderer.value.rendererLongTasks = stalls;
        if (rendererResourceFailed || resources.status === 'rejected') renderer.value.rendererResourceFailures = 1;
        if (failedListeners) renderer.value.rendererListenerFailures = failedListeners;
        renderer.value.complete &&= !rendererResourceFailed && resources.status === 'fulfilled' && (!captured || captured.complete) && (!stalls || stalls.failures === 0) && failedListeners === 0;
      }
      return {
        renderer: renderer.status === 'fulfilled' ? renderer.value : undefined,
        backend: backend.status === 'fulfilled' ? backend.value : undefined,
        complete: renderer.status === 'fulfilled' && backend.status === 'fulfilled' && renderer.value.complete && backend.value.complete && failedListeners === 0,
        failedListeners,
        failures: [renderer.status === 'rejected' && 'renderer-stop', backend.status === 'rejected' && 'backend-stop', resources.status === 'rejected' && 'renderer-resource-stop', rendererResourceFailed && 'renderer-resource-start'].filter(Boolean),
      };
    },
  };

  return recording;
}

type WindowRecording = ReturnType<typeof createWindowRecording>;
interface RecordingLifetime { phase: 'starting' | 'active' | 'stopping'; recording: WindowRecording }
let lifetime: RecordingLifetime | undefined;
function activeRecording(): WindowRecording {
  if (lifetime?.phase !== 'active') throw new Error('No window performance recording is active');
  return lifetime.recording;
}

/** One window owns one recording lifetime, including admission and asynchronous teardown. */
export const windowPerformance = {
  flushView: () => nextTick(),
  get execution() { return lifetime?.phase === 'active' ? lifetime.recording.execution : undefined; },
  async start(mode: RecordingMode, options?: { startup: true; carrier?: PerformanceCarrier }) {
    if (lifetime) throw new Error('A window performance recording is already active, starting or stopping');
    const claim: RecordingLifetime = { phase: 'starting', recording: createWindowRecording() };
    lifetime = claim;
    try { await claim.recording.start(mode, options); claim.phase = 'active'; }
    catch (error) { lifetime = undefined; throw error; }
  },
  async stop() {
    const recording = activeRecording();
    lifetime!.phase = 'stopping';
    try { return await recording.stop(); }
    finally { lifetime = undefined; }
  },
  begin(name: string, attributes?: Parameters<Controller['begin']>[1]) { return activeRecording().begin(name, attributes); },
  onView(listener: (delivery: PerformanceViewDelivery) => void) { return activeRecording().onView(listener); },
  withinStartup<T>(run: () => T): T { return lifetime?.phase === 'active' ? lifetime.recording.withinStartup(run) : run(); },
  lastStartupView(ref: string, view: string): StartupViewReceipt | undefined {
    return lifetime?.phase === 'active' ? lifetime.recording.lastStartupView(ref, view) : undefined;
  },
};

export function notifyPerformanceView(delivery: PerformanceViewDelivery) {
  if (lifetime?.phase === 'active') lifetime.recording.notify(delivery);
}

/** Main supplies this test-only launch configuration before the application actor or views start. */
export async function startStartupRecording(input: string | null): Promise<void> {
  if (input === null) return;
  const config = _parseStartupPerformance(input);
  await windowPerformance.start(config.mode, { startup: true, carrier: config.carrier });
}
