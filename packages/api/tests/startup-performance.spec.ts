import { expect, it } from 'vitest';
import { createStartupPerformance } from '../src/runtime/startup-performance.ts';

it('starts nothing by default and refuses startup qualification outside test', () => {
  expect(createStartupPerformance('production', undefined)).toBeUndefined();
  expect(() => createStartupPerformance('production', '{}')).toThrow('requires the test environment');
  expect(() => createStartupPerformance('test', JSON.stringify({ mode: 'unknown' }))).toThrow();
});
it('records admission before a window exists and permits exactly one matching adoption', async () => {
  const startup = createStartupPerformance('test', JSON.stringify({ mode: 'lightweight' }))!;
  startup.run(() => { const admission = startup.controller.begin('app.index.admission')!; admission.end(); });
  startup.finish();
  expect(() => startup.adopt('disabled')).toThrow('matching startup');
  startup.adopt('lightweight');
  expect(() => startup.adopt('lightweight')).toThrow('matching startup');
  const report = await startup.controller.stop();
  expect(report.complete).toBe(true);
  const spans = report.observations.map(value => JSON.parse(value) as { name: string; spanId: string; parentSpanId?: string });
  expect(spans.find(span => span.name === 'app.index.admission')?.parentSpanId).toBe(spans.find(span => span.name === 'app.startup')?.spanId);
});

it('preserves a failed startup outcome and finishes idempotently', async () => {
  const startup = createStartupPerformance('test', JSON.stringify({ mode: 'lightweight' }))!;
  startup.finish('error');
  startup.finish();
  const report = await startup.controller.stop();
  const spans = report.observations.map(value => JSON.parse(value));
  expect(spans.filter(span => span.name === 'app.startup')).toHaveLength(1);
  expect(spans[0].status).toBe(2);
  expect(spans[0].attributes['diagnostics.outcome']).toBe('error');
});
