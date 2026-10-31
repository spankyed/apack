import { expect, it } from 'vitest';
import { createNodePerformanceController } from '../../src/diagnostics/node.ts';
import { createViewObservation } from '../../src/diagnostics/views.ts';

it('keeps read-to-delivery context separate for independent watches', async () => {
  const recording = createNodePerformanceController(); recording.start('lightweight');
  const a = recording.begin('app.thread.open')!;
  const b = recording.begin('app.search')!;
  const first = createViewObservation(recording);
  const second = createViewObservation(recording);
  a.within(() => expect(first.read(() => 1)).toBe(1));
  b.within(() => expect(second.read(() => 2)).toBe(2));
  const delivered: Array<string | undefined> = [];
  first.deliver(1, () => delivered.push(recording.execution.capture().traceparent?.split('-')[1]));
  second.deliver(2, () => delivered.push(recording.execution.capture().traceparent?.split('-')[1]));
  expect(delivered).toEqual([a.carrier().traceparent!.split('-')[1], b.carrier().traceparent!.split('-')[1]]);
  expect(recording.execution.capture()).toEqual({});
  a.end(); b.end(); expect((await recording.stop()).complete).toBe(true);
});
it('preserves original read and delivery failures and closes their observation spans', async () => {
  const recording = createNodePerformanceController(); recording.start('lightweight');
  const observation = createViewObservation(recording);
  const failure = Error('business failure');
  expect(() => observation.read(() => { throw failure; })).toThrow(failure);
  expect(() => observation.deliver(1, () => { throw failure; })).toThrow(failure);
  const report = await recording.stop();
  expect(report).toMatchObject({ active: 0, unfinished: 0, complete: true });
  const read = report.observations.map(value => JSON.parse(value)).find(span => span.name === 'app.view.read');
  expect(read.attributes['diagnostics.outcome']).toBe('error');
});
it('runs normally without allocating a recording when the controller is idle', async () => {
  const recording = createNodePerformanceController();
  const observation = createViewObservation(recording);
  expect(observation.recordCauses()).toBe(false);
  expect(observation.read(() => observation.deliver(0, () => 42))).toBe(42);
  expect(recording.snapshot()).toBeUndefined();
});
