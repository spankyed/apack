import { ClockController, type ClockSources } from '@apackdev/clock';

/**
 * Owns one renderer window's shared `ClockController` and the teardown hooks that must run before it closes.
 *
 * Views and other window-scoped clock consumers register cleanup via `onDispose`; `dispose()` runs every
 * registered hook in reverse registration order before calling `controller.close()`, so closing the shared
 * clock never trips over armed view timers.
 */
export interface RendererClockLifecycle {
  readonly controller: ClockController;
  readonly disposed: boolean;
  /** Registers `listener` to run before `controller.close()`. Returns an unregister function. */
  onDispose(listener: () => void): () => void;
  /** Runs every registered cleanup hook, then closes `controller`. Idempotent. */
  dispose(): void;
}

/** Creates an isolated renderer clock lifecycle, optionally backed by custom clock sources for tests. */
export function createRendererClockLifecycle(sources?: Partial<ClockSources>): RendererClockLifecycle {
  const controller = new ClockController(sources);
  const listeners = new Set<() => void>();
  let disposed = false;

  return {
    controller,
    get disposed() {
      return disposed;
    },
    onDispose(listener: () => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const toRun = [...listeners].reverse();
      listeners.clear();
      let firstError: unknown;
      let hasError = false;
      for (const listener of toRun) {
        try {
          listener();
        } catch (error) {
          if (!hasError) {
            hasError = true;
            firstError = error;
          }
        }
      }
      controller.close();
      if (hasError) throw firstError;
    },
  };
}
