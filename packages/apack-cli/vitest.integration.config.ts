import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

// Runs directly on a Mac: its builds reuse the shared compiler store, so macOS assesses each runtime and compiler
// executable once rather than per build (measured: no runtime or compiler assessments across ten builds). The
// native half, whose fixtures are new executables by construction, keeps the runner guard.
export default defineConfig({
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Large (`SIZE_MS` × `DEADLINE_FACTOR`). Longer multi-build scenarios declare reviewed per-test budgets.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    setupFiles: ['../../scripts/lib/vitest-exit-with-parent.ts', './tests/_support/turn-event-loop.ts', './tests/_support/compiler-store.ts'],
    globalSetup: ['./tests/_support/compiler-store-run.ts'],
    include: ['tests/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
