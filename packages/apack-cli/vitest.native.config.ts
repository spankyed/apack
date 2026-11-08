import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';
import { assertCompilerTestRunner } from './tests/_support/compiler-test-runner.ts';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

// The native half: specs that execute a captured native compiler runtime or hold live filesystem watchers.
// Same settings as the integration half; its own file so the two run, and are selected, apart.
export default defineConfig({
  // The runner check runs when vitest sets this project up, before any spec loads
  plugins: [{ name: 'compiler-test-runner', configResolved: () => assertCompilerTestRunner() }],
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // From process start, since tsx reads it as it loads: its disk cache is outside a build's captured inputs
    env: { TSX_DISABLE_CACHE: '1' },
    // Enormous (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): the CPU one test may spend. A test that
    // needs more declares a reviewed `meta.cpuBudgetMs` (`suite-timeouts.spec.ts`)
    provide: { 'apack.testCpuMs': 600_000 },
    // Vitest's clock is off: the progress guard in setupFiles fails a test or hook whose process tree stalls, and a
    // test that spends the CPU budget above (`vitest-progress-guard.ts`, `@apackdev/testing`)
    testTimeout: 0,
    hookTimeout: 0,
    setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts', '../apack-testing/src/vitest-progress-guard.ts', './tests/_support/turn-event-loop.ts', './tests/_support/compiler-store.ts'],
    globalSetup: ['./tests/_support/compiler-store-run.ts'],
    include: ['tests/**/*.native.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
