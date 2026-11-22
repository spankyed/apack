import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { callsHelper, declaresKey } from './_support/config-code.ts';
import { repoFiles } from './_support/repo-files.ts';

/**
 * A pack's vitest config is a call to `definePackTestConfig`, not a copy of one.
 *
 * There were three of these and they had drifted: the built-in pack, the repo's fixture pack and the config
 * `apack pack init` scaffolds each restated the same settings, and one ran without `globals` while another set
 * it. Nobody decided that; it is what three copies do, and a fourth copy is a `cp` away — which is why this
 * is a check and not a convention.
 *
 * The rule is deliberately blunt: **call the helper, and declare no `test` block of your own.** Everything a
 * pack needs is an option (`dataDirPrefix`, `exclude`, `surfaces`, `setupFiles`, `vue`), so a `test` block
 * means the pack has stopped delegating — and an exception below then records which pack had to escape and
 * why, which is the part worth knowing.
 */

const HELPER = 'definePackTestConfig';

/**
 * A pack config that declares a `test` block anyway, and why.
 *
 * Keep this small: an entry is a pack whose suite needs something the helper cannot express,
 * which is a reason to widen the helper at least as often as it is a reason to escape it.
 */
const DECLARES_ITS_OWN_TEST_BLOCK: Record<string, string> = {
  'packages/default-setup/vitest.config.ts': 'Separate Node/backend and Vue/jsdom frontend projects, both composed from the helper; it configures one environment per call, not a project matrix.',
};

const tracked = (pattern: string): string[] =>
  repoFiles(pattern);

/** Every pack in the repo that has a vitest config: a directory holding both `apack.json` and one */
const packConfigs = (): string[] => tracked('*apack.json')
  .map((manifest) => path.join(path.dirname(manifest), 'vitest.config.ts'))
  .filter((config) => fs.existsSync(path.join(REPO_ROOT, config)))
  .sort();

/** Whether the code calls the helper, and whether it declares a `test` block of its own */
const calls = (source: string): boolean => callsHelper(source, HELPER);
const declaresTestBlock = (source: string): boolean => declaresKey(source, 'test');

const read = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');

describe("a pack's vitest config calls definePackTestConfig", () => {
  it('there are pack configs to check, so this is not vacuous', () => {
    expect(packConfigs()).not.toEqual([]);
  });

  it('leaves none of them assembling their own', () => {
    const copies = packConfigs().filter((config) => !calls(read(config)));
    expect(copies, `these restate what ${HELPER} (@apackdev/testing/vitest) holds. Call it instead: what a pack `
      + 'needs on top is an option').toEqual([]);
  });

  it('leaves none of them declaring a test block of their own', () => {
    const own = packConfigs()
      .filter((config) => declaresTestBlock(read(config)))
      .filter((config) => !(config in DECLARES_ITS_OWN_TEST_BLOCK));
    expect(own, `pass what this pack needs to ${HELPER} as an option, or record it in `
      + 'DECLARES_ITS_OWN_TEST_BLOCK with what the helper cannot express').toEqual([]);
  });

  it('lists no exception that has stopped applying', () => {
    const stale = Object.keys(DECLARES_ITS_OWN_TEST_BLOCK)
      .filter((config) => !fs.existsSync(path.join(REPO_ROOT, config)) || !declaresTestBlock(read(config)));
    expect(stale, 'these are gone or no longer declare one; drop them from DECLARES_ITS_OWN_TEST_BLOCK').toEqual([]);
  });

  /**
   * And the config a pack author is *given*, which is the one that matters most: every pack outside this repo
   * starts as a copy of it, so a template that assembled its own would put the drift back at the source.
   */
  it('is what apack pack init scaffolds', () => {
    // The template is a file now, so this reads the file rather than a literal out of init.ts
    // (`docs/goals/goal-one-rule-set.md`) — the same two assertions over a stronger subject.
    const template = read(path.join('packages', 'apack-cli', 'templates', 'pack', 'vitest.config.ts'));
    expect(calls(template), "the scaffolded config is where a pack author's copy comes from — and the "
      + 'comment above the call mentions the helper too, so this reads the code and not the prose').toBe(true);
    expect(declaresTestBlock(template), 'the scaffold declares a test block of its own').toBe(false);
  });
});
