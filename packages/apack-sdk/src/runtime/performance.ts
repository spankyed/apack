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

/** @internal Use an explicit cause when supplied; otherwise capture the current execution. */
export function _performanceCarrier(carrier?: PerformanceCarrier): PerformanceCarrier | undefined {
  return carrier ?? _performanceExecution()?.capture();
}

/** @internal Diagnostic envelopes never alter business payloads or allocate a copy while idle. */
export function _performanceEnvelope<T extends object>(envelope: T): T {
  const carrier = _performanceCarrier();
  return carrier?.traceparent ? { ...envelope, diagnostics: carrier } : envelope;
}

/** @internal Restore context at a process or transport boundary, including an explicitly absent cause. */
export function _withPerformanceCarrier<T>(carrier: unknown, run: () => T): T {
  const execution = _performanceExecution();
  return execution ? execution.withCarrier(carrier, run) : run();
}

/** @internal Associate a queued event without changing its business fields. */
export function _carryPerformanceEvent(event: object, carrier: unknown): void {
  _performanceExecution()?.carryEvent(event, carrier);
}

/** @internal Restore a queued event's cause when its handler runs. */
export function _withPerformanceEvent<T>(event: unknown, run: () => T): T {
  const execution = _performanceExecution();
  return execution && typeof event === 'object' && event !== null ? execution.withEvent(event, run) : run();
}

/** @internal Carry and restore a delivered event under one execution owner. */
export function _withPerformanceDelivery<T>(event: object, carrier: unknown, run: () => T): T {
  const execution = _performanceExecution();
  if (!execution) return run();
  execution.carryEvent(event, carrier);
  return execution.withEvent(event, run);
}

/** @internal Portable diagnostic data shared by app processes. */
export interface _PerformanceProfiles {
  sampling: { cpuIntervalMicros: number; allocationIntervalBytes: number; allocationStackDepth: number; includeCollectedAllocations: boolean };
  cpu?: string;
  allocation?: string;
  bytes: number;
  failures: number;
  failureStages?: string[];
  encodedBytes?: { cpu?: number; allocation?: number };
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
