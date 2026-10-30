import type { EarsAdmin } from '@apackdev/ears';
import type { PerformanceExecution } from '@apackdev/sdk/runtime';
import type { ContextManager } from '@opentelemetry/api';
import { createTraceSession, type RecordingMode } from './session.ts';

export const APPLICATION_SPAN_NAMES = new Set([
  'app.thread.open', 'app.reply.stream', 'app.search', 'app.startup',
  'app.dispatch', 'app.view.read', 'app.view.deliver', 'app.view.ready', 'app.index.admission',
]);
export const APPLICATION_SPAN_ATTRIBUTES = new Set([
  'app.scenario', 'app.fixture', 'app.generation', 'app.delivery', 'app.commit',
  'app.result_count', 'app.chunk', 'app.process',
]);

type Session = ReturnType<typeof createTraceSession>;
type Engine = { admin: Pick<EarsAdmin, 'observe'> };

/** Stable runtime port; an idle controller creates neither a provider nor a context manager. */
export function createPerformanceController(contextManager: () => ContextManager) {
  let recording: Session | undefined;
  let stopping: Promise<Awaited<ReturnType<Session['stop']>>> | undefined;
  const engines = new Map<'app' | 'runHistory', Engine>();
  const execution: PerformanceExecution = {
    capture: () => recording?.capture() ?? {},
    withCarrier: (carrier, fn) => recording ? recording.withCarrier(carrier, fn) : fn(),
    carryEvent: (event, carrier) => recording?.carryEvent(event, carrier),
    withEvent: (event, fn) => recording ? recording.withEvent(event, fn) : fn(),
  };
  return {
    execution,
    attach(engine: Engine, database: 'app' | 'runHistory') {
      engines.set(database, engine);
      recording?.attach(engine, database);
    },
    start(mode: RecordingMode) {
      if (recording || stopping) throw new Error('A performance recording is already active or stopping');
      const session = createTraceSession({ mode, contextManager, names: APPLICATION_SPAN_NAMES, attributes: APPLICATION_SPAN_ATTRIBUTES });
      try {
        for (const [database, engine] of engines) session.attach(engine, database);
      } catch (error) {
        stopping = session.stop().finally(() => { stopping = undefined; });
        throw error;
      }
      recording = session;
    },
    begin: (name: string, attributes?: Parameters<Session['begin']>[1]) => recording?.begin(name, attributes),
    snapshot: () => recording?.snapshot(),
    stop() {
      if (stopping) return stopping;
      const session = recording;
      if (!session) throw new Error('No performance recording is active');
      recording = undefined;
      stopping = session.stop().finally(() => { stopping = undefined; });
      return stopping;
    },
  };
}
