import { expect, it, vi } from 'vitest';
import { createNodePerformanceController } from '../../src/diagnostics/node.ts';
import { createProcessStatistics } from '../../src/diagnostics/process-statistics.ts';

it('collects finite aggregate process observations and releases its timer exactly once', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const sampler = createProcessStatistics();
    expect(vi.getTimerCount()).toBe(1);
    const report = sampler.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(sampler.stop()).toBe(report);
    expect(Object.values(report).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(report.rssSampledMaxBytes).toBeGreaterThanOrEqual(Math.max(report.rssStartBytes, report.rssEndBytes));
    expect(report.heapSampledMaxBytes).toBeGreaterThanOrEqual(Math.max(report.heapStartBytes, report.heapEndBytes));
  } finally { vi.useRealTimers(); }
});

it('keeps disabled recordings inert and attaches totals only to an enabled recording', async () => {
  const controller = createNodePerformanceController();
  controller.start('disabled');
  expect((await controller.stop()).processStatistics).toBeUndefined();
  controller.start('lightweight');
  const pending = controller.stop();
  expect(controller.stop()).toBe(pending);
  expect(() => controller.start('disabled')).toThrow(/stopping/);
  expect((await pending).processStatistics).toMatchObject({ gcCount: expect.any(Number), cpuUserMicros: expect.any(Number) });
  controller.start('disabled');
  expect((await controller.stop()).processStatistics).toBeUndefined();
});

it('reports failed memory samples and releases its timer without failing diagnostic stop', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const controller = createNodePerformanceController();
  try {
    controller.start('lightweight');
    const memory = vi.spyOn(process, 'memoryUsage').mockImplementationOnce(() => { throw Error('sample unavailable'); });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    memory.mockRestore();
    expect(await controller.stop()).toMatchObject({ complete: false, processStatisticsFailures: 1, processStatistics: { samplingFailures: 1 } });
    expect(vi.getTimerCount()).toBe(0);
    controller.start('lightweight');
    const finalMemory = vi.spyOn(process, 'memoryUsage').mockImplementationOnce(() => { throw Error('final sample unavailable'); });
    expect(await controller.stop()).toMatchObject({ complete: false, processStatisticsFailures: 1 });
    finalMemory.mockRestore();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});
