import { z } from 'zod';
import type { _HostBridge } from '@apackdev/sdk/fe';
import type { _RendererPerformanceResources } from '@apackdev/sdk/runtime';
import { observeRendererLongTasks } from './renderer-observations.ts';
import type { PerformanceCarrier } from '@apackdev/sdk/runtime';
import { nextTick } from 'vue';
import type { ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';
import type { createPerformanceController, RecordingMode } from '@apackdev/host/diagnostics';
import { trpc } from '@/transport';

type Controller = ReturnType<typeof createPerformanceController>;
let controller: Controller | undefined;
let startupAction: ReturnType<Controller['begin']>;
let starting = false;
let stopping = false;
let failedListeners = 0;
let rendererLease: string | undefined;
let rendererResourceFailed = false;
let longTasks: ReturnType<typeof observeRendererLongTasks> | undefined;
const rendererBridge = () => (window.electronAPI as _HostBridge | undefined)?.performance;
export interface PerformanceViewDelivery { request: ViewRequest; update: ViewUpdate; generation: number; delivery: number }
interface StartupViewReceipt { entityId?: string; commit: number; subscription?: string; delivery?: number; ok: boolean }
const startupViews = new Map<string, StartupViewReceipt>();
const listeners = new Set<(delivery: PerformanceViewDelivery) => void>();

/** Ephemeral developer callbacks; no request arguments or results enter the span recorder. */
export function notifyPerformanceView(delivery: PerformanceViewDelivery) {
  if (!controller) return;
  const chatId = delivery.request.view === 'chat' && typeof delivery.request.args === 'object' && delivery.request.args !== null
    ? (delivery.request.args as { threadId?: unknown }).threadId : undefined;
  if (startupAction && (delivery.request.args === undefined || typeof chatId === 'string' && chatId.length <= 128)) {
    const { ref, view } = delivery.request;
    const key = `${ref}\0${view}`;
    if (ref.length > 128 || view.length > 128 || !startupViews.has(key) && startupViews.size >= 32) failedListeners++;
    else startupViews.set(key, { ...(typeof chatId === 'string' && { entityId: chatId }), ok: delivery.update.ok, commit: delivery.update.commit,
      subscription: delivery.update.diagnostics?.subscription, delivery: delivery.update.diagnostics?.delivery });
  }
  for (const listener of listeners) { try { listener(delivery); } catch { failedListeners++; } }
}

/** Loaded only after the authenticated backend admits a development/test recording. */
export const windowPerformance = {
  flushView: () => nextTick(),
  get execution() { return controller?.execution; },
  async start(mode: RecordingMode, options?: { startup: true; carrier?: PerformanceCarrier }) {
    if (controller || starting || stopping) throw new Error('A window performance recording is already active, starting or stopping');
    starting = true;
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
      startupViews.clear();
      controller = resource;
      if (options?.startup) startupAction = resource.execution.withCarrier(options.carrier, () => resource.begin('app.startup', { 'app.process': 'renderer' }));
    } catch (error) {
      if (rendererLease) await rendererBridge()?.stop(rendererLease).catch(() => {});
      rendererLease = undefined; longTasks?.stop(); longTasks = undefined;
      if (admitted) await trpc.performance.stop.mutate().catch(() => {});
      throw error;
    } finally { starting = false; }
  },
  lastStartupView(ref: string, view: string): StartupViewReceipt | undefined {
    const receipt = startupViews.get(`${ref}\0${view}`);
    return receipt && { ...receipt };
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
    stopping = true;
    listeners.clear();
    startupViews.clear();
    // Both owners are stopped even if the socket was lost. A failed report remains a failed trial.
    try {
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
    } finally { stopping = false; }
  },
};

/** Main supplies this test-only launch configuration before the application actor or views start. */
export async function startStartupRecording(input: string | null): Promise<void> {
  if (input === null) return;
  if (input.length > 2048) throw new Error('Startup recording configuration is too large');
  const config = z.object({ mode: z.enum(['disabled', 'lightweight', 'detailed']),
    carrier: z.object({ traceparent: z.string().max(512).optional(), tracestate: z.string().max(512).optional() }).strict().optional(),
  }).strict().parse(JSON.parse(input));
  await windowPerformance.start(config.mode, { startup: true, carrier: config.carrier });
}
