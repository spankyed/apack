export { performanceIdentity, rendererProcessId, attachRendererProcessIdentity } from './performance/identity.ts';
export { assertComparable, chromeTrace, comparisonOrder, manifestSchema, processReportSchema, spanSchema, streamingBacklog, summarize, trialSchema, type PerformanceManifest, type PerformanceTrial } from './performance/report.ts';

export { createPerformanceRunStore, readPerformanceRun, PERFORMANCE_RUN_BYTES, PERFORMANCE_TRIAL_BYTES, type PerformanceInvocation } from './performance/run.ts';

export { createPerformanceScenarioRun, performanceSchedule, readPerformanceModeComparison, type PerformanceScheduleEntry, type PerformanceVariant } from './performance/comparison.ts';

export { performanceExecutionPolicy, waitForPerformanceTrial, finishPerformanceTrial } from './performance/gate.ts';
export { createPerformanceRevisionJournal, performanceRevisionSchedule, readPerformanceRevisionComparison } from './performance/comparison.ts';

export { coordinatePerformanceRevisions, type PerformanceRevisionWorkers } from './performance/revision.ts';
