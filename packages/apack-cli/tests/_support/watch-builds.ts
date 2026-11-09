import { expect } from 'vitest';
import { createPackBuilder, type PackBuilderOptions } from '../../src/build/build-process.ts';
import { startPackBuildWatcher, type WatchOptions } from '../../src/build/watch.ts';
import { settles, _workingSignal } from '@apackdev/sdk/testing/waiting';

// What a rebuild may cost, which sizes a case's CPU budget (`cpuBudget`): no wait here has a clock of its own, and
// a watcher or build that stops working is ended by the progress guard and `_workingSignal`
const REQUEST_CPU_MS = 20_000;
// Every request runs a fresh compiler worker through verified publication.
const BUILD_CPU_MS = 120_000;
/** Request, compilation and the caller's own notification check. */
export const WATCH_REBUILD_BUDGET_MS = REQUEST_CPU_MS + BUILD_CPU_MS + 20_000;

export type TestPackBuildWatcher = Awaited<ReturnType<typeof startPackBuildWatcher>> & {
  rebuildAfter(edit: () => void): Promise<void>;
};

/** Separate a missing watch request from compilation; callers retain their notification/output checks. */
export async function startTestPackBuildWatcher(root: string,
  { captureCompiler, refreshPackages, packagesState, ...options }: Omit<WatchOptions, 'builder'> & PackBuilderOptions = {}): Promise<TestPackBuildWatcher> {
  const builder = createPackBuilder(root, { captureCompiler, refreshPackages, packagesState });
  const build = builder.build.bind(builder);
  const builds: Promise<{ interrupted: boolean; error?: unknown }>[] = [];
  builder.build = input => {
    const deadline = _workingSignal();
    const signal = input?.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const running = build({ ...input, signal });
    builds.push(running.then(() => ({ interrupted: false }), error => ({
      interrupted: signal.aborted,
      error: deadline.aborted ? new Error(`Pack build for "${root}" was stopped: ${String(deadline.reason)}`, { cause: error }) : error,
    })));
    return running;
  };
  try {
    const watcher = await startPackBuildWatcher(root, { ...options, builder });
    const done = watcher.done.finally(() => builder.close());
    void done.catch(() => {});
    let closing: Promise<void> | undefined;
    return {
      done,
      // Awaited with no deadline of its own: a cleanup that stops working is the progress guard's to end
      close() {
        return closing ??= watcher.close().finally(() => done).then(() => undefined);
      },
      async rebuildAfter(edit) {
        const before = builds.length;
        edit();
        await settles(() => expect(builds.length, 'watch request did not start a rebuild').toBeGreaterThan(before));
        const result = await builds[before]!;
        if (result.interrupted) throw result.error;
      },
    };
  } catch (error) {
    await builder.close();
    throw error;
  }
}
