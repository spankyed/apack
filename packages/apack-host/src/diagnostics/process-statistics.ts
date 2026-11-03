import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import type { PerformanceProcessStatistics } from './session.ts';

/** Aggregate-only sampler: constant memory, no paths, stacks, payloads or per-action attribution. */
export function createProcessStatistics() {
  const started = performance.now();
  const cpu = process.cpuUsage();
  const initial = process.memoryUsage();
  const utilization = performance.eventLoopUtilization();
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let rssMax = initial.rss;
  let heapMax = initial.heapUsed;
  let gcCount = 0;
  let gcDurationMs = 0;
  let tickedAt = started;
  let lateTickMaxMs = 0;
  let samplingFailures = 0;
  let result: PerformanceProcessStatistics | undefined;
  const collectGc = (entries: readonly { duration: number }[]) => {
    gcCount += entries.length;
    for (const entry of entries) gcDurationMs += entry.duration;
  };
  const observer = new PerformanceObserver(list => collectGc(list.getEntries()));
  observer.observe({ entryTypes: ['gc'] });
  // As in the loop-measurement tool, retain timer lateness alongside the histogram, which
  // can miss a block when stopped before the loop gets another turn. These are distinct observations.
  const timer = setInterval(() => {
    const now = performance.now();
    lateTickMaxMs = Math.max(lateTickMaxMs, now - tickedAt - 1000);
    tickedAt = now;
    try {
      const memory = process.memoryUsage();
      rssMax = Math.max(rssMax, memory.rss);
      heapMax = Math.max(heapMax, memory.heapUsed);
    } catch { samplingFailures++; }
  }, 1000);
  timer.unref();
  return {
    stop(): PerformanceProcessStatistics {
      if (result) return result;
      clearInterval(timer);
      collectGc(observer.takeRecords());
      observer.disconnect();
      histogram.disable();
      const elapsed = performance.now();
      const memory = process.memoryUsage();
      const used = process.cpuUsage(cpu);
      result = {
        samplingFailures,
        durationMs: elapsed - started, cpuUserMicros: used.user, cpuSystemMicros: used.system,
        rssStartBytes: initial.rss, rssEndBytes: memory.rss, rssSampledMaxBytes: Math.max(rssMax, memory.rss),
        heapStartBytes: initial.heapUsed, heapEndBytes: memory.heapUsed, heapSampledMaxBytes: Math.max(heapMax, memory.heapUsed),
        gcCount, gcDurationMs, eventLoopUtilization: performance.eventLoopUtilization(utilization).utilization,
        eventLoopHistogramMaxMs: histogram.max / 1e6,
        eventLoopLateTickMaxMs: Math.max(lateTickMaxMs, elapsed - tickedAt - 1000, 0),
      };
      return result;
    },
  };
}
