import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): the CPU one test may spend. A test that
    // needs more declares a reviewed `meta.cpuBudgetMs` (`suite-timeouts.spec.ts`)
    provide: { 'apack.testCpuMs': 30_000 },
    // Vitest's clock is off: the progress guard in setupFiles fails a test or hook whose process tree stalls, and a
    // test that spends the CPU budget above (`vitest-progress-guard.ts`, `@apackdev/testing`)
    testTimeout: 0,
    hookTimeout: 0,
    // The fast suite: every spec here runs in-process. The specs that run a real build, an install or
    // another process are `*.integration.spec.ts` and run from `vitest.integration.config.ts`.
    // `CLAUDE.md` has the rule for choosing, which is a judgement rather than a measured threshold.
    // Captures go to a per-run, per-worker store, never the developer's shared one
    setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts', '../apack-testing/src/vitest-progress-guard.ts', './tests/_support/compiler-store.ts'],
    globalSetup: ['./tests/_support/compiler-store-run.ts'],
    include: ['tests/**/*.spec.ts'],
    exclude: ['**/*.integration.spec.ts', '**/*.native.spec.ts', '**/node_modules/**'],
  },
});
