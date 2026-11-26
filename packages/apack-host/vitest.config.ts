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

// Pure subdirectories opted into `isolate: false`; every other tree (bus, features, fe, packs, services, etc.)
// defaults to `isolate: true`.
const PURE_DIRS = ['broker', 'build', 'database', 'diagnostics', 'logs'] as const;
// Specs in the opted-in trees (or top-level `tests/*.spec.ts`) that use bindHost, vi.mock,
// fake timers, global spies, or globalThis writes stay isolated.
const PURE_TREE_ISOLATED = [
  'tests/build/compiler-inputs/compiler-file-reads.spec.ts',
  'tests/build/compiler-paths.windows.spec.ts',
  'tests/build/compiler-watch-paths.spec.ts',
  'tests/build/package-inputs.spec.ts',
  'tests/build/shared-deps.spec.ts',
  'tests/build/source-resolution.spec.ts',
  'tests/build/subpath-imports.spec.ts',
  'tests/database/open-elmdb.spec.ts',
  'tests/diagnostics/process-statistics.spec.ts',
  'tests/diagnostics/profiles.spec.ts',
  'tests/events.spec.ts',
  'tests/private-file.spec.ts',
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

export const projects: TestProjectConfiguration[] = [
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/host:pure',
      isolate: false,
      include: ['tests/*.spec.ts', ...PURE_DIRS.map((dir) => `tests/${dir}/**/*.spec.ts`)],
      exclude: ['**/node_modules/**', ...PURE_TREE_ISOLATED],
    },
  },
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/host:isolated',
      isolate: true,
      include: [`tests/!(${PURE_DIRS.join('|')})/**/*.spec.ts`, ...PURE_TREE_ISOLATED],
      exclude: ['**/node_modules/**'],
    },
  },
];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { projects },
});
