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
