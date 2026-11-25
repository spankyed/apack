import * as path from 'node:path';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';
import { defaultServerConditions } from 'vite';

const root = import.meta.dirname;
// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];
const setupFiles = [
  path.resolve(root, '../apack-testing/src/vitest-exit-with-parent.ts'),
  path.resolve(root, '../apack-testing/src/vitest-progress-guard.ts'),
  path.resolve(root, '../apack-testing/src/vitest-git-config.ts'),
];

// Specs that mutate process.env, globalThis, fake timers, or module mocks stay isolated.
const ISOLATED = [
  'tests/chain-inputs.spec.ts',
  'tests/identity-guard.spec.ts',
  'tests/packaged-app-files.spec.ts',
  'tests/packaged-app.spec.ts',
  'tests/performance-scenario-view.spec.ts',
  'tests/preview-build.spec.ts',
  'tests/with-source.spec.ts',
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

// The fast half. The specs that spawn a compiler are `*.integration.spec.ts` and run from
// `vitest.integration.config.ts`, which gives them 60s and half the cores.
export const projects: TestProjectConfiguration[] = [
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@app/internal-repo-checks:pure',
      isolate: false,
      include: ['tests/**/*.spec.ts'],
      exclude: ['**/*.integration.spec.ts', '**/node_modules/**', ...ISOLATED],
    },
  },
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@app/internal-repo-checks:isolated',
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
