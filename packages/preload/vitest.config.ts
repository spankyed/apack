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
    setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts'],
    // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts). Declared rather than left to vitest's 5s default,
    // which is *tighter* than the size allows and reports a hang where the size has headroom
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.spec.ts'],
  },
});
