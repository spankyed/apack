import { describe, expect, it } from 'vitest';
import {
  defineDriveConfig,
  definePerformanceConfig,
  definePackE2EConfig,
  e2eWorkers,
} from '../src/playwright.ts';

/** Config helpers keep suite, driving and manual qualification policies in their owning test toolkit. */

describe("a pack's E2E config", () => {
  it('holds the settings the four copies used to restate', () => {
    expect(definePackE2EConfig()).toMatchObject({
      testDir: 'tests/e2e',
      timeout: 60_000,
      workers: e2eWorkers(),
      outputDir: '.apack/tests/results',
    });
  });

  it('runs an app per three cores, each on its own data dir, and one when the data dir is pinned', () => {
    expect(e2eWorkers({}, 10)).toBe(3);
    expect(e2eWorkers({}, 3)).toBe(1);
    expect(e2eWorkers({}, 2), 'never none').toBe(1);
    expect(e2eWorkers({ E2E_DATA_DIR: '/tmp/profile' }, 10), 'one pinned dir is one app').toBe(1);
  });

  it("takes the pack's own word last, so a suite can add to it", () => {
    const config = definePackE2EConfig({ retries: 2, use: { screenshot: 'on' } });

    expect(config.retries).toBe(2);
    expect(config.use).toEqual({ screenshot: 'on' });
    // and still carries what it did not override
    expect(config.timeout).toBe(60_000);
  });

  it('lets a suite that genuinely needs longer say so', () => {
    expect(definePackE2EConfig({ timeout: 120_000 }).timeout).toBe(120_000);
  });
});

describe('a driving config', () => {
  it('collects the scripts beside it, with no timeout: someone is watching', () => {
    expect(defineDriveConfig()).toMatchObject({
      testDir: '.',
      testMatch: '**/*.ts',
      workers: 1,
      timeout: 0,
      outputDir: '../.apack/drive/results',
    });
  });

  /**
   * The one entry a pack cannot undo, and the reason `testIgnore` is appended to rather than taken whole:
   * `testMatch` is `**\/*.ts` so a driving run collects every script beside it, and the config is one of
   * those files. Collected, it would be run as a script — a widened `testMatch` must not change that.
   */
  it('ignores its own config however testMatch is widened', () => {
    const config = defineDriveConfig({ testMatch: '**/*.{ts,mts}' });

    expect(config.testMatch).toBe('**/*.{ts,mts}');
    expect(config.testIgnore).toContain('playwright.config.ts');
  });

  it("keeps a pack's own testIgnore beside the config, rather than replacing it", () => {
    expect(defineDriveConfig({ testIgnore: 'scratch.ts' }).testIgnore)
      .toEqual(['playwright.config.ts', 'scratch.ts']);
  });

  it('takes a testIgnore in any of the shapes Playwright accepts', () => {
    expect(defineDriveConfig({ testIgnore: ['a.ts', 'b.ts'] }).testIgnore)
      .toEqual(['playwright.config.ts', 'a.ts', 'b.ts']);
    expect(defineDriveConfig({ testIgnore: /scratch/ }).testIgnore)
      .toEqual(['playwright.config.ts', /scratch/]);
  });
});



it('qualifies performance serially without retries, screenshots or tracing overhead by default', () => {
  expect(definePerformanceConfig()).toMatchObject({ workers: 1, retries: 0,
    testDir: '.', testMatch: '*.spec.ts', use: { trace: 'off', screenshot: 'off' } });
});
