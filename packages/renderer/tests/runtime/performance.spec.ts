import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => ({ complete: true })) }));
vi.mock('@/transport', () => ({ trpc: { performance: { start: { mutate: rpc.start }, stop: { mutate: rpc.stop } } } }));
const { windowPerformance, notifyPerformanceView } = await import('@/runtime/performance');
const bridge = { start: vi.fn(async () => ({ id: 'lease' })), stop: vi.fn(async () => ({ complete: true, profileFailures: 0,
  statistics: { source: 'chromium-cdp', pid: 42, metrics: [], unavailable: [], failures: 0 } })) };
beforeEach(() => { Object.assign(window, { electronAPI: { performance: bridge } }); });
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

it('retains only bounded metadata for startup views and clears it on stop', async () => {
  await windowPerformance.start('lightweight', { startup: true });
  notifyPerformanceView({ request: { ref: 'pack/feature', view: 'list' }, update: { ok: true, value: 'private payload', commit: 7 }, generation: 1, delivery: 1 });
  expect(windowPerformance.lastStartupView('pack/feature', 'list')).toEqual({ ok: true, commit: 7, subscription: undefined, delivery: undefined });
  notifyPerformanceView({ request: { ref: 'pack/feature', view: 'detail', args: { private: 'argument' } }, update: { ok: true, value: 'private payload', commit: 8 }, generation: 1, delivery: 2 });
  expect(windowPerformance.lastStartupView('pack/feature', 'detail')).toBeUndefined();
  notifyPerformanceView({ request: { ref: 'pack/feature', view: 'chat', args: { threadId: 'Thread-one', limit: 50 } }, update: { ok: true, value: 'private payload', commit: 9 }, generation: 1, delivery: 3 });
  expect(windowPerformance.lastStartupView('pack/feature', 'chat')).toMatchObject({ entityId: 'Thread-one', commit: 9 });
  notifyPerformanceView({ request: { ref: 'pack/feature', view: 'chat', args: { threadId: 'Thread-two', limit: 50 } }, update: { ok: true, value: 'private payload', commit: 10 }, generation: 1, delivery: 4 });
  expect(windowPerformance.lastStartupView('pack/feature', 'chat')).toMatchObject({ entityId: 'Thread-two', commit: 10 });
  expect(JSON.stringify(await windowPerformance.stop())).not.toContain('private payload');
  expect(windowPerformance.lastStartupView('pack/feature', 'list')).toBeUndefined();
});

it('keeps application spans usable when the renderer debugger refuses capture', async () => {
  bridge.start.mockRejectedValueOnce(Error('debugger already attached'));
  await windowPerformance.start('lightweight');
  windowPerformance.begin('app.dispatch').end();
  const report = await windowPerformance.stop();
  expect(report.complete).toBe(false);
  expect(report.failures).toContain('renderer-resource-start');
  expect(report.renderer?.observations.length).toBe(1);
});

it('retains baseline completion receipts without recording spans in disabled startup mode', async () => {
  await windowPerformance.start('disabled', { startup: true });
  notifyPerformanceView({ request: { ref: 'pack/feature', view: 'list' }, update: { ok: true, value: 'private payload', commit: 7 }, generation: 1, delivery: 1 });
  expect(windowPerformance.lastStartupView('pack/feature', 'list')).toMatchObject({ ok: true, commit: 7 });
  expect(bridge.start).not.toHaveBeenCalled();
  expect(await windowPerformance.stop()).toMatchObject({ complete: true, renderer: { observations: [] } });
});

it('reports receipt overflow while continuing to update an admitted startup view', async () => {
  await windowPerformance.start('lightweight', { startup: true });
  const deliver = (ref: string, commit: number) => notifyPerformanceView({ request: { ref, view: 'list' },
    update: { ok: true, value: null, commit }, generation: 1, delivery: commit });
  for (let index = 0; index < 32; index++) deliver(`pack/feature-${index}`, index);
  deliver('pack/overflow', 33);
  deliver('pack/feature-0', 34);
  expect(windowPerformance.lastStartupView('pack/overflow', 'list')).toBeUndefined();
  expect(windowPerformance.lastStartupView('pack/feature-0', 'list')).toMatchObject({ commit: 34 });
  expect(await windowPerformance.stop()).toMatchObject({ complete: false, failedListeners: 1 });
});

it('holds admission ownership until a refused start releases it', async () => {
  let refuse!: (error: Error) => void;
  rpc.start.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { refuse = reject; }));
  const starting = windowPerformance.start('disabled');
  await expect(windowPerformance.start('disabled')).rejects.toThrow(/starting/);
  const failure = Error('admission refused');
  const rejected = expect(starting).rejects.toThrow(failure);
  refuse(failure); await rejected;
  expect(windowPerformance.execution).toBeUndefined();
  await windowPerformance.start('disabled');
  expect(await windowPerformance.stop()).toMatchObject({ complete: true });
});

it('an unsubscribe from a closed recording cannot remove the same callback from its successor', async () => {
  const listener = vi.fn();
  await windowPerformance.start('disabled');
  const unsubscribe = windowPerformance.onView(listener);
  await windowPerformance.stop();
  await windowPerformance.start('disabled');
  windowPerformance.onView(listener);
  unsubscribe();
  notifyPerformanceView({ request: { ref: 'pack/feature', view: 'list' }, update: { ok: true, value: null, commit: 1 }, generation: 1, delivery: 1 });
  expect(listener).toHaveBeenCalledTimes(1);
  await windowPerformance.stop();
});
