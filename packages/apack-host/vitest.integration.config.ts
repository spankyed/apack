import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

const conditions = ['@apackdev/source', ...defaultServerConditions.filter(c => c !== 'module')];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Real subprocess death and recovery exercise built package boundaries, outside the fast host pool.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts'],
    include: ['tests/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
