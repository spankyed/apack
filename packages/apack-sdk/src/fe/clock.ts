import { boundFeHost } from '../runtime/fe-host.ts';

/**
 * The renderer's shared clock, as frontend code reads it: structurally matches `@apackdev/clock`'s
 * `controller.clock` and `@apackdev/terminal-view`'s `Clock`, so one timer queue can serve every open
 * view without any pack taking a runtime dependency on `@apackdev/clock`.
 *
 * Consumers that arm timers on it must cancel them (or register cleanup through `onHostDispose`) before
 * the renderer closes its clock.
 */
export interface FeClock {
  /** Wall-clock time in milliseconds since 1970, clamped against backward jumps. */
  now(): number;
  /** Monotonic time in milliseconds from an arbitrary origin, excluding suspended spans. */
  monotonic(): number;
  /** Runs `run` once after `ms` milliseconds unless the returned cancel function is called first. */
  after(ms: number, run: () => void): () => void;
}

/**
 * The renderer's shared clock, when the bound frontend host provides one. Absent in tests that bound no
 * clock, so a caller like `TerminalView` can pass it straight through and fall back to its default timer.
 */
export function hostClock(): FeClock | undefined {
  return boundFeHost().clock;
}

/**
 * Registers `listener` to run before the renderer tears down its shared runtime resources (closing its
 * `ClockController`). Returns an unregister function.
 *
 * A host without teardown hooks (such as a minimal test runtime) answers with a no-op unregister.
 */
export function onHostDispose(listener: () => void): () => void {
  return boundFeHost().onDispose?.(listener) ?? (() => {});
}
