import * as path from 'node:path';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';
import { defaultServerConditions } from 'vite';

const root = import.meta.dirname;
// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];
const setupFiles = [
  path.resolve(root, './src/vitest-exit-with-parent.ts'),
  path.resolve(root, './src/vitest-progress-guard.ts'),
  path.resolve(root, './src/vitest-git-config.ts'),
];

// Specs that use XState, fake timers, vi.mock, global spies, or process/global mutations stay isolated.
const ISOLATED = [
  'tests/application-window.spec.ts',
  'tests/engine/cdp-page.spec.ts',
  'tests/engine/session.spec.ts',
  'tests/fixture-registration.spec.ts',
  'tests/performance/markers.spec.ts',
  'tests/performance/revision.spec.ts',
  'tests/vitest-exit-with-parent.spec.ts',
];

const shared = {
  root,
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // A worker exits when its vitest does, rather than running on orphaned
    setupFiles,
    // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): the CPU one test may spend. A test that
    // needs more declares a reviewed `meta.cpuBudgetMs` (`suite-timeouts.spec.ts`)
    provide: { 'apack.testCpuMs': 30_000 },
    // Vitest's clock is off: the progress guard in setupFiles fails a test or hook whose process tree stalls, and a
    // test that spends the CPU budget above (`vitest-progress-guard.ts`, `@apackdev/testing`)
    testTimeout: 0,
    hookTimeout: 0,
  },
};

// One half, because every spec here builds its own fixture in a temp directory. A spec that needs a
// 60s budget or a capped worker pool needs a second config first.
export const projects: TestProjectConfiguration[] = [
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/testing:pure',
      isolate: false,
      include: ['tests/**/*.spec.ts'],
      exclude: ['**/node_modules/**', ...ISOLATED],
    },
  },
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/testing:isolated',
      isolate: true,
      include: ISOLATED,
      exclude: ['**/node_modules/**'],
    },
  },
];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { projects },
});
