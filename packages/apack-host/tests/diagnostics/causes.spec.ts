import { expect, it } from 'vitest';
import type { EarsOperationObserver } from '@apackdev/ears';
import { createNodePerformanceController } from '../../src/diagnostics/node.ts';

function fixture() {
  const controller = createNodePerformanceController();
  let observer!: EarsOperationObserver;
  controller.attach({ admin: { observe(value) { observer = value; return () => {}; } } }, 'app');
  controller.start('lightweight');
  const write = (before: number, after: number, outcome: 'ok' | 'error' | 'committed-not-durable' = 'ok') => {
    const action = controller.begin('app.thread.open')!;
    action.within(() => observer.start({ kind: 'write', ops: 1, watch: false, inUnit: false, sequence: before })({
      outcome, sequence: after, requestBytes: 10, responseBytes: 5,
    }));
    action.end();
  };
  return { controller, write };
}
it('links a coalesced read to both completed writes without selecting an action parent', async () => {
  const { controller, write } = fixture();
  write(0, 1); write(1, 2);
  controller.execution.withCarrier(undefined, () => controller.begin('app.view.read', {}, { database: 'app', sequences: [1, 2], dropped: 0 })!.end());
  const report = await controller.stop();
  expect(report.complete).toBe(true);
  const spans = report.observations.map(value => JSON.parse(value));
  const writes = spans.filter(span => span.name === 'ears.write');
  const read = spans.find(span => span.name === 'app.view.read');
  expect(read.parentSpanId).toBeUndefined();
  expect(read.links).toEqual(writes.map(span => ({ spanId: span.spanId, traceId: span.traceId })));
  expect(read.attributes).toMatchObject({ 'app.coalesced_commits': 2, 'app.unattributed_commits': 0, 'app.dropped_causes': 0 });
});
it('does not replace a committed cause with a no-op or refused write and exposes unknown causes', async () => {
  const { controller, write } = fixture();
  write(0, 1); write(1, 1); write(1, 2, 'error');
  controller.begin('app.view.read', {}, { database: 'app', sequences: [1, 2], dropped: 0 })!.end();
  const report = await controller.stop();
  const spans = report.observations.map(value => JSON.parse(value));
  const read = spans.find(span => span.name === 'app.view.read');
  const first = spans.find(span => span.name === 'ears.write');
  expect(read.links).toEqual([{ traceId: first.traceId, spanId: first.spanId }]);
  expect(read.attributes['app.unattributed_commits']).toBe(1);
});
it('retains committed-not-durable causality and makes dropped causes incomplete', async () => {
  const { controller, write } = fixture();
  write(0, 1, 'committed-not-durable');
  controller.begin('app.view.read', {}, { database: 'app', sequences: [1], dropped: 3 })!.end();
  const report = await controller.stop();
  expect(report).toMatchObject({ complete: false, droppedMetadata: 3 });
  const read = report.observations.map(value => JSON.parse(value)).find(span => span.name === 'app.view.read');
  expect(read.links).toHaveLength(1);
  expect(read.attributes['app.dropped_causes']).toBe(3);
});

it('does not carry commit identities across replacement database handles', async () => {
  const { controller, write } = fixture();
  write(0, 1);
  controller.attach({ admin: { observe() { return () => {}; } } }, 'app');
  controller.begin('app.view.read', {}, { database: 'app', sequences: [1], dropped: 0 })!.end();
  const report = await controller.stop();
  const read = report.observations.map(value => JSON.parse(value)).find(span => span.name === 'app.view.read');
  expect(read.links).toEqual([]);
  expect(read.attributes['app.unattributed_commits']).toBe(1);
});
