import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import { createRecordingBuffer } from './buffer.ts';

/** Encoded observations are immutable and bounded independently of native memory and exporter output. */
export function createSpanRecording(options: {
  names: ReadonlySet<string>;
  attributes: ReadonlySet<string>;
  limits?: { observations: number; bytes: number };
}) {
  const names = new Set(options.names);
  const attributes = new Set(options.attributes);
  const buffer = createRecordingBuffer<string>(options.limits ?? { observations: 10_000, bytes: 16 * 1024 * 1024 });
  const encoder = new TextEncoder();
  let stopped = false;
  let rejected = 0;
  let droppedMetadata = 0;
  const processor: SpanProcessor = {
    onStart() {},
    onEnd(span: ReadableSpan) {
      if (stopped) return;
      // Instrumentation must name operations explicitly; arbitrary names and payloads do not enter reports.
      if (!names.has(span.name)) { rejected++; return; }
      try {
        const context = span.spanContext();
        droppedMetadata += span.droppedAttributesCount + span.droppedLinksCount + Math.max(0, span.links.length - 32);
        const selected = Object.fromEntries(Object.entries(span.attributes).filter(([key, value]) =>
          attributes.has(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
            || typeof value === 'string' && value.length <= 128)));
        const encoded = JSON.stringify({
          name: span.name,
          traceId: context.traceId,
          spanId: context.spanId,
          parentSpanId: span.parentSpanContext?.spanId,
          startTime: span.startTime,
          duration: span.duration,
          status: span.status.code,
          attributes: selected,
          links: span.links.slice(0, 32).map(link => ({ traceId: link.context.traceId, spanId: link.context.spanId })),
          droppedLinks: span.droppedLinksCount + Math.max(0, span.links.length - 32),
        });
        buffer.append(encoded, encoder.encode(encoded).byteLength);
      } catch {
        // Observability cannot replace the application's result with an exporter/encoding error.
        rejected++;
      }
    },
    async forceFlush() {},
    async shutdown() { stopped = true; },
  };
  return {
    processor,
    snapshot() {
      const report = buffer.snapshot();
      return { ...report, rejected, droppedMetadata, complete: !report.truncated && rejected === 0 && droppedMetadata === 0 };
    },
  };
}
