import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Large (`SIZE_MS` × `DEADLINE_FACTOR`): these specs run `tsc` over fixture trees, which is tens of seconds of
    // work in a handful of tests.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    setupFiles: ['../../scripts/lib/vitest-exit-with-parent.ts', './tests/_support/turn-event-loop.ts'],
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
