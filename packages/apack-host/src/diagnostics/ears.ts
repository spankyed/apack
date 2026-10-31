import { trace, SpanStatusCode, type Context, type Tracer, type SpanContext } from '@opentelemetry/api';
import type { EarsOperationObserver } from '@apackdev/ears';

/** Stable names and scalar attributes: database requests, results and error messages never become telemetry. */
export const EARS_SPAN_NAMES = ['ears.read', 'ears.write', 'ears.unit', 'ears.load'] as const;
export const EARS_SPAN_ATTRIBUTES = [
  'ears.database', 'ears.ops', 'ears.watch', 'ears.in_unit', 'ears.sequence.before', 'ears.sequence.after',
  'ears.request_bytes', 'ears.response_bytes', 'ears.outcome', 'ears.error_code',
] as const;

/** The host supplies the tracer and active action context; EARS owns neither tracing nor exporters. */
export function createEarsOperationObserver(tracer: Tracer, activeContext: () => Context, database?: 'app' | 'runHistory', committed?: (sequence: number, context: SpanContext) => void): EarsOperationObserver {
  const parents: Context[] = [];
  return {
    start(operation) {
      const parent = parents.at(-1) ?? activeContext();
      const span = tracer.startSpan(`ears.${operation.kind}`, {
        attributes: {
          ...(database && { 'ears.database': database }),
          'ears.ops': operation.ops,
          'ears.watch': operation.watch,
          'ears.in_unit': operation.inUnit,
          ...(operation.sequence !== undefined && { 'ears.sequence.before': operation.sequence }),
        },
      }, parent);
      parents.push(trace.setSpan(parent, span));
      return result => {
        try {
          if (!span.isRecording()) return;
          span.setAttributes({
            ...(result.sequence !== undefined && { 'ears.sequence.after': result.sequence }),
            'ears.request_bytes': result.requestBytes,
            'ears.response_bytes': result.responseBytes,
            'ears.outcome': result.outcome,
            ...(result.errorCode && { 'ears.error_code': result.errorCode }),
          });
          if (result.outcome !== 'ok') span.setStatus({ code: SpanStatusCode.ERROR });
          if (operation.kind !== 'read' && operation.sequence !== undefined && result.sequence !== undefined
            && result.sequence > operation.sequence && result.outcome !== 'error') committed?.(result.sequence, span.spanContext());
        } finally {
          try { if (span.isRecording()) span.end(); } finally { parents.pop(); }
        }
      };
    },
  };
}
