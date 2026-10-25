import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // Every project here is a host package, as in `vitest.config.ts`: the expensive halves all resolve the
  // workspace @apackdev packages to source. No pack suite has a second config, so the split that forces two
  // unit pools does not arise here.
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    /**
     * The expensive halves as one vitest run, so they share one job pool and one worker budget.
     *
     * They were three `npm -w` invocations in series: three startups, three pools, three `pretest` guards,
     * none overlapping. Measured 2026-09-29 — 31s, 32s and 8s standalone, 71s together, and 90-105s as the
     * chain step. Nothing kept them apart: all three declare the same resolution, so unlike the unit suites
     * there is no condition boundary between them, and vitest's sequencer takes every project's files as one
     * longest-first list across package boundaries.
     *
     * Each project loads its own config, which is where its `testTimeout` lives — per-project *test* config
     * is honoured, unlike `poolOptions` below.
     *
     * Written out rather than derived from `INTEGRATION_SUITES`, for the reason `vitest.config.ts` gives:
     * `check:specifiers` reads this file as text and cannot read a computed list. `chain-inputs.spec.ts`
     * asserts it is exactly the suites with a second config, so it cannot drift.
     */
    projects: [
      'packages/apack-ears/vitest.integration.config.ts',
      'packages/apack-cli/vitest.integration.config.ts',
      'packages/repo-checks/vitest.integration.config.ts',
      'packages/publish-checks/vitest.integration.config.ts',
    ],
    /**
     * Half the cores, because half is **faster** than all of them.
     *
     * Measured 2026-09-29 on an idle 10-core machine, this pool, five and nine runs:
     *
     *     maxThreads 50%   44.97 48.05 48.22 48.62 49.29   median 48.2s, 5 clean
     *     no cap           50.80 51.72 51.81 52.30 52.63 52.77 53.43 54.17   median 52.4s, 9 clean
     *
     * Nine workers each running `ts.createProgram` and `apack pack build` put the box at a load of 25-32, and
     * everything gets slower together. A worker count is not free parallelism once the work is CPU-bound,
     * which every spec here is.
     *
     * Not all of that work is in-process: twelve of the twenty-four files the pool loads spawn a
     * subprocess, and two of them launch a whole nested `vitest run`. `subprocess-inventory.spec.ts`
     * holds that count, with why each one has to be a process.
     *
     * **The flake is not the reason, though it was.** These configs used to carry this cap against
     * "[vitest-worker]: Timeout calling", birpc's 60s window — which vitest hardcodes, so no config can
     * lengthen it. The cap never addressed it: measured 2026-09-30, the main process sits at **6% event-loop
     * utilisation** with a worst block of 74ms, both quiet and under load, so it was never the side that
     * failed to answer. The window expires in a *worker*, which runs each case synchronously and so turns
     * its loop only between tests — and `await` on a resolved promise drains microtasks without turning it
     * at all, making a whole file one block. `import-specifiers.integration.spec.ts` was 38s of one block on
     * an idle box, 73s beside a second pool, and that is the failure: every test passes and a reply the main
     * process sent in milliseconds goes unread. The spec yields now, and `--busy 12` under
     * `npm run measure --trials` goes from 2 of 2 failing to 0 of 3. The cap earns its place by being
     * faster; that it also shortens those blocks is a second reason, not the first.
     *
     * A percentage, because vitest reads this as `poolOptions.maxThreads ?? maxWorkers ?? (cpus - 1)`: it
     * replaces the default rather than capping it, so a fixed number raises the worker count on any machine
     * smaller than that number. `50%` is at most `cpus - 1` for cpus >= 2, so it can only lower.
     */
    poolOptions: { threads: { maxThreads: '50%' }, forks: { maxForks: '50%' } },
  },
});
