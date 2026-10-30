// Frontend-safe recording composition. Node composition supplies AsyncLocalStorageContextManager.
export { createPerformanceController } from './controller.ts';
export { BrowserRecordingContext } from './browser-context.ts';
export type { RecordingMode, PerformanceRecordingReport, PerformanceProcessStatistics } from './session.ts';
export type { PerformanceProfiles } from './profiles.ts';
