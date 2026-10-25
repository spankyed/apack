import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // A worker exits when its vitest does, rather than running on orphaned
    setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts'],
    // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts). Declared rather than left to vitest's 5s
    // default, which is *tighter* than the size allows: under the chain's three lanes a 5.8s typecheck in
    // @apackdev/sdk crossed it and reported a hang where the size had headroom to spare.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.spec.ts'],
  },
});
