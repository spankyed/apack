// Playwright configurations for E2E suites, driving and manual application-performance qualification.
//
//   import { definePackE2EConfig } from '@apackdev/testing/playwright';
//   export default definePackE2EConfig();
//
// The counterpart to `@apackdev/testing/vitest` for the other runner, and it exists for the same reason: six
// configs restated these settings, and the repo's own had already drifted to a `use` block the three packs'
// lacked. A setting held here reaches a pack on its next update; one copied into a pack's own config does
// not — which is how a `testIgnore` became unaddable and the engine's session got an extension instead.
import { availableParallelism } from 'node:os';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * How many apps a pack's suite runs at once. Each worker launches its own app on its own temporary data dir,
 * and the app's single-instance lock is scoped by data dir, so workers do not contend for one. An app is three
 * processes (main, renderer and the API), so one worker per three cores. A data dir the caller pins
 * (`E2E_DATA_DIR`) is one dir, so a run with one takes one worker.
 */
export function e2eWorkers(env: NodeJS.ProcessEnv = process.env, cores = availableParallelism()): number {
  return env.E2E_DATA_DIR ? 1 : Math.max(1, Math.floor(cores / 3));
}

/** A pack's driving config, which collects the scripts beside it */
const DRIVE_CONFIG_FILE = 'playwright.config.ts';

/**
 * A pack's E2E suite, run by `apack pack test`.
 *
 * Nothing in the tooling reads these back, so a pack's own word is last — pass anything Playwright takes.
 *
 * **`timeout` has to stay a literal here.** `suite-timeouts.spec.ts` (`@app/repo-checks`) reads a config's
 * timeouts as *text* rather than importing one, following the delegation to this file, and holds the value
 * to the large size budget (`SIZE_MS`, `scripts/lib/unit-suites.ts`). Computing it would read as absent.
 */
export function definePackE2EConfig(options: PlaywrightTestConfig = {}): PlaywrightTestConfig {
  return defineConfig({
    testDir: 'tests/e2e',
    // The large budget: an E2E test that takes longer is hung, not slow
    timeout: 60_000,
    workers: e2eWorkers(),
    // Generated run output stays outside the authored input scope.
    outputDir: '.apack/tests/results',
    ...options,
  });
}

/** What a driving config may set: everything but where it looks, which the `drive/` layout decides */
export type DriveConfigOptions = Omit<PlaywrightTestConfig, 'testDir'>;

/**
 * A pack's driving scripts, run by `apack pack drive`. Driving is not testing: nothing asserts and nothing
 * gates on it, so there is no budget to hold and no timeout at all — you are looking at the app.
 *
 * **The session is ignored whatever `testMatch` says**, which is the one thing a pack cannot override. A
 * driving run that collected the engine would start it and hang, waiting for an HTTP request that the
 * person watching has no reason to send. Until this helper existed that was prevented by the session's
 * `.mts` extension falling outside this config's `**\/*.ts` glob — a true accident of two defaults, and one
 * that a pack widening its own `testMatch` to `.mts` would have undone with no warning.
 */
export function defineDriveConfig(options: DriveConfigOptions = {}): PlaywrightTestConfig {
  return defineConfig({
    // Any .ts file: a driving script should not have to be named like a spec
    testMatch: '**/*.ts',
    // One app at a time; two scripts would fight over the same data dir
    workers: 1,
    // No timeout: you are looking at it
    timeout: 0,
    reporter: 'list',
    // The config lives in drive/; generated output belongs to the pack's private work directory.
    outputDir: '../.apack/drive/results',
    ...options,
    testDir: '.',
    testIgnore: [DRIVE_CONFIG_FILE, ...ignored(options.testIgnore)],
  });
}

/** A `testIgnore` as a list, whatever shape it was given: Playwright takes one or many, and a RegExp too */
function ignored(testIgnore: PlaywrightTestConfig['testIgnore']): (string | RegExp)[] {
  if (testIgnore === undefined) return [];
  return Array.isArray(testIgnore) ? [...testIgnore] : [testIgnore];
}


/** Manual application qualification in tests/performance: one owned app, explicit trials, no automatic diagnostic overhead. */
export function definePerformanceConfig(options: PlaywrightTestConfig = {}): PlaywrightTestConfig {
  return defineConfig({
    testDir: '.', testMatch: '*.spec.ts', workers: 1, retries: 0,
    timeout: 120_000, outputDir: '../../.apack/performance/playwright',
    use: { viewport: { width: 1400, height: 900 }, trace: 'off', screenshot: 'off' },
    ...options,
  });
}
