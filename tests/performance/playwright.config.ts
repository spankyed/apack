import { defineConfig } from '@playwright/test';

/** Manual performance qualification; ordinary CI enforces contracts, never these timings. */
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1, retries: 0,
  timeout: 120_000, outputDir: '../../.apack/performance/playwright',
  use: { viewport: { width: 1400, height: 900 }, trace: 'off', screenshot: 'off' },
});
