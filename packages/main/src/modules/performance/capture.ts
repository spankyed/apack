import { createPerformanceProfiles, type PerformanceProfileTransport } from '@apackdev/host/diagnostics/node';
import type { _RendererPerformanceResources } from '@apackdev/sdk/runtime';

const METRICS = {
  TaskDuration: 'seconds', ScriptDuration: 'seconds', LayoutDuration: 'seconds', RecalcStyleDuration: 'seconds',
  JSHeapUsedSize: 'bytes', JSHeapTotalSize: 'bytes', LayoutCount: 'count', Nodes: 'count',
} as const;

/** One renderer target; profiles release their agents while the outer recording retains metrics ownership. */
export function createRendererCapture(transport: PerformanceProfileTransport & { pid: number }, mode: 'lightweight' | 'detailed', profileTransport?: PerformanceProfileTransport) {
  let failures = 0;
  let before = new Map<string, number>();
  let profiles: ReturnType<typeof createPerformanceProfiles> | undefined;
  let stopping: Promise<_RendererPerformanceResources> | undefined;
  async function post(method: string, parameters?: object): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([transport.post(method, parameters), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Renderer diagnostic timeout')), 5000); timer.unref();
      })]);
    } finally { clearTimeout(timer); }
  }
  async function metrics() {
    const response = await post('Performance.getMetrics') as { metrics?: Array<{ name: string; value: number }> };
    if (!Array.isArray(response.metrics) || response.metrics.length > 1000) throw Error('Invalid renderer metrics');
    return new Map(response.metrics.filter(metric => Object.hasOwn(METRICS, metric.name) && Number.isFinite(metric.value) && metric.value >= 0)
      .map(metric => [metric.name, metric.value]));
  }
  const ready = (async () => {
    try {
      await post('Performance.enable');
      before = await metrics();
      if (mode === 'detailed') {
        const profilePost = (method: string, parameters?: object) => profileTransport ? profileTransport.post(method, parameters) : post(method, parameters);
        profiles = createPerformanceProfiles({ post: profilePost, close: async () => {
          try {
            const results = await Promise.allSettled([profilePost('Profiler.disable'), profilePost('HeapProfiler.disable')]);
            if (results.some(result => result.status === 'rejected')) throw Error('Profiler cleanup failed');
          } finally { await profileTransport?.close(); }
        } });
        await profiles.ready;
      }
    } catch { failures++; }
  })();
  return {
    ready,
    stop(): Promise<_RendererPerformanceResources> {
      if (stopping) return stopping;
      stopping = (async () => {
        await ready;
        let after = new Map<string, number>();
        let captured: Awaited<ReturnType<NonNullable<typeof profiles>['stop']>> | undefined;
        let profileFailures = 0;
        try {
          try { after = await metrics(); } catch { failures++; }
          captured = await profiles?.stop();
          profileFailures = captured?.failures ?? (mode === 'detailed' ? 1 : 0);
        } catch { profileFailures++; }
        finally {
          try { await profileTransport?.close(); } catch { failures++; }
          try { await transport.close(); } catch { failures++; }
        }
        const unavailable: string[] = [];
        const values: _RendererPerformanceResources['statistics']['metrics'] = [];
        for (const [name, unit] of Object.entries(METRICS)) {
          const start = before.get(name); const end = after.get(name);
          if (start === undefined || end === undefined) unavailable.push(name);
          else values.push({ name, unit, before: start, after: end });
        }
        if (unavailable.includes('TaskDuration') || unavailable.includes('JSHeapUsedSize')) failures++;
        return { statistics: { source: 'chromium-cdp', pid: transport.pid, metrics: values, unavailable, failures },
          ...(captured && { profiles: captured }), profileFailures,
          complete: failures === 0 && profileFailures === 0 && (!captured || captured.complete) };
      })();
      return stopping;
    },
  };
}
