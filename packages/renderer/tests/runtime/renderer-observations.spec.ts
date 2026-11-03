import { afterEach, expect, it, vi } from 'vitest';
import { observeRendererLongTasks } from '@/runtime/renderer-observations';
afterEach(() => vi.unstubAllGlobals());
it('counts delivered and pending long tasks once and releases the observer', () => {
  let deliver!: (entries: PerformanceEntry[]) => void;
  const pending: PerformanceEntry[] = [];
  const disconnected = vi.fn();
  vi.stubGlobal('PerformanceObserver', class {
    static supportedEntryTypes = ['longtask'];
    constructor(callback: (list: { getEntries(): PerformanceEntry[] }) => void) { deliver = entries => callback({ getEntries: () => entries }); }
    observe() {}
    takeRecords() { return pending.splice(0); }
    disconnect = disconnected;
  });
  const recording = observeRendererLongTasks();
  const entry = (duration: number): PerformanceEntry => ({ startTime: performance.now() + 1, duration, entryType: 'longtask', name: 'self', toJSON: () => ({}) });
  deliver([entry(80)]); pending.push(entry(60));
  const result = recording.stop();
  expect(result).toEqual({ supported: true, count: 2, totalMs: 140, maxMs: 80, failures: 0 });
  expect(recording.stop()).toBe(result);
  expect(disconnected).toHaveBeenCalledTimes(1);
});
it('reports observation failures and still disconnects', () => {
  const disconnected = vi.fn();
  vi.stubGlobal('PerformanceObserver', class {
    static supportedEntryTypes = ['longtask'];
    observe() {}
    takeRecords(): PerformanceEntry[] { throw Error('unavailable'); }
    disconnect = disconnected;
  });
  const result = observeRendererLongTasks().stop();
  expect(result.failures).toBe(1);
  expect(disconnected).toHaveBeenCalledTimes(1);
});
