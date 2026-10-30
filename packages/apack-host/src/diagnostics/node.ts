import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { createPerformanceController } from './controller.ts';
import { createProcessStatistics } from './process-statistics.ts';
import type { PerformanceRecordingReport, PerformanceProcessStatistics, RecordingMode } from './session.ts';

/** One async context owner per recording, never registered as the global OpenTelemetry provider. */
export function createNodePerformanceController() {
  const controller = createPerformanceController(() => new AsyncLocalStorageContextManager());
  let statistics: ReturnType<typeof createProcessStatistics> | undefined;
  let stopping: Promise<PerformanceRecordingReport> | undefined;
  return {
    ...controller,
    start(mode: RecordingMode) {
      if (stopping) throw Error('A performance recording is still stopping');
      controller.start(mode);
      try { if (mode !== 'disabled') statistics = createProcessStatistics(); }
      catch (error) { void controller.stop().catch(() => {}); throw error; }
    },
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
      stopping = report.then(value => ({ ...value, ...(processStatistics && { processStatistics }),
        ...(processStatisticsFailures && { processStatisticsFailures }), complete: value.complete && processStatisticsFailures === 0 }))
        .finally(() => { stopping = undefined; });
      return stopping;
    },
  };
}
