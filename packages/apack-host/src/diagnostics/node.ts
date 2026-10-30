import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { createPerformanceController } from './controller.ts';
import { createProcessStatistics } from './process-statistics.ts';
import { createNodeProfiles } from './node-profiles.ts';
import type { PerformanceRecordingReport, PerformanceProcessStatistics, RecordingMode } from './session.ts';

/** One async context owner per recording, never registered as the global OpenTelemetry provider. */
export function createNodePerformanceController() {
  const controller = createPerformanceController(() => new AsyncLocalStorageContextManager());
  let statistics: ReturnType<typeof createProcessStatistics> | undefined;
  let profiles: ReturnType<typeof createNodeProfiles> | undefined;
  let profileStartFailed = false;
  let stopping: Promise<PerformanceRecordingReport> | undefined;
  return {
    ...controller,
    start(mode: RecordingMode) {
      if (stopping) throw Error('A performance recording is still stopping');
      controller.start(mode);
      try { if (mode !== 'disabled') statistics = createProcessStatistics(); }
      catch (error) { void controller.stop().catch(() => {}); throw error; }
      profileStartFailed = false;
      if (mode === 'detailed') {
        try { profiles = createNodeProfiles(); } catch { profileStartFailed = true; }
      }
    },
    ready: () => profiles?.ready ?? Promise.resolve(),
    stop(): Promise<PerformanceRecordingReport> {
      if (stopping) return stopping;
      const report = controller.stop();
      let processStatistics: PerformanceProcessStatistics | undefined;
      let processStatisticsFailures = 0;
      try {
        processStatistics = statistics?.stop();
        processStatisticsFailures = processStatistics?.samplingFailures ?? 0;
      } catch { processStatisticsFailures++; }
      statistics = undefined;
      const profile = profiles;
      profiles = undefined;
      const startFailed = profileStartFailed;
      stopping = (async () => {
        const [traceResult, profileResult] = await Promise.allSettled([report, profile?.stop()]);
        if (traceResult.status === 'rejected') throw traceResult.reason;
        const value = traceResult.value;
        const captured = profileResult.status === 'fulfilled' ? profileResult.value : undefined;
        const profileFailures = (startFailed ? 1 : 0) + (profileResult.status === 'rejected' ? 1 : captured?.failures ?? 0);
        return { ...value, ...(processStatistics && { processStatistics }), ...(captured && { profiles: captured }),
          ...(profileFailures && { profileFailures }),
          ...(processStatisticsFailures && { processStatisticsFailures }),
          complete: value.complete && processStatisticsFailures === 0 && profileFailures === 0 && (!captured || captured.complete) };
      })()
        .finally(() => { stopping = undefined; });
      return stopping;
    },
  };
}
