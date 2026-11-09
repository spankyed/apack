import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inputFiles, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, INTEGRATION_SUITES, NATIVE_SUITES, SUITE_SETUP_FILES, suiteInputs } from '../../../scripts/lib/chain-steps.ts';
import { UNIT_SUITES, unitStepName, type UnitSuite } from '../../../scripts/lib/unit-suites.ts';
import { reachableFrom } from '../../../scripts/lib/module-graph.ts';
import type { Half } from '../../../scripts/lib/spec-halves.ts';

/** The halves a suite runs in: every suite has a fast one, and the others where it has their config */
const halvesOf = (suite: UnitSuite): Half[] => [
  'fast',
  ...(INTEGRATION_SUITES.some((other) => other.dir === suite.dir) ? ['integration' as const] : []),
  ...(NATIVE_SUITES.some((other) => other.dir === suite.dir) ? ['native' as const] : []),
];
import { population } from '@apackdev/sdk/testing';

/**
 * A suite declares the files its specs load.
 *
 * `chain-inputs.spec.ts` asks the coverage question — every tracked file is *some* step's input — and that
 * leaves the per-suite one unasked: does this suite declare what this suite reads. Three defects in one
 * week were that gap, each found by accident rather than by a check: `test:smoke` cached stale over the
 * bundle it drives, the repo-wide guards ran against 13% of their subject, and a doc a spec asserts sat in
 * no step's inputs.
 *
 * The consequence is specific and quiet. A suite's project is re-run when *its* declared inputs move
 * (`poolUnitFor`, `scripts/lib/unit-pool.ts`), so a spec that imports a file nobody declared keeps its last
 * result while that file changes. Measured on the two this found: touching
 * `packages/apack-ui/src/tailwind-preset.ts` left `@apackdev/cli`'s project not stale, and the spec that
 * imports it did not re-run.
 *
 * **Relative imports only**, which is what `reachableFrom` follows. A bare `@apackdev/…` specifier is covered
 * instead by `workspaceDeps` reading the manifest, so this compares a graph against a declaration *and*
 * another declaration rather than against an observation — worth knowing before trusting it as proof. What
 * it cannot see at all is a path built at runtime: the repo-wide guards ask git what the tree holds, which
 * `SUITE_READS.repo` declares and `fingerprint-scope.spec.ts` holds to the specs that do it.
 */

/**
 * What a declared input holds, read once per path however many questions ask about it.
 *
 * Not a convenience: both sides of the second case below expand declared paths, and a chain run has another
 * lane writing into each fixture pack's `dist` under `tests/packs` while this one runs. Taken as two walks, the suite's side saw three
 * fixture build outputs the step's side had walked a moment earlier and missed, and the case reported the step
 * as declaring less than its suite reads — the defect it exists to find, over a difference that was only the
 * clock. Measured 2026-10-01 in a chain where `test:external-pack:contract` wrote them at the moment this ran.
 *
 * One reading, so a verdict and the tree it is about are the same tree.
 */
const expanded = new Map<string, string[]>();
function filesUnder(input: string): string[] {
  const found = expanded.get(input) ?? inputFiles(path.join(REPO_ROOT, input));
  expanded.set(input, found);
  return found;
}

/** Every spec in a suite, which is where the walk starts. */
function specsOf(suite: UnitSuite): string[] {
  const root = path.join(REPO_ROOT, 'packages', suite.dir, 'tests');
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.spec.ts')) found.push(full);
    }
  };
  walk(root);
  return found;
}

/**
 * What a suite's specs load, and what that suite says it reads — both as repo-relative paths.
 *
 * Memoised, because both cases below ask it of every suite and the walk is the whole cost of this file:
 * taking it twice measured 2.5s against a 2.5s edge, and the half that would have moved it to is the one
 * declaring no repo-wide tree — so the spec would have gone blind to every package it is here to watch.
 */
const walked = new Map<string, { reached: string[]; declared: Set<string> }>();
function reads(suite: UnitSuite): { reached: string[]; declared: Set<string> } {
  const found = walked.get(suite.dir) ?? {
    reached: reachableFrom(specsOf(suite), [REPO_ROOT]).map((file) => path.relative(REPO_ROOT, file)),
    // Every half this suite *has*, because the walk covers every spec in it rather than one half's: the
    // question is whether anything declares a file the specs load, not which pool run would re-read it.
    // The halves it has, not both — a suite with no integration config declares no integration half, and
    // crediting it with one invents an input nothing declares, which the step case below reports as the step
    // under-declaring. Per-half is the tighter question and needs the specs split first, which `halfOfPath`
    // can do and this does not.
    declared: new Set(halvesOf(suite).flatMap((half) => suiteInputs(suite, half)).flatMap(filesUnder)),
  };
  walked.set(suite.dir, found);
  return found;
}

describe('a suite declares what its specs read', () => {
  const suites = (): UnitSuite[] => UNIT_SUITES.filter((suite) => specsOf(suite).length > 0);

  it('finds the suites and their specs, so the rule below is not walking an empty tree', () => {
    const found = population('unit suites with specs', suites(), { atLeast: 10 });
    const reached = found.flatMap((suite) => reads(suite).reached);
    expect(reached.length, 'no spec reaches any file, so every suite would pass trivially').toBeGreaterThan(500);
  });

  /**
   * One direction only. Over-declaration is not a finding here: `suiteInputs` declares whole directories —
   * a package's `src`, its `tests`, its dependencies' source — so most files under them are legitimately
   * never loaded by a spec, and reporting those would bury the one that matters.
   */
  it('leaves no file a spec loads outside the inputs that re-run it', () => {
    const undeclared = suites().flatMap((suite) => {
      const { reached, declared } = reads(suite);
      return reached.filter((file) => !declared.has(file)).map((file) => `${suite.dir} reads ${file}`);
    });
    expect(undeclared, 'a spec loads these and nothing re-runs it when they change. Declare them: a file in '
      + "another package means that package belongs in this one's dependencies, and a file beside the "
      + 'package means a missing entry in WORKSPACE_PARTS').toEqual([]);
  });
});

/**
 * And the step that runs a suite declares at least what that suite reads.
 *
 * The case above checks the *inner* cache layer — a suite's specs against `suiteInputs`, which is the key
 * `poolUnitFor` fingerprints per project. That leaves the outer layer unasked, and the two can differ: a
 * step whose `inputs` are built some other way declares less than its suites read, caches on the smaller
 * set, and stamps green over work it skipped. `test:integration` did exactly that — built from
 * `workspace(dir)` where the pool steps were built from `suiteInputs` — and left 386, 1944 and 275 files
 * undeclared for its three suites while every check in this package passed.
 *
 * Both layers now go through `inputsForSuites`, so this holds by construction. It is here because that is a
 * property of one function, and the next suite-running step is one hand-written `inputs:` away from losing
 * it again.
 */
const stepFiles = new Map<string, Set<string>>();
function filesOf(step: string): Set<string> {
  const found = stepFiles.get(step)
    ?? new Set(CHAIN_STEPS.find((s) => s.name === step)!.inputs.flatMap(filesUnder));
  stepFiles.set(step, found);
  return found;
}

describe('a step declares what the suites it runs read', () => {
  /** Derived from the two declarations the steps themselves are built from, so a new suite arrives here. */
  const pairs = (): { step: string; suite: UnitSuite }[] => [
    ...UNIT_SUITES.map((suite) => ({ step: unitStepName(suite), suite })),
    ...INTEGRATION_SUITES.map((suite) => ({ step: 'test:integration', suite })),
  ];

  it('finds every suite-running step, so the rule below is not checking an empty list', () => {
    const found = population('suite-running step and suite pairs', pairs(), { atLeast: 12 });
    expect(new Set(found.map((pair) => pair.step)).size,
      'every suite resolved to one step, so a whole pool could be missing').toBeGreaterThan(2);
  });

  it('leaves no suite input outside the step that runs it', () => {
    const missing = pairs().flatMap(({ step, suite }) => {
      const declared = filesOf(step);
      return [...reads(suite).declared].filter((file) => !declared.has(file))
        .slice(0, 3)
        .map((file) => `${step} runs ${suite.dir}, which reads ${file}`);
    });
    expect(missing, 'the step caches on less than its suites read, so it can stamp green over work it '
      + 'skipped. Build its inputs with `inputsForSuites`, as the pools do').toEqual([]);
  });
});

/**
 * A suite declares what its *runner* loads, which is the other half of what it reads.
 *
 * The cases above follow a spec's own imports. They cannot reach the two files every vitest config loads
 * into every test file through `setupFiles`, because no spec imports them — the runner does, by a relative
 * path (`../apack-testing/src/…`) rather than as `@apackdev/testing`. So they reach no package manifest,
 * and `suiteInputs` builds a suite's dependency sources from what its workspace declares.
 *
 * **Measured before this case existed: nine of the thirteen unit suites did not cover the progress guard**,
 * and the four that did covered it by accident, having declared `@apackdev/testing` for other reasons. An
 * edit to the guard that bounds every test in the repo therefore left nine suites' projects fresh, with
 * their last pass standing — the same shape as the three defects in this file's header, and the reason the
 * paths are now one exported list (`SUITE_SETUP_FILES`) instead of a spelling inside each config.
 *
 * `suite-timeouts.spec.ts` asks the half this one cannot: that each config loads them at all. Together a
 * config and the cache key of the suite it runs cannot disagree about them.
 */
describe('a suite declares what its runner loads', () => {
  /** Whether a declared input covers a path: itself, or a directory above it */
  const covers = (inputs: readonly string[], file: string): boolean =>
    inputs.some((input) => input === file || file.startsWith(input.endsWith('/') ? input : `${input}/`));

  it('covers every setup file every config loads, in each half it runs', () => {
    const missing = UNIT_SUITES.flatMap((suite) => halvesOf(suite).flatMap((half) => {
      const inputs = suiteInputs(suite, half);
      return population('setup files', SUITE_SETUP_FILES)
        .filter((file) => !covers(inputs, file))
        .map((file) => `${suite.workspace} (${half}) does not declare ${file}`);
    }));

    expect(missing, 'a project whose runner moved is stale: add it to SUITE_SETUP_FILES or the suite\'s reads')
      .toEqual([]);
  });

  // The rule over a doctored declaration, because the real one passes and a case that only ever reports
  // nothing is indistinguishable from one looking at nothing
  it('reports a suite whose inputs do not reach a setup file', () => {
    expect(covers(['packages/apack-testing/src'], SUITE_SETUP_FILES[0]!)).toBe(true);
    expect(covers(['packages/apack-testing/src/vitest-progress-guard.ts'], SUITE_SETUP_FILES[0]!)).toBe(false);
    expect(covers([], SUITE_SETUP_FILES[0]!)).toBe(false);
    // The trap a prefix match without the separator would fall into: a sibling directory is not a parent
    expect(covers(['packages/apack-testing/src-other'], SUITE_SETUP_FILES[0]!)).toBe(false);
  });
});
