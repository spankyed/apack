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
    // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts). A budget belongs to the size, not to each
    // test that trips over vitest's 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The fast half. The specs that spawn a compiler are `*.integration.spec.ts` and run from
    // `vitest.integration.config.ts`, which gives them 60s and half the cores.
    include: ['tests/**/*.spec.ts'],
    exclude: ['**/*.integration.spec.ts', '**/node_modules/**'],
  },
});
