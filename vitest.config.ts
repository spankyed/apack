import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // The host suites resolve the workspace @apackdev packages to source. Safe to set here because every
  // project below is a host package: the pack suite is deliberately not one, and runs from its own config
  // in its own process, where it resolves the published dist.
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    /**
     * The host unit suites as one vitest run, so they share one job pool and one worker budget.
     *
     * Two schedulers with no shared budget was the ceiling: `scripts/test-unit.ts` scheduled suites while
     * vitest scheduled the files inside each one, so a third lane oversubscribed within a suite rather than
     * filling idle cores. Vitest's sequencer takes every project's files as one list and sorts it
     * longest-first, which is the greedy makespan approximation across package boundaries.
     *
     * Each project loads its own config, which is where its environment, setup files and per-project
     * settings live — nothing is flattened here.
     *
     * **The pack suite is not here, and cannot be.** `@app/default-setup` must resolve the published
     * `dist` while these resolve source, and Node conditions are per process: vitest shares its worker pool
     * across projects and ignores per-project `poolOptions.execArgv`, measured. Under a pooled process
     * carrying the condition, a `default-setup` spec resolves `@apackdev/sdk` to `src` where it resolves
     * `dist` today — it would not have failed, it would have quietly tested something else. So there are
     * two pools, split on the boundary `check:specifiers` already enforces.
     *
     * Written out rather than derived from `UNIT_SUITES`, because `check:specifiers` reads this file as
     * text and cannot read a computed list. `chain-inputs.spec.ts` asserts it is exactly the host suites,
     * so it cannot drift.
     */
    projects: [
      'packages/apack-sdk',
      'packages/apack-cli',
      'packages/apack-host',
      'packages/server',
      'packages/internal-repo-checks',
      'packages/renderer',
      'packages/main',
      'packages/preload',
      'packages/apack-testing',
      'packages/apack-ui',
      'packages/internal-publish-checks',
    ],
  },
});
