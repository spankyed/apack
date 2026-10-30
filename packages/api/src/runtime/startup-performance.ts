import type { AppEnv } from '@apackdev/sdk/env';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
import type { RecordingMode } from '@apackdev/host/diagnostics';
import { z } from 'zod';

const configuration = z.object({
  mode: z.enum(['disabled', 'lightweight', 'detailed']),
  carrier: z.object({ traceparent: z.string().max(512).optional(), tracestate: z.string().max(512).optional() }).strict().optional(),
}).strict();

/** Starts before store/index/pack admission; the first authenticated window explicitly adopts it. */
export function createStartupPerformance(env: AppEnv, input: string | undefined) {
  if (input === undefined) return undefined;
  if (env !== 'test') throw new Error('Startup qualification requires the test environment');
  if (input.length > 2048) throw new Error('Startup recording configuration is too large');
  const config = configuration.parse(JSON.parse(input));
  const controller = createNodePerformanceController();
  controller.start(config.mode);
  let span = controller.execution.withCarrier(config.carrier, () => controller.begin('app.startup', { 'app.process': 'backend' }));
  let available = true;
  return {
    controller,
    run<T>(fn: () => T): T { return span ? span.within(fn) : fn(); },
    finish(outcome: 'ok' | 'error' = 'ok') { span?.end(outcome); span = undefined; },
    adopt(mode: RecordingMode) {
      if (!available || mode !== config.mode) throw new Error('No matching startup recording is available');
      available = false;
    },
  };
}
