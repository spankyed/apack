import type { EarsAdmin } from '@apackdev/ears';
import type { PerformanceExecution } from '@apackdev/sdk/runtime';
import type { ContextManager } from '@opentelemetry/api';
import { createTraceSession, type RecordingMode } from './session.ts';
import { PROFILE_BYTES } from './profiles.ts';

export const APPLICATION_SPAN_NAMES = new Set([
  'app.thread.open', 'app.terminal.open', 'app.terminal.resize', 'app.reply.stream', 'app.search', 'app.startup',
  'app.dispatch', 'app.view.read', 'app.view.deliver', 'app.view.ready', 'app.index.admission',
  'app.surface.send',
]);
export const APPLICATION_SPAN_ATTRIBUTES = new Set([
  'app.scenario', 'app.fixture', 'app.generation', 'app.delivery', 'app.commit',
  'app.result_count', 'app.chunk', 'app.process', 'app.coalesced_commits', 'app.unattributed_commits', 'app.dropped_causes',
  'app.event', 'app.target', 'app.bytes',
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
    // An observation with a size rather than a duration is a span that begins and ends at once; the session
    // already bounds, filters and counts these, so there is nothing else for an instant to need.
    // Asked before the thunk is called, because computing an attribute can cost more than the observation
    // is worth: `app.surface.send` serialises the message to size it, on a path that runs per streamed token
    record: (name, attributes) => {
      if (!recording?.isRecording()) return;
      recording.begin(name, attributes?.())?.end();
    },
  };
  return {
    execution,
    attach(engine: Engine, database: 'app' | 'runHistory') {
      engines.set(database, engine);
      recording?.attach(engine, database);
    },
    start(mode: RecordingMode) {
      if (recording || stopping) throw new Error('A performance recording is already active or stopping');
      const limits = mode === 'detailed' ? { observations: 10_000, bytes: 16 * 1024 * 1024 - PROFILE_BYTES } : undefined;
      const session = createTraceSession({ mode, limits, contextManager, names: APPLICATION_SPAN_NAMES, attributes: APPLICATION_SPAN_ATTRIBUTES });
      try {
        for (const [database, engine] of engines) session.attach(engine, database);
      } catch (error) {
        stopping = session.stop().finally(() => { stopping = undefined; });
        throw error;
      }
      recording = session;
    },
    isRecording: () => recording?.isRecording() ?? false,
    begin: (name: string, attributes?: Parameters<Session['begin']>[1], causes?: Parameters<Session['begin']>[2]) => recording?.begin(name, attributes, causes),
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
