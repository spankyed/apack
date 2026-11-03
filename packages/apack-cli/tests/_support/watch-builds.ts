import { expect, vi } from 'vitest';
import { createPackBuilder, type PackBuilderOptions } from '../../src/build/build-process.ts';
import { startPackBuildWatcher, type WatchOptions } from '../../src/build/watch.ts';

const REQUEST_TIMEOUT_MS = 20_000;
// Every request runs a fresh compiler worker through verified publication.
const BUILD_TIMEOUT_MS = 120_000;
/** Request, compilation and the caller's existing 20s notification check. */
export const WATCH_REBUILD_BUDGET_MS = REQUEST_TIMEOUT_MS + BUILD_TIMEOUT_MS + 20_000;

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
    const deadline = AbortSignal.timeout(BUILD_TIMEOUT_MS);
    const signal = input?.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const running = build({ ...input, signal });
    builds.push(running.then(() => ({ interrupted: false }), error => ({
      interrupted: signal.aborted,
      error: deadline.aborted ? new Error(`Pack build for "${root}" exceeded ${BUILD_TIMEOUT_MS}ms`, { cause: error }) : error,
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
      close() {
        return closing ??= (async () => {
          let result: PromiseSettledResult<void> | undefined;
          void watcher.close().finally(() => done).then(
            value => { result = { status: 'fulfilled', value }; },
            reason => { result = { status: 'rejected', reason }; },
          );
          await vi.waitFor(() => expect(result, 'watcher cleanup did not settle').toBeDefined(), { timeout: 20_000 });
          if (result?.status === 'rejected') throw result.reason;
        })();
      },
      async rebuildAfter(edit) {
        const before = builds.length;
        edit();
        await vi.waitFor(() => expect(builds.length, 'watch request did not start a rebuild').toBeGreaterThan(before), { timeout: REQUEST_TIMEOUT_MS });
        const result = await builds[before]!;
        if (result.interrupted) throw result.error;
      },
    };
  } catch (error) {
    await builder.close();
    throw error;
  }
}
