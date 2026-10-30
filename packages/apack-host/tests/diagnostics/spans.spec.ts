import { describe, expect, it } from 'vitest';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { createSpanRecording } from '../../src/diagnostics/spans.ts';

function recording(limits?: { observations: number; bytes: number }) {
  const recorder = createSpanRecording({ names: new Set(['app.action']), attributes: new Set(['scenario']), limits });
  const provider = new TracerProvider({ spanProcessors: [recorder.processor] });
  return { recorder, provider, tracer: provider.getTracer('apack.performance') };
}

describe('span recording', () => {
  it('records real SDK spans without event payloads, status messages or unapproved attributes', async () => {
    const { recorder, provider, tracer } = recording();
    const span = tracer.startSpan('app.action', { attributes: { scenario: 'thread-open', prompt: 'private' } });
    span.addEvent('private content', { body: 'private' });
    span.setStatus({ code: 2, message: 'private error' });
    span.end();
    const report = recorder.snapshot();
    expect(report.complete).toBe(true);
    expect(report.observations).toHaveLength(1);
    expect(report.observations[0]).not.toContain('private');
    expect(JSON.parse(report.observations[0]!)).toMatchObject({ name: 'app.action', attributes: { scenario: 'thread-open' }, status: 2 });
    await provider.shutdown();
  });

  it('makes overflow and unknown operation names explicit', async () => {
    const { recorder, provider, tracer } = recording({ observations: 1, bytes: 4096 });
    tracer.startSpan('app.action').end();
    tracer.startSpan('app.action').end();
    tracer.startSpan('unregistered operation').end();
    expect(recorder.snapshot()).toMatchObject({ dropped: 1, rejected: 1, complete: false });
    await provider.shutdown();
  });

  it('does not label SDK metadata truncation as complete recording', async () => {
    const recorder = createSpanRecording({ names: new Set(['app.action']), attributes: new Set(['scenario']) });
    const provider = new TracerProvider({ spanProcessors: [recorder.processor], spanLimits: { attributeCountLimit: 1 } });
    const span = provider.getTracer('apack.performance').startSpan('app.action');
    span.setAttribute('scenario', 'thread-open');
    span.setAttribute('extra', 'discarded by SDK');
    span.end();
    expect(recorder.snapshot()).toMatchObject({ complete: false, droppedMetadata: 1 });
    await provider.shutdown();
  });

  it('stops recording without changing span completion', async () => {
    const { recorder, provider, tracer } = recording();
    const span = tracer.startSpan('app.action');
    await recorder.processor.shutdown();
    expect(() => span.end()).not.toThrow();
    expect(recorder.snapshot().observations).toHaveLength(0);
    await provider.shutdown();
  });
});
