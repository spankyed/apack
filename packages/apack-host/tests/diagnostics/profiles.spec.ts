import { afterEach, expect, it, vi } from 'vitest';
import { createPerformanceProfiles, PROFILE_BYTES, PROFILE_WINDOW_MS } from '../../src/diagnostics/profiles.ts';
import * as controllers from '../../src/diagnostics/controller.ts';
import * as nodeProfiles from '../../src/diagnostics/node-profiles.ts';
import type { _PerformanceProfiles } from '@apackdev/sdk/runtime';
import { createNodePerformanceController } from '../../src/diagnostics/node.ts';

const transport = () => ({ post: vi.fn(async (_method: string, _parameters?: object): Promise<unknown> => ({ profile: { nodes: [], head: {} } })), close: vi.fn() });
afterEach(() => vi.useRealTimers());

it('owns both profilers and releases the transport exactly once', async () => {
  const port = transport();
  const capture = createPerformanceProfiles(port);
  await capture.ready;
  const pending = capture.stop();
  expect(capture.stop()).toBe(pending);
  const report = await pending;
  expect(report).toMatchObject({ complete: true, failures: 0, stoppedBy: 'owner' });
  expect(report.cpu).toBeDefined(); expect(report.allocation).toBeDefined();
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(port.post).toHaveBeenCalledWith('HeapProfiler.startSampling', expect.objectContaining({ includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }));
});

it('retains the other profile and closes after one oversized export', async () => {
  const port = transport();
  port.post.mockImplementation(async method => ({ profile: method === 'Profiler.stop' ? { nodes: [], oversized: 'x'.repeat(PROFILE_BYTES) } : { head: {} } }));
  const capture = createPerformanceProfiles(port);
  await capture.ready;
  const report = await capture.stop();
  expect(report).toMatchObject({ complete: false, failures: 1, failureStages: ['cpu-size'], allocation: '{"head":{}}' });
  expect(report.cpu).toBeUndefined();
  expect(report.encodedBytes!.cpu).toBeGreaterThan(PROFILE_BYTES / 2);
  expect(report.encodedBytes!.allocation).toBe(11);
  expect(report.bytes).toBe(11);
  expect(port.close).toHaveBeenCalledTimes(1);
});

it('ends a bounded window without waiting for its owner', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const port = transport();
  const capture = createPerformanceProfiles(port);
  await capture.ready;
  await vi.advanceTimersByTimeAsync(PROFILE_WINDOW_MS);
  expect(await capture.stop()).toMatchObject({ complete: true, stoppedBy: 'limit' });
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('releases a stalled protocol and reports the missing capture', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const port = transport();
  port.post.mockImplementationOnce(() => new Promise(() => {}));
  const capture = createPerformanceProfiles(port);
  const pending = capture.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toMatchObject({ complete: false });
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('captures real V8 CPU and allocation formats only in detailed mode', async () => {
  const controller = createNodePerformanceController();
  controller.start('detailed');
  await controller.ready();
  controller.begin('app.dispatch')!.end();
  const report = await controller.stop();
  expect(report.complete).toBe(true);
  expect(JSON.parse(report.profiles!.cpu!).nodes).toBeInstanceOf(Array);
  expect(JSON.parse(report.profiles!.allocation!).head).toBeDefined();
  expect(report.bytes + report.profiles!.bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  controller.start('lightweight');
  expect((await controller.stop()).profiles).toBeUndefined();
});

it('finishes profiler cleanup before propagating an original trace-export failure', async () => {
  const original = controllers.createPerformanceController;
  const failure = Error('trace export failed');
  const factory = vi.spyOn(controllers, 'createPerformanceController').mockImplementation(manager => {
    const resource = original(manager);
    return { ...resource, stop: async () => { await resource.stop(); throw failure; } };
  });
  let release!: (report: _PerformanceProfiles) => void;
  const profile = { ready: Promise.resolve(), stop: vi.fn(() => new Promise<_PerformanceProfiles>(resolve => { release = resolve; })) };
  const profiler = vi.spyOn(nodeProfiles, 'createNodeProfiles').mockReturnValue(profile);
  const ended = { sampling: { cpuIntervalMicros: 1000, allocationIntervalBytes: 512 * 1024, allocationStackDepth: 32, includeCollectedAllocations: true },
    bytes: 0, failures: 1, complete: false, windowLimitMs: PROFILE_WINDOW_MS, durationMs: 0, stoppedBy: 'owner' as const };
  try {
    const controller = createNodePerformanceController();
    controller.start('detailed');
    await controller.ready();
    let settled = false;
    const result = controller.stop().catch(error => { settled = true; return error; });
    await vi.waitFor(() => expect(profile.stop).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    release(ended);
    expect(await result).toBe(failure);
  } finally { release?.(ended); factory.mockRestore(); profiler.mockRestore(); }
});

it('stops allocation sampling before serializing either profile', async () => {
  let sampling = false;
  const port = transport();
  port.post.mockImplementation(async method => {
    if (method === 'HeapProfiler.startSampling') sampling = true;
    if (method === 'HeapProfiler.stopSampling') sampling = false;
    return { profile: { nodes: [], head: {}, toJSON: () => { expect(sampling).toBe(false); return { nodes: [], head: {} }; } } };
  });
  const capture = createPerformanceProfiles(port);
  await capture.ready;
  expect((await capture.stop()).complete).toBe(true);
});

it('distinguishes a timed-out allocation export while preserving the CPU profile and releasing the owner', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const port = transport();
  port.post.mockImplementation(async method => method === 'HeapProfiler.stopSampling' ? new Promise(() => {}) : { profile: { nodes: [], head: {} } });
  const capture = createPerformanceProfiles(port);
  await capture.ready;
  const pending = capture.stop();
  await vi.advanceTimersByTimeAsync(5000);
  const report = await pending;
  expect(report).toMatchObject({ complete: false, failures: 1, failureStages: ['allocation-timeout'] });
  expect(report.cpu).toBeDefined(); expect(report.allocation).toBeUndefined();
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
