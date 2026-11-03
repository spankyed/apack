import { _performanceCarrier, _withPerformanceCarrier } from '@apackdev/sdk/runtime';
import type { ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';
import { notifyPerformanceView } from './performance.ts';

/** A logical view survives reconnects; only its first subscription may inherit the original request's cause. */
export function createViewTransportObservation(request: ViewRequest) {
  const { diagnostics: requested, ...plain } = request;
  let first = true;
  return {
    subscribe(generation: number) {
      const carrier = _performanceCarrier(first ? requested : undefined);
      first = false;
      let delivered = 0;
      return {
        request: carrier?.traceparent ? { ...plain, diagnostics: carrier } : plain,
        receive(update: ViewUpdate, observe: (update: ViewUpdate) => void) {
          _withPerformanceCarrier(update.diagnostics?.carrier, () => {
            observe(update);
            notifyPerformanceView({ request: plain, update, generation, delivery: ++delivered });
          });
        },
        error<T>(receive: () => T): T { return _withPerformanceCarrier(carrier, receive); },
      };
    },
  };
}
