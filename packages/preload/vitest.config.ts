import * as path from 'node:path';
import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: {
    conditions,
    // The bridge imports Electron; a test runs it on Node, so `contextBridge` and `ipcRenderer` are stubs
    // that record what it asked Electron to do — `@app/main`'s suite is the same arrangement
    alias: { electron: path.resolve(import.meta.dirname, 'tests/electron-stub.ts') },
  },
  ssr: { resolve: { conditions } },
  test: {
    // A worker exits when its vitest does, rather than running on orphaned
    setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts', '../apack-testing/src/vitest-progress-guard.ts'],
    // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): the CPU one test may spend. A test that
    // needs more declares a reviewed `meta.cpuBudgetMs` (`suite-timeouts.spec.ts`)
    provide: { 'apack.testCpuMs': 30_000 },
    // Vitest's clock is off: the progress guard in setupFiles fails a test or hook whose process tree stalls, and a
    // test that spends the CPU budget above (`vitest-progress-guard.ts`, `@apackdev/testing`)
    testTimeout: 0,
    hookTimeout: 0,
    include: ['tests/**/*.spec.ts'],
  },
});
