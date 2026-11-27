import { _performanceExecution } from '@apackdev/sdk/runtime';
import { newCall } from '@apackdev/sdk/events';
import type { ViewUpdate } from '@apackdev/sdk/framework';

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
