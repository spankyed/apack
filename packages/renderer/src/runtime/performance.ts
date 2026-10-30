import { nextTick } from 'vue';
import type { ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';
import type { createPerformanceController, RecordingMode } from '@apackdev/host/diagnostics';
import { trpc } from '@/transport';

type Controller = ReturnType<typeof createPerformanceController>;
let controller: Controller | undefined;
let starting = false;
let stopping = false;
let failedListeners = 0;
export interface PerformanceViewDelivery { request: ViewRequest; update: ViewUpdate; generation: number; delivery: number }
const listeners = new Set<(delivery: PerformanceViewDelivery) => void>();

/** Ephemeral developer callbacks; no request arguments or results enter the span recorder. */
export function notifyPerformanceView(delivery: PerformanceViewDelivery) {
  if (!controller) return;
  for (const listener of listeners) { try { listener(delivery); } catch { failedListeners++; } }
}

/** Loaded only after the authenticated backend admits a development/test recording. */
export const windowPerformance = {
  flushView: () => nextTick(),
  get execution() { return controller?.execution; },
  async start(mode: RecordingMode) {
    if (controller || starting || stopping) throw new Error('A window performance recording is already active, starting or stopping');
    starting = true;
    let admitted = false;
    try {
      await trpc.performance.start.mutate({ mode });
      admitted = true;
      const { createPerformanceController, BrowserRecordingContext } = await import('@apackdev/host/diagnostics');
      const resource = createPerformanceController(() => new BrowserRecordingContext());
      resource.start(mode);
      failedListeners = 0;
      controller = resource;
    } catch (error) {
      if (admitted) await trpc.performance.stop.mutate().catch(() => {});
      throw error;
    } finally { starting = false; }
  },
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
    controller = undefined;
    stopping = true;
    listeners.clear();
    // Both owners are stopped even if the socket was lost. A failed report remains a failed trial.
    try {
      const [renderer, backend] = await Promise.allSettled([resource.stop(), trpc.performance.stop.mutate()]);
      return {
        renderer: renderer.status === 'fulfilled' ? renderer.value : undefined,
        backend: backend.status === 'fulfilled' ? backend.value : undefined,
        complete: renderer.status === 'fulfilled' && backend.status === 'fulfilled' && renderer.value.complete && backend.value.complete && failedListeners === 0,
        failedListeners,
        failures: [renderer.status === 'rejected' && 'renderer-stop', backend.status === 'rejected' && 'backend-stop'].filter(Boolean),
      };
    } finally { stopping = false; }
  },
};
