import type { WatchReadContext } from '@apackdev/ears';
import type { PerformanceCarrier } from '@apackdev/sdk/runtime';
import type { ViewObservation } from '../views/index.ts';
import type { createPerformanceController } from './controller.ts';

/** Each watch owns its read-to-delivery context; subsequent reads link commits without borrowing an action parent. */
export function createViewObservation(recording: Pick<ReturnType<typeof createPerformanceController>, 'begin' | 'execution' | 'isRecording'>): ViewObservation {
  let first = true;
  let carrier: PerformanceCarrier | undefined;
  function read<T>(run: () => T, causes?: WatchReadContext): T {
    const span = recording.begin('app.view.read', {}, causes && { database: 'app', ...causes });
    carrier = span?.carrier();
    try {
      const value = span ? span.within(run) : run();
      span?.end();
      return value;
    } catch (error) { span?.end('error'); throw error; }
  }
  return {
    read(run, causes) {
      const initial = first;
      first = false;
      return initial ? read(run, causes) : recording.execution.withCarrier(undefined, () => read(run, causes));
    },
    deliver(commit, run) {
      return recording.execution.withCarrier(carrier, () => {
        const span = recording.begin('app.view.deliver', { 'app.commit': commit });
        try { return span ? span.within(run) : run(); }
        catch (error) { span?.end('error'); throw error; }
        finally { span?.end(); }
      });
    },
    recordCauses: recording.isRecording,
  };
}
