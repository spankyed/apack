import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Large (`SIZE_MS` × `DEADLINE_FACTOR`): each of these npm-packs three packages into a temp consumer and compiles
    // it across the TypeScript matrix, which is tens of seconds of work in a handful of tests.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    setupFiles: ['../../scripts/lib/vitest-exit-with-parent.ts', './tests/_support/turn-event-loop.ts'],
    include: ['tests/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
