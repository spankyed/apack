import { expect, it } from 'vitest';
import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { createSpanRecording } from '../../src/diagnostics/spans.ts';
import { createEarsOperationObserver, EARS_SPAN_ATTRIBUTES, EARS_SPAN_NAMES } from '../../src/diagnostics/ears.ts';

it('parents nested database operations under their unit and preserves action ancestry', async () => {
  const recorder = createSpanRecording({ names: new Set(['app.action', ...EARS_SPAN_NAMES]), attributes: new Set(EARS_SPAN_ATTRIBUTES) });
  const provider = new TracerProvider({ spanProcessors: [recorder.processor] });
  const tracer = provider.getTracer('apack.performance');
  const action = tracer.startSpan('app.action', {}, ROOT_CONTEXT);
  const observer = createEarsOperationObserver(tracer, () => trace.setSpan(ROOT_CONTEXT, action));
  const unit = observer.start({ kind: 'unit', ops: 0, watch: false, inUnit: false, sequence: 1 });
  const write = observer.start({ kind: 'write', ops: 2, watch: false, inUnit: true, sequence: 1 });
  write({ outcome: 'ok', sequence: 1, requestBytes: 10, responseBytes: 20 });
  unit({ outcome: 'committed-not-durable', sequence: 2, errorCode: 'NOT_DURABLE', requestBytes: 0, responseBytes: 0 });
  action.end();
  const spans = recorder.snapshot().observations.map(value => JSON.parse(value));
  const byName = (name: string) => spans.find(span => span.name === name);
  expect(byName('ears.unit').parentSpanId).toBe(byName('app.action').spanId);
  expect(byName('ears.write').parentSpanId).toBe(byName('ears.unit').spanId);
  expect(byName('ears.unit')).toMatchObject({ status: 2, attributes: { 'ears.outcome': 'committed-not-durable', 'ears.sequence.after': 2 } });
  expect(byName('ears.write').attributes).toMatchObject({ 'ears.request_bytes': 10, 'ears.response_bytes': 20 });
  const sibling = observer.start({ kind: 'read', ops: 1, watch: true, inUnit: false, sequence: 2 });
  sibling({ outcome: 'ok', sequence: 2, requestBytes: 5, responseBytes: 6 });
  const last = JSON.parse(recorder.snapshot().observations.at(-1)!);
  expect(last.parentSpanId).toBe(action.spanContext().spanId);
  await provider.shutdown();
});
