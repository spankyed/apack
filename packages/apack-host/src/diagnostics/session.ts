import type { EarsAdmin, WatchReadContext } from '@apackdev/ears';
import { ROOT_CONTEXT, SpanStatusCode, trace, type Context, type ContextManager, type Span, type SpanContext, type Attributes } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { SamplingDecision, TracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace';
import { createSpanRecording } from './spans.ts';
import { createEarsOperationObserver, EARS_SPAN_NAMES, EARS_SPAN_ATTRIBUTES } from './ears.ts';
import type { _PerformanceProfiles, _RendererPerformanceStatistics } from '@apackdev/sdk/runtime';

/** Only standard trace context crosses execution boundaries; no application payload or baggage. */
export interface TraceCarrier { traceparent?: string; tracestate?: string }
export type RecordingMode = 'disabled' | 'lightweight' | 'detailed';

/** Process totals for the recording window, never attributed to individual overlapping actions. */
export interface PerformanceProcessStatistics {
  samplingFailures: number;
  durationMs: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  rssStartBytes: number;
  rssEndBytes: number;
  rssSampledMaxBytes: number;
  heapStartBytes: number;
  heapEndBytes: number;
  heapSampledMaxBytes: number;
  gcCount: number;
  gcDurationMs: number;
  eventLoopUtilization: number;
  eventLoopHistogramMaxMs: number;
  eventLoopLateTickMaxMs: number;
}

/** Encoded process observations and capture-integrity counters, portable across the API boundary. */
export interface PerformanceRecordingReport {
  profiles?: _PerformanceProfiles;
  rendererStatistics?: _RendererPerformanceStatistics;
  rendererLongTasks?: { supported: boolean; count: number; totalMs: number; maxMs: number; failures: number };
  rendererResourceFailures?: number;
  rendererListenerFailures?: number;
  profileFailures?: number;
  processStatistics?: PerformanceProcessStatistics;
  processStatisticsFailures?: number;
  observations: readonly string[];
  bytes: number;
  dropped: number;
  truncated: boolean;
  rejected: number;
  droppedMetadata: number;
  mode: RecordingMode;
  active: number;
  unfinished: number;
  droppedStarts: number;
  invalidCarriers: number;
  detachFailures: number;
  droppedEvents: number;
  contextFailures: number;
  rejectedStarts: number;
  invalidAttributes: number;
  complete: boolean;
}


/** The composition root supplies a fresh context manager for this recording's lifetime. */
export function createTraceSession(options: {
  mode: RecordingMode;
  contextManager: () => ContextManager;
  names: ReadonlySet<string>;
  attributes: ReadonlySet<string>;
  limits?: { observations: number; bytes: number };
}) {
  const limits = options.limits ?? { observations: 10_000, bytes: 16 * 1024 * 1024 };
  const names = new Set([...options.names, ...EARS_SPAN_NAMES]);
  const attributes = new Set([...options.attributes, ...EARS_SPAN_ATTRIBUTES, 'diagnostics.outcome']);
  const recording = createSpanRecording({ names, attributes, limits });
  const active = new Map<string, Span>();
  const commits = new Map<string, SpanContext>();
  let stopped = false;
  let unfinished = 0;
  let droppedStarts = 0;
  let invalidCarriers = 0;
  let rejectedStarts = 0;
  let invalidAttributes = 0;
  let contextFailures = 0;
  let started = 0;
  let carriedEvents = 0;
  let droppedEvents = 0;
  let events = new WeakMap<object, Context>();
  let detachFailures = 0;
  const attachments = new Map<'app' | 'runHistory', () => void>();
  const manager = options.mode === 'disabled' ? undefined : options.contextManager().enable();
  const processor: SpanProcessor = {
    onStart(span) { active.set(span.spanContext().spanId, span); },
    onEnd(span) {
      active.delete(span.spanContext().spanId);
      recording.processor.onEnd(span);
    },
    forceFlush: () => recording.processor.forceFlush(),
    shutdown: () => recording.processor.shutdown(),
  };
  const provider = !manager ? undefined : new TracerProvider({
    spanProcessors: [processor],
    spanLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 128, eventCountLimit: 0, linkCountLimit: 32 },
    sampler: {
      shouldSample() {
        if (stopped) return { decision: SamplingDecision.NOT_RECORD };
        if (started >= limits.observations) {
          droppedStarts++;
          return { decision: SamplingDecision.NOT_RECORD };
        }
        started++;
        return { decision: SamplingDecision.RECORD_AND_SAMPLED };
      },
      toString: () => 'Apack bounded development recording',
    },
  });
  const tracer = provider?.getTracer('apack.performance');
  const propagator = new W3CTraceContextPropagator();
  const current = (): Context => {
    if (stopped) return ROOT_CONTEXT;
    const context = manager?.active() ?? ROOT_CONTEXT;
    const span = trace.getSpan(context);
    return span && !span.isRecording() && !span.spanContext().isRemote ? ROOT_CONTEXT : context;
  };
  const inject = (context: Context): TraceCarrier => {
    const carrier: TraceCarrier = {};
    propagator.inject(context, carrier, { set(target, key, value) {
      if (key === 'traceparent' || key === 'tracestate') target[key] = value;
    } });
    return carrier;
  };
  const extract = (input: unknown): Context => {
    if (input === undefined || input === null) return ROOT_CONTEXT;
    try {
      if (typeof input !== 'object') throw new Error('invalid carrier');
      const value = input as TraceCarrier;
      const parent = value.traceparent;
      const state = value.tracestate;
      if (parent === undefined && state === undefined && Object.keys(value).length === 0) return ROOT_CONTEXT;
      if (typeof parent !== 'string' || parent.length > 512 || state !== undefined && (typeof state !== 'string' || state.length > 512)) throw new Error('invalid carrier');
      const carrier: TraceCarrier = { traceparent: parent, ...(state !== undefined && { tracestate: state }) };
      const context = propagator.extract(ROOT_CONTEXT, carrier, {
        keys: target => Object.keys(target),
        get: (target, key) => key === 'traceparent' || key === 'tracestate' ? target[key] : undefined,
      });
      if (!trace.getSpanContext(context)) throw new Error('invalid trace parent');
      return context;
    } catch {
      invalidCarriers++;
      return ROOT_CONTEXT;
    }
  };
  const runContext = <T>(context: Context, fn: () => T): T => {
    if (!manager || stopped) return fn();
    let invoked = false;
    try { return manager.with(context, () => { invoked = true; return fn(); }); }
    catch (error) {
      if (invoked) throw error;
      contextFailures++;
      return fn();
    }
  };
  const snapshot = (): PerformanceRecordingReport => {
    const report = recording.snapshot();
    return { ...report, mode: options.mode, active: active.size, unfinished, droppedStarts, invalidCarriers, detachFailures, droppedEvents, contextFailures, rejectedStarts, invalidAttributes,
      complete: report.complete && active.size === 0 && unfinished === 0 && droppedStarts === 0 && invalidCarriers === 0 && detachFailures === 0 && droppedEvents === 0 && contextFailures === 0 && rejectedStarts === 0 && invalidAttributes === 0 };
  };
  return {
    attach(engine: { admin: Pick<EarsAdmin, 'observe'> }, database: 'app' | 'runHistory') {
      if (!tracer || stopped) return () => {};
      attachments.get(database)?.();
      for (const key of commits.keys()) if (key.startsWith(`${database}:`)) commits.delete(key);
      const unobserve = engine.admin.observe(createEarsOperationObserver(tracer, current, database, (sequence, context) => {
        const key = `${database}:${sequence}`;
        if (!commits.has(key) && commits.size >= limits.observations) { recording.dropMetadata(1); return; }
        commits.set(key, { ...context });
      }));
      let attached = true;
      const detach = () => {
        if (!attached) return;
        attached = false;
        if (attachments.get(database) === detach) attachments.delete(database);
        try { unobserve(); } catch { detachFailures++; }
      };
      attachments.set(database, detach);
      return detach;
    },
    carryEvent(event: object, carrier: unknown) {
      if (!manager || stopped) return;
      if (!events.has(event) && carriedEvents >= limits.observations) { droppedEvents++; return; }
      if (!events.has(event)) carriedEvents++;
      events.set(event, extract(carrier));
    },
    withEvent<T>(event: object, fn: () => T): T {
      const context = events.get(event);
      return context ? runContext(context, fn) : fn();
    },
    capture: (): TraceCarrier => stopped || !manager ? {} : inject(current()),
    withCarrier<T>(carrier: unknown, fn: () => T): T {
      if (!manager || stopped) return fn();
      return runContext(extract(carrier), fn);
    },
    isRecording: () => !stopped && tracer !== undefined,
    begin(name: string, supplied: Attributes = {}, causes?: WatchReadContext & { database: 'app' | 'runHistory' }) {
      const selected: Attributes = {};
      if (tracer && !stopped) {
        for (const key of attributes) {
          try {
            const value = supplied[key];
            if (value === undefined) continue;
            if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
              || typeof value === 'string' && value.length <= 128) selected[key] = value;
            else invalidAttributes++;
          } catch { invalidAttributes++; }
        }
        if (!names.has(name)) rejectedStarts++;
      }
      const links: Array<{ context: SpanContext }> = [];
      if (tracer && !stopped && causes) {
        const retained = causes.sequences.slice(0, 32);
        const dropped = causes.dropped + Math.max(0, causes.sequences.length - retained.length);
        let unattributed = 0;
        for (const sequence of retained) {
          const context = commits.get(`${causes.database}:${sequence}`);
          if (context) links.push({ context }); else unattributed++;
        }
        selected['app.coalesced_commits'] = causes.sequences.length + causes.dropped;
        selected['app.unattributed_commits'] = unattributed;
        selected['app.dropped_causes'] = dropped;
        recording.dropMetadata(dropped);
      }
      const span = stopped || !names.has(name) ? undefined : tracer?.startSpan(name, { attributes: selected, links }, current());
      const context = span ? trace.setSpan(current(), span) : ROOT_CONTEXT;
      let ended = false;
      return {
        carrier: (): TraceCarrier => stopped || ended || !span ? {} : inject(context),
        within<T>(fn: () => T): T { return runContext(ended ? ROOT_CONTEXT : context, fn); },
        end(outcome: 'ok' | 'error' | 'cancelled' = 'ok') {
          if (ended || stopped) return;
          ended = true;
          span?.setAttribute('diagnostics.outcome', outcome);
          if (outcome !== 'ok') span?.setStatus({ code: SpanStatusCode.ERROR });
          span?.end();
        },
      };
    },
    snapshot,
    async stop(): Promise<PerformanceRecordingReport> {
      if (!stopped) {
        stopped = true;
        for (const detach of attachments.values()) detach();
        unfinished = active.size;
        for (const span of active.values()) { span.setAttribute('diagnostics.outcome', 'incomplete'); span.setStatus({ code: SpanStatusCode.ERROR }); span.end(); }
        events = new WeakMap();
        commits.clear();
        manager?.disable();
        await provider?.shutdown();
      }
      return snapshot();
    },
  };
}
