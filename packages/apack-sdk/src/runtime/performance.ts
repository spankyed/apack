import { _isHostBound, boundHost } from './host-runtime.ts';
import { _isFeHostBound, boundFeHost } from './fe-host.ts';

/** Standard trace context only; never stored alongside business data. */
export interface PerformanceCarrier { traceparent?: string; tracestate?: string }

/** Execution context owned by a development recording, separate from message return addresses. */
export interface PerformanceExecution {
  capture(): PerformanceCarrier;
  withCarrier<T>(carrier: unknown, fn: () => T): T;
  carryEvent(event: object, carrier: unknown): void;
  withEvent<T>(event: object, fn: () => T): T;
}

/** @internal The currently bound process/window resource, absent when recording is unavailable. */
export function _performanceExecution(): PerformanceExecution | undefined {
  if (_isFeHostBound()) return boundFeHost().diagnostics;
  if (_isHostBound()) return boundHost().diagnostics?.performance;
  return undefined;
}

/** @internal Portable diagnostic data shared by app processes. */
export interface _PerformanceProfiles {
  sampling: { cpuIntervalMicros: number; allocationIntervalBytes: number; allocationStackDepth: number; includeCollectedAllocations: boolean };
  cpu?: string;
  allocation?: string;
  bytes: number;
  failures: number;
  complete: boolean;
  windowLimitMs: number;
  durationMs: number;
  stoppedBy: 'owner' | 'limit';
}


/** @internal Renderer process observations, separate from action attribution. */
export interface _RendererPerformanceStatistics {
  source: 'chromium-cdp';
  pid: number;
  metrics: Array<{ name: string; unit: 'seconds' | 'bytes' | 'count'; before: number; after: number }>;
  unavailable: string[];
  failures: number;
}

/** @internal The window-owned main/preload recording result. */
export interface _RendererPerformanceResources {
  statistics: _RendererPerformanceStatistics;
  profiles?: _PerformanceProfiles;
  profileFailures: number;
  complete: boolean;
}
