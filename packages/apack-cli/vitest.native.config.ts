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
    // Enormous (`SIZE_MS` × `DEADLINE_FACTOR`): a native case composes cold compiler captures, builds and watcher cycles. A case
    // that needs longer still declares a reviewed per-test budget.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    setupFiles: ['../../scripts/lib/vitest-exit-with-parent.ts', './tests/_support/turn-event-loop.ts', './tests/_support/compiler-store.ts'],
    globalSetup: ['./tests/_support/compiler-store-run.ts'],
    include: ['tests/**/*.native.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
