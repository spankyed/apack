import { afterEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => ({ complete: true })) }));
vi.mock('@/transport', () => ({ trpc: { performance: { start: { mutate: rpc.start }, stop: { mutate: rpc.stop } } } }));
const { windowPerformance, notifyPerformanceView } = await import('@/runtime/performance');
afterEach(async () => {
  if (windowPerformance.execution) await windowPerformance.stop();
  vi.clearAllMocks();
});

it('requires backend admission, and releases both owners after a recording', async () => {
  rpc.start.mockRejectedValueOnce(Error('development only'));
  await expect(windowPerformance.start('lightweight')).rejects.toThrow('development only');
  expect(windowPerformance.execution).toBeUndefined();
  expect(rpc.stop).not.toHaveBeenCalled();
  await windowPerformance.start('lightweight');
  const action = windowPerformance.begin('app.thread.open');
  expect(action.carrier().traceparent).toBeTruthy();
  action.end();
  expect(await windowPerformance.stop()).toMatchObject({ complete: true, renderer: { complete: true } });
  expect(windowPerformance.execution).toBeUndefined();
  expect(() => windowPerformance.begin('app.thread.open')).toThrow(/No window/);
});

it('still closes the local recorder when the backend report fails', async () => {
  await windowPerformance.start('lightweight');
  windowPerformance.begin('app.thread.open');
  rpc.stop.mockRejectedValueOnce(Error('socket lost'));
  expect(await windowPerformance.stop()).toMatchObject({ complete: false, failures: ['backend-stop'], renderer: { unfinished: 1 } });
  expect(windowPerformance.execution).toBeUndefined();
});

it('isolates view listener failures and clears listeners between recordings', async () => {
  await windowPerformance.start('lightweight');
  const listener = vi.fn(() => { throw Error('private content'); });
  windowPerformance.onView(listener);
  const delivery = { request: { ref: 'pack/feature', view: 'page' }, update: { ok: true as const, value: 'private content', commit: 1 }, generation: 1, delivery: 1 };
  expect(() => notifyPerformanceView(delivery)).not.toThrow();
  const report = await windowPerformance.stop();
  expect(report).toMatchObject({ complete: false, failedListeners: 1 });
  expect(JSON.stringify(report)).not.toContain('private content');
  await windowPerformance.start('disabled');
  notifyPerformanceView(delivery);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(await windowPerformance.stop()).toMatchObject({ complete: true, renderer: { observations: [] } });
});


it('does not admit a replacement recording while either process is still stopping', async () => {
  await windowPerformance.start('lightweight');
  let release!: () => void;
  rpc.stop.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ complete: true }); }));
  const stopping = windowPerformance.stop();
  await expect(windowPerformance.start('lightweight')).rejects.toThrow(/stopping/);
  release();
  expect(await stopping).toMatchObject({ complete: true });
  await windowPerformance.start('disabled');
  await windowPerformance.stop();
});

it('adopts startup before creating the renderer recording and retains the startup parent through readiness', async () => {
  const { startStartupRecording } = await import('@/runtime/performance');
  await startStartupRecording(null);
  expect(rpc.start).not.toHaveBeenCalled();
  await expect(startStartupRecording('{"mode":"invalid"}')).rejects.toThrow();
  expect(rpc.start).not.toHaveBeenCalled();
  await startStartupRecording('{"mode":"lightweight"}');
  expect(rpc.start).toHaveBeenCalledWith({ mode: 'lightweight', startup: true });
  windowPerformance.withinStartup(() => windowPerformance.begin('app.view.ready').end());
  const report = await windowPerformance.stop();
  expect(report.complete).toBe(true);
  const spans = report.renderer!.observations.map(value => JSON.parse(value) as { name: string; spanId: string; parentSpanId?: string });
  expect(spans.find(span => span.name === 'app.view.ready')?.parentSpanId).toBe(spans.find(span => span.name === 'app.startup')?.spanId);
});
