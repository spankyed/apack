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

// Pure subdirectories opted into `isolate: false`; every other tree defaults to `isolate: true`.
const PURE_DIRS = ['build', 'utils', 'ids', 'events', 'framework', 'steps', 'services'] as const;
// Specs inside PURE_DIRS that use bindHost, XState, process.env writes, or global spies stay isolated.
const PURE_DIR_ISOLATED = [
  'tests/build/content-compiler.spec.ts',
  'tests/build/flow-compiler.spec.ts',
  'tests/build/flow-dsl-validator.spec.ts',
  'tests/build/flow-round-trip.spec.ts',
  'tests/build/generate-entries/entries.spec.ts',
  'tests/build/manifest-editor.spec.ts',
  'tests/events/calls.spec.ts',
  'tests/events/define-events.spec.ts',
  'tests/framework/define-system-actions.spec.ts',
  'tests/framework/define-system-answers.spec.ts',
  'tests/framework/pack-system.spec.ts',
  'tests/services/embeddings.spec.ts',
  'tests/services/emitter.spec.ts',
  'tests/services/secrets-client.spec.ts',
  'tests/steps/catalog.spec.ts',
  'tests/utils/applier-registry.spec.ts',
  'tests/utils/paths.spec.ts',
  'tests/utils/redact.spec.ts',
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
    // Test files run in parallel: each worker's tests create their own EARS engines
    fileParallelism: true,
  },
};

export const projects: TestProjectConfiguration[] = [
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/sdk:pure',
      isolate: false,
      include: PURE_DIRS.map((dir) => `tests/${dir}/**/*.spec.ts`),
      exclude: ['**/node_modules/**', ...PURE_DIR_ISOLATED],
    },
  },
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/sdk:isolated',
      isolate: true,
      include: ['tests/*.spec.ts', `tests/!(${PURE_DIRS.join('|')})/**/*.spec.ts`, ...PURE_DIR_ISOLATED],
      exclude: ['**/node_modules/**'],
    },
  },
];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { projects },
});
