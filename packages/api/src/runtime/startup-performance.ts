import type { AppEnv } from '@apackdev/sdk/env';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
import type { RecordingMode } from '@apackdev/host/diagnostics';
import { _parseStartupPerformance } from '@apackdev/sdk/runtime';

/** Starts before store/index/pack admission; the first authenticated window explicitly adopts it. */
export function createStartupPerformance(env: AppEnv, input: string | undefined) {
  if (input === undefined) return undefined;
  if (env !== 'test') throw new Error('Startup qualification requires the test environment');
  const config = _parseStartupPerformance(input);
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

/** Admission is a startup observation; pack loading keeps its own result and original error. */
export function observeIndexAdmission<T>(recording: Pick<ReturnType<typeof createNodePerformanceController>, 'begin'> | undefined, load: () => T): T {
  const span = recording?.begin('app.index.admission', { 'app.process': 'backend' });
  try { return span ? span.within(load) : load(); }
  catch (error) { span?.end('error'); throw error; }
  finally { span?.end(); }
}
