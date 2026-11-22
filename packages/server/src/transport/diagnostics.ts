import { _performanceExecution } from '@apackdev/sdk/runtime';
import { newCall } from '@apackdev/sdk/events';
import type { ViewUpdate } from '@apackdev/sdk/framework';
import { z } from 'zod';

/** Preserve only a bounded invalid marker on malformed input, so recording reports loss without refusing application work. */
export const diagnosticCarrier = z.object({
  traceparent: z.string().max(512).optional(),
  tracestate: z.string().max(512).optional(),
}).optional().catch({ traceparent: '' });

/** One wire subscription's context and receipt sequence, never part of the shared view's key. */
export function createViewSubscriptionDiagnostics(input: unknown) {
  const execution = _performanceExecution();
  const subscription = newCall();
  let delivery = 0;
  return {
    within<T>(subscribe: () => T): T { return execution ? execution.withCarrier(input, subscribe) : subscribe(); },
    update(update: ViewUpdate): ViewUpdate {
      const carrier = execution?.capture();
      return carrier?.traceparent ? { ...update, diagnostics: { subscription, carrier, delivery: ++delivery } } : update;
    },
  };
}
