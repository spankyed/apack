import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { callsHelper, declaresKey } from './_support/config-code.ts';
import { repoFiles } from './_support/repo-files.ts';

/**
 * A Playwright config is a call to a helper, not a copy of one.
 *
 * The sibling of `pack-test-config.spec.ts`, and it exists because the vitest half of this question was
 * answered and the Playwright half was not. There were six of these: the repo's own E2E config, the one
 * `apack pack init-tests` scaffolds, both fixture packs', and the drive layer's two — and the repo's own had
 * already drifted to a `use` block giving it screenshots and traces that the three packs' lacked. Nobody
 * decided that; it is what six copies do.
 *
 * One helper per kind of run (`@apackdev/testing/playwright`), because a setting means something different
 * to each: an E2E suite has a budget to hold, a driving run has no timeout at all because someone is
 * watching it, and a serving session has four settings its HTTP handshake depends on.
 */

const HELPERS = ['definePackE2EConfig', 'defineDriveConfig', 'definePerformanceConfig'] as const;

/** The settings a helper owns, which a config restating one has stopped delegating */
const OWNED_KEYS = ['testDir', 'testMatch', 'workers', 'timeout', 'outputDir'] as const;

/**
 * A config that assembles its own anyway, and why.
 *
 * Empty, and meant to stay small: an entry is a config that needs something no helper can express, which
 * is a reason to widen a helper at least as often as it is a reason to escape one.
 */
const ASSEMBLES_ITS_OWN: Record<string, string> = {};

const read = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');

/**
 * Every Playwright config this repo tracks, derived from the tree rather than listed.
 *
 * A listed population is the failure this check is here to prevent — a seventh copy is a `cp` away, and a
 * hand-written list would not see it.
 */
const playwrightConfigs = (): string[] => [
  ...repoFiles('*playwright.config.ts'),
].sort();

const delegates = (file: string): boolean => HELPERS.some((helper) => callsHelper(read(file), helper));

describe('a Playwright config calls its helper', () => {
  it('there are configs to check, so this is not vacuous', () => {
    // Six at the time of writing: the root, the scaffolded template, two fixture packs, and drive's pair
    expect(playwrightConfigs().length).toBeGreaterThan(4);
  });

  it('leaves none of them assembling their own', () => {
    const copies = playwrightConfigs()
      .filter((config) => !delegates(config))
      .filter((config) => !(config in ASSEMBLES_ITS_OWN));

    expect(copies, 'these restate what @apackdev/testing/playwright holds, so a change there will not reach '
      + 'them. Call the helper for their kind of run instead: what a config needs on top is an argument')
      .toEqual([]);
  });

  it('leaves none of them restating a setting its helper owns', () => {
    const restated = playwrightConfigs()
      .filter((config) => !(config in ASSEMBLES_ITS_OWN))
      .flatMap((config) => OWNED_KEYS
        .filter((key) => declaresKey(read(config), key))
        .map((key) => `${config} declares ${key}`));

    expect(restated, 'pass what this config needs to its helper as an argument, or record it in '
      + 'ASSEMBLES_ITS_OWN with what no helper can express').toEqual([]);
  });

  it('lists no exception that has stopped applying', () => {
    const stale = Object.keys(ASSEMBLES_ITS_OWN)
      .filter((config) => !fs.existsSync(path.join(REPO_ROOT, config)) || delegates(config));

    expect(stale, 'these are gone or now delegate; drop them from ASSEMBLES_ITS_OWN').toEqual([]);
  });

  /**
   * And the configs a pack author is *given*, which matter most: every pack outside this repo starts as a
   * copy of one, so a template that assembled its own would put the drift back at the source.
   *
   * All three are files under `templates/`, which is the stronger subject — the drive pair were string
   * literals in the command until this check wanted to read them. `scaffold-templates.spec.ts` holds the
   * other half, that each one is still rendered by a call site.
   */
  it.each([
    ['pack/playwright.config.ts', 'definePackE2EConfig'],
    ['drive/playwright.config.ts', 'defineDriveConfig'],
  ])('is what the %s scaffold writes', (template, helper) => {
    const source = read(path.join('packages', 'apack-cli', 'templates', template));

    expect(callsHelper(source, helper), `the ${template} template assembles its own`).toBe(true);
    for (const key of OWNED_KEYS) {
      expect(declaresKey(source, key), `the ${template} template restates ${key}`).toBe(false);
    }
  });
});
