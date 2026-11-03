/** Aggregate entries only: attribution URLs and DOM payloads never enter diagnostics. */
export function observeRendererLongTasks() {
  const started = performance.now();
  let supported = false;
  let count = 0; let totalMs = 0; let maxMs = 0; let failures = 0;
  let observer: PerformanceObserver | undefined;
  const collect = (entries: readonly PerformanceEntry[]) => {
    for (const entry of entries) {
      if (entry.startTime < started) continue;
      if (!Number.isFinite(entry.duration) || entry.duration < 0) { failures++; continue; }
      count++; totalMs += entry.duration; maxMs = Math.max(maxMs, entry.duration);
    }
  };
  try { supported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask'); } catch { failures++; }
  if (supported) try {
    observer = new PerformanceObserver(list => { try { collect(list.getEntries()); } catch { failures++; } });
    observer.observe({ entryTypes: ['longtask'] });
  } catch { failures++; }
  let result: { supported: boolean; count: number; totalMs: number; maxMs: number; failures: number } | undefined;
  return { stop() {
    if (!result) {
      if (observer) {
        try { collect(observer.takeRecords()); } catch { failures++; }
        finally { try { observer.disconnect(); } catch { failures++; } }
      }
      result = { supported, count, totalMs, maxMs, failures };
    }
    return result;
  } };
}
