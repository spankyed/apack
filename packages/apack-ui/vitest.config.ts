import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';
import vue from 'unplugin-vue/vite';

// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  plugins: [vue()],
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
    // One half, because every spec here builds its own fixture in a temp directory and none reads the
    // built packages. A spec that needs a 60s budget or a capped worker pool needs a second config first.
    include: ['tests/**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
