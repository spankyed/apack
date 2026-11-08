import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Large (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): the CPU one test may spend. A test that
    // needs more declares a reviewed `meta.cpuBudgetMs` (`suite-timeouts.spec.ts`)
    provide: { 'apack.testCpuMs': 120_000 },
    // Vitest's clock is off: the progress guard in setupFiles fails a test or hook whose process tree stalls, and a
    // test that spends the CPU budget above (`vitest-progress-guard.ts`, `@apackdev/testing`)
    testTimeout: 0,
    hookTimeout: 0,
    setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts', '../apack-testing/src/vitest-progress-guard.ts', './tests/_support/turn-event-loop.ts'],
    include: ['tests/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**'],
    // No worker cap here, and none in any other package either: the repo's only cap is the root
    // `vitest.integration.config.ts`'s 50%, which is what applies when this half runs in that pool. The
    // reason a cap exists at all is that a worker per core each spawning its own compiler oversubscribes the
    // box; this half is two files, so the pool is two workers on any machine. Add one when it stops being
    // two. (It read "unlike @apackdev/cli's integration half" until 2026-10-05, which had not been true since
    // that cap moved to the root.)
  },
});
