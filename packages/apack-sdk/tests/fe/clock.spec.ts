// hostClock() and onHostDispose() read the frontend host bound by bindFeHost / startFeTestRuntime.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostClock, onHostDispose, type FeClock } from '../../src/fe/index.ts';
import { startFeTestRuntime } from '../../src/testing/index.ts';

let stopRuntime: (() => void) | undefined;

afterEach(() => {
  stopRuntime?.();
  stopRuntime = undefined;
});

describe('hostClock and onHostDispose', () => {
  it('omits the clock and returns a no-op dispose unregister when the test runtime binds neither', () => {
    stopRuntime = startFeTestRuntime();
    expect(hostClock()).toBeUndefined();
    const unregister = onHostDispose(() => {});
    expect(() => unregister()).not.toThrow();
  });

  it('returns the clock and forwards dispose registrations from startFeTestRuntime', () => {
    const listeners = new Set<() => void>();
    const clock: FeClock = {
      now: () => 1_700_000_000_000,
      monotonic: () => 42,
      after: (_ms, _run) => () => {},
    };
    stopRuntime = startFeTestRuntime({
      clock,
      onDispose: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    });

    expect(hostClock()).toBe(clock);

    const cleanup = vi.fn();
    const unregister = onHostDispose(cleanup);
    expect(listeners.size).toBe(1);

    unregister();
    expect(listeners.size).toBe(0);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
