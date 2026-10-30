import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { createPerformanceController } from './controller.ts';

/** One async context owner per recording, never registered as the global OpenTelemetry provider. */
export function createNodePerformanceController() {
  return createPerformanceController(() => new AsyncLocalStorageContextManager());
}
