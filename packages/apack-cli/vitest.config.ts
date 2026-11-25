import * as path from 'node:path';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';
import { defaultServerConditions } from 'vite';

const root = import.meta.dirname;
// Vitest's own defaults: Vite's server conditions without 'module'
const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];
// Captures go to a per-run, per-worker store, never the developer's shared one
const setupFiles = [
  path.resolve(root, '../apack-testing/src/vitest-exit-with-parent.ts'),
  path.resolve(root, '../apack-testing/src/vitest-progress-guard.ts'),
  path.resolve(root, '../apack-testing/src/vitest-git-config.ts'),
  path.resolve(root, './tests/_support/compiler-store.ts'),
];
const globalSetup = [path.resolve(root, './tests/_support/compiler-store-run.ts')];

// Proven-pure unit specs (no XState, bindHost, vi.mock, fake timers, global spies, or process/global writes).
// Any new spec added outside this list defaults to `@apackdev/cli:isolated` (`isolate: true`).
const PURE_SPECS = [
  'tests/app/beta-app.spec.ts',
  'tests/app/dev-hold.spec.ts',
  'tests/app/playwright.spec.ts',
  'tests/build/build-lock.spec.ts',
  'tests/build/build-outputs.spec.ts',
  'tests/build/build-publication.spec.ts',
  'tests/build/compiler-configuration.spec.ts',
  'tests/build/compiler-directories.spec.ts',
  'tests/build/compiler-elf-cache.spec.ts',
  'tests/build/compiler-elf-libraries.spec.ts',
  'tests/build/compiler-input-view.spec.ts',
  'tests/build/compiler-metadata.spec.ts',
  'tests/build/compiler-module-path.spec.ts',
  'tests/build/compiler-observations.spec.ts',
  'tests/build/compiler-paths.spec.ts',
  'tests/build/compiler-pe-admission.spec.ts',
  'tests/build/compiler-pe-api-sets.spec.ts',
  'tests/build/compiler-pe-libraries.spec.ts',
  'tests/build/compiler-process-group.spec.ts',
  'tests/build/compiler-runtime.spec.ts',
  'tests/build/compiler-store-key.spec.ts',
  'tests/build/compiler-test-runner.spec.ts',
  'tests/build/content-runtime-check.spec.ts',
  'tests/build/declaration-text.spec.ts',
  'tests/build/dependency-inputs.spec.ts',
  'tests/build/fe-bundler-externals.spec.ts',
  'tests/build/fe-bundler-ui-theme.spec.ts',
  'tests/build/generated-declarations.spec.ts',
  'tests/build/host-import-guard.spec.ts',
  'tests/build/node-support.spec.ts',
  'tests/build/output-evidence.spec.ts',
  'tests/build/pack-externals.spec.ts',
  'tests/build/pack-workers.spec.ts',
  'tests/build/phase-cache.spec.ts',
  'tests/build/release-plan.spec.ts',
  'tests/build/snapshot-entity-names.spec.ts',
  'tests/build/soak-rounds.spec.ts',
  'tests/build/source-map-origins.spec.ts',
  'tests/build/step-collisions.spec.ts',
  'tests/build/sweep-forget.spec.ts',
  'tests/build/tool-identity.spec.ts',
  'tests/build/trigger-track-helpers.spec.ts',
  'tests/build/verify-node-modules.spec.ts',
  'tests/build/watch-vanished-directory.spec.ts',
  'tests/commands/add-command.spec.ts',
  'tests/commands/add-manifest.spec.ts',
  'tests/commands/app-launcher.spec.ts',
  'tests/commands/backup.spec.ts',
  'tests/commands/db-output.spec.ts',
  'tests/commands/debug-port-gate.spec.ts',
  'tests/commands/fetch-deps.spec.ts',
  'tests/commands/handoff.spec.ts',
  'tests/commands/idle-reap.spec.ts',
  'tests/commands/init-tests-playwright.spec.ts',
  'tests/commands/pack-mutation.spec.ts',
  'tests/commands/pack-provenance.spec.ts',
  'tests/commands/pack-updates.spec.ts',
  'tests/commands/pack-upgrade.spec.ts',
  'tests/commands/reclaim.spec.ts',
  'tests/commands/scaffold-templates.spec.ts',
  'tests/commands/source-hooks.spec.ts',
  'tests/commands/spawn-lock.spec.ts',
  'tests/commands/status.spec.ts',
  'tests/commands/upgrade.spec.ts',
  'tests/harness/isolated-data-dir.spec.ts',
  'tests/manifest-writer.spec.ts',
];

const shared = {
  root,
  // Workspace @apackdev/* packages resolve to source (see their package.json exports)
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): the CPU one test may spend. A test that
    // needs more declares a reviewed `meta.cpuBudgetMs` (`suite-timeouts.spec.ts`)
    provide: { 'apack.testCpuMs': 30_000 },
    // Vitest's clock is off: the progress guard in setupFiles fails a test or hook whose process tree stalls, and a
    // test that spends the CPU budget above (`vitest-progress-guard.ts`, `@apackdev/testing`)
    testTimeout: 0,
    hookTimeout: 0,
    setupFiles,
    globalSetup,
  },
};

// The fast suite: every spec here runs in-process. The specs that run a real build, an install or
// another process are `*.integration.spec.ts` and run from `vitest.integration.config.ts`.
// `CLAUDE.md` has the rule for choosing, which is a judgement rather than a measured threshold.
export const projects: TestProjectConfiguration[] = [
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/cli:pure',
      isolate: false,
      include: PURE_SPECS,
      exclude: ['**/*.integration.spec.ts', '**/*.native.spec.ts', '**/node_modules/**'],
    },
  },
  {
    ...shared,
    test: {
      ...shared.test,
      name: '@apackdev/cli:isolated',
      isolate: true,
      include: ['tests/**/*.spec.ts'],
      exclude: ['**/*.integration.spec.ts', '**/*.native.spec.ts', '**/node_modules/**', ...PURE_SPECS],
    },
  },
];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { projects },
});
