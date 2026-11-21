import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import {
  affectedIntegrationSuites, affectedPackSuites, ENSURE_LABEL, exitCodeFor, packBuildEdge, packageOf, planChanged, planTargets, type Run,
  OWN_FLAGS, splitArgs, specsUnder, verdictOf,
} from '../../../scripts/lib/spec-plan.ts';
import { INTEGRATION_SUITES } from '../../../scripts/lib/chain-steps.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { UNIT_SUITES } from '../../../scripts/lib/unit-suites.ts';
import { population } from '@apackdev/sdk/testing';
import { checkedSpecs, needsAppForRun, pricedSpecs, specsOfSuites } from '../../../scripts/lib/spec-dry.ts';
import { writeDurations } from '../../../scripts/lib/spec-durations.ts';
import { CONFIG_BY_HALF, HALVES } from '../../../scripts/lib/spec-halves.ts';

/**
 * What `npm run spec` decides to run, asserted without running any of it.
 *
 * The routing is the whole value of that command, and it was wrong for a year in a way nothing could catch:
 * a source file ran its own package's specs, so editing `@apackdev/sdk` ran one of the seven suites covering
 * it and reported green. A plan that is data rather than a loop is what makes the decision checkable, which
 * is why `scripts/lib/spec-plan.ts` exists separately from the command over it.
 */

const plan = (target: string) => planTargets([target], [], REPO_ROOT).runs;

/** Any one source module under a directory, so a case about *a* source file needn't name one that may move */
function someSourceFile(dir: string): string {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__generated__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = someSourceFile(full);
      if (found !== '') return found;
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) return full;
  }
  return '';
}
const labels = (target: string) => plan(target).map((run) => run.label);

/**
 * A change set as `planChanged` takes one: repo-relative paths, which is what `git status --porcelain` gives.
 *
 * It takes paths rather than package names because the claim it carries is over the part of the change set a
 * spec could cover — a package name cannot say whether what changed inside it was code or a README.
 */
const changedIn = (...pkgs: string[]): string[] => pkgs.map((pkg) => `packages/${pkg}/src/changed.ts`);

describe('what a target plans', () => {
  it('runs every spec covering a source file, in one root run over all projects', () => {
    const runs = plan('packages/apack-sdk/src/types/sdk-entities.ts');
    expect(runs.map((r) => r.label)).toEqual([
      ENSURE_LABEL,
      'every spec covering packages/apack-sdk/src/types/sdk-entities.ts',
    ]);
    const [, related] = runs;
    expect(related!.cwd, 'a root run, so vitest resolves the graph across every project at once').toBe(REPO_ROOT);
    expect(related!.args).toEqual(['vitest', 'related', '--run', 'packages/apack-sdk/src/types/sdk-entities.ts']);
  });

  it('puts packages:ensure in front of a root run, which npm fires no pretest for', () => {
    expect(plan('packages/apack-sdk/src/types/sdk-entities.ts')[0]!.label).toBe(ENSURE_LABEL);
    // and not in front of a package run, whose own `test` script has the hook
    expect(labels('packages/repo-checks/tests/slow-tests.spec.ts')).not.toContain(ENSURE_LABEL);
  });

  it('says what a root run does not cover, rather than leaving it to be discovered', () => {
    const [, related] = plan('packages/apack-sdk/src/types/sdk-entities.ts');
    expect(related!.notes?.join(' '), 'a pack suite resolves dist, so no import edge runs from this file to its specs')
      .toContain('@app/default-setup');
  });

  // The note used to be set on every root run, including for a package no pack depends on. A warning that is
  // always on is one nobody reads, and this is the half that makes the other half worth printing.
  it('says nothing about the pack suites when the edited package cannot reach one', () => {
    const [, related] = plan('packages/renderer/src/main.ts');
    expect(affectedPackSuites(['renderer']), '@app/default-setup declares no dependency on the renderer').toEqual([]);
    expect(affectedIntegrationSuites(['renderer']), 'and no integration half depends on it either').toEqual([]);
    expect(related!.notes, 'so the run carries no sentence at all').toEqual([]);
  });

  /**
   * Every package, partitioned — not a sample.
   *
   * The first version of this listed nine of the twelve by hand, looked exhaustive, and was missing
   * `apack-host`, which reaches `@app/default-setup` transitively through `@apackdev/testing` (whose bundle
   * inlines it). Three doc comments said "four dependencies, so eight cannot reach it" on the strength of
   * that sample. Reading the list from disk is what makes a new package, or a new dependency edge, fail here
   * rather than quietly widen what `--full` runs.
   */
  it('partitions every package into those that reach a pack suite and those that do not', () => {
    const reaches = PACKAGE_DIRS.filter((dir) => affectedPackSuites([dir]).length > 0);
    expect(reaches, 'a dependency edge changed: check the partition is still what you meant, and that no doc '
      + 'comment states a count').toEqual(['apack-host', 'apack-sdk', 'apack-testing', 'apack-ui']);
    // And the rest genuinely say nothing, rather than being absent from a list
    for (const dir of PACKAGE_DIRS.filter((d) => !reaches.includes(d))) {
      expect(affectedPackSuites([dir]), dir).toEqual([]);
    }
  });

  it('never reaches a pack suite from its own source, that being its own suite\'s job', () => {
    for (const suite of UNIT_SUITES.filter((s) => s.kind === 'pack')) {
      expect(affectedPackSuites([suite.dir]), suite.workspace).toEqual([]);
    }
  });

  /**
   * A pack source file plans its own suite, because nothing else can run it.
   *
   * Measured: `vitest related` from the root finds nothing for a pack's backend, frontend or generated FE
   * entry, so the root run this used to plan reported "No test files found, exiting with code 0" — zero specs
   * and a zero exit for the repo's largest suite.
   */
  it('plans a pack source file against its own suite, not a root run that cannot see it', () => {
    for (const suite of UNIT_SUITES.filter((s) => s.kind === 'pack')) {
      const source = someSourceFile(path.join(REPO_ROOT, 'packages', suite.dir, 'src'));
      const runs = plan(path.relative(REPO_ROOT, source));
      // `packages:ensure` first, because going through npx loses the pretest that would have run it
      expect(runs.map((r) => r.label), suite.workspace).toEqual([
        ENSURE_LABEL,
        `${suite.workspace}: every spec covering ${path.relative(path.join(REPO_ROOT, 'packages', suite.dir), source)}`,
      ]);
      const [, related] = runs;
      // Inside the pack, which is the only place its own `#generated/*` and `@/…` resolve
      expect(related!.cwd).toBe(path.join(REPO_ROOT, 'packages', suite.dir));
      expect(related!.args.slice(0, 3)).toEqual(['vitest', 'related', '--run']);
      expect(related!.covers, 'a filtered run covers no suite in full').toBeUndefined();
    }
  });
});

describe('what --full adds', () => {
  const full = (target: string) => planTargets([target], [], REPO_ROOT, { full: true }).runs;

  it('runs the pack suites a rebuilt dist would reach, after the root run', () => {
    const runs = full('packages/apack-sdk/src/types/sdk-entities.ts');
    // Both seams, because every integration half declares `@apackdev/sdk` too: a rebuilt dist for the pack
    // suite, a second config for the integration halves, and the root run reaching neither
    expect(runs.map((r) => r.label)).toEqual([
      ENSURE_LABEL,
      'every spec covering packages/apack-sdk/src/types/sdk-entities.ts',
      '@app/default-setup, against a rebuilt dist',
      'the integration halves, as the chain pools them',
    ]);
    const pack = runs.at(-2)!;
    // Through the pool, not vitest directly: the pool re-reads its own stamp, so an unchanged suite skips
    expect(pack.cwd).toBe(REPO_ROOT);
    expect(pack.args).toEqual(['run', 'test:unit:pack']);
  });

  it('drops the notes it would otherwise print, the runs below being the answer', () => {
    const [, related] = full('packages/apack-sdk/src/types/sdk-entities.ts');
    expect(related!.notes, 'telling you to run spec:full while running spec:full').toEqual([]);
  });

  it('adds nothing when no pack suite depends on what changed', () => {
    expect(full('packages/renderer/src/main.ts').map((r) => r.label))
      .toEqual([ENSURE_LABEL, 'every spec covering packages/renderer/src/main.ts']);
  });

  it('adds nothing for a named spec: naming one is asking for exactly it', () => {
    expect(planTargets(['packages/repo-checks/tests/slow-tests.spec.ts'], [], REPO_ROOT, { full: true }).runs)
      .toHaveLength(1);
  });

  it('is the same plan as without it when the change set touches no pack dependency', () => {
    const args = [changedIn('renderer'), [], REPO_ROOT] as const;
    expect(planChanged(...args, { full: true }).runs.map((r) => r.label))
      .toEqual(planChanged(...args).runs.map((r) => r.label));
  });

  it('does not double-run a pack whose own source changed, which is already its own run', () => {
    const labels = planChanged(changedIn('default-setup'), [], REPO_ROOT, { full: true }).runs.map((r) => r.label);
    expect(labels.filter((l) => l.includes('default-setup'))).toEqual(['packages/default-setup: (changed)']);
  });

  it('runs a named spec in its own package, which is how you narrow while iterating', () => {
    const runs = plan('packages/repo-checks/tests/slow-tests.spec.ts');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.cwd).toBe(path.join(REPO_ROOT, 'packages', 'repo-checks'));
    expect(runs[0]!.args).toEqual(['test', '--', 'tests/slow-tests.spec.ts']);
  });

  it('reaches a repo script through the graph rather than a hard-coded package', () => {
    // It used to route `scripts/` to @app/repo-checks by name, which was right only while every spec that
    // imported one lived there — an assumption a single exception silently broke.
    expect(labels('scripts/lib/chain-steps.ts')).toEqual([ENSURE_LABEL, 'every spec covering scripts/lib/chain-steps.ts']);
  });

  it('runs both suites a vitest config decides for: its package, and the checks that read every config', () => {
    expect(labels('packages/api/vitest.config.ts'))
      .toEqual(['packages/api: (its config changed)', 'packages/repo-checks: the checks that read every config']);
  });

  // `pack` matched 355 of 368 spec files when the whole repo-relative path was searched, because every path
  // begins with `packages/`. A plausible search term ran the suite, the app E2E included.
  it('reads a name against the file, never the packages/ prefix every path carries', () => {
    const { runs, ambiguous } = planTargets(['pack'], [], REPO_ROOT);
    const matched = ambiguous[0]?.specs ?? runs.flatMap((r) => r.args);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((f) => path.basename(String(f)).includes('pack'))).toBe(true);
  });

  // `envelope` is the discriminator: one file's stem is exactly that, and shell-envelope-parity.spec.ts merely contains it
  it('prefers the file whose stem is the name over the ones that merely contain it', () => {
    const { runs } = planTargets(['envelope'], [], REPO_ROOT);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.args).toEqual(['test', '--', 'tests/events/envelope.spec.ts']);
  });

  // The narrowest thing that could fail is the point, so a name wide enough to be a search is answered with the
  // paths rather than by running two dozen specs across eight suites
  it('lists a name that reads as a search instead of running it', () => {
    const { runs, ambiguous } = planTargets(['pack'], [], REPO_ROOT);
    expect(runs).toEqual([]);
    expect(ambiguous[0]!.query).toBe('pack');
    expect(ambiguous[0]!.specs.length).toBeGreaterThan(4);
  });

  it('reports a target that matches nothing instead of passing quietly', () => {
    const { runs, unmatched } = planTargets(['no-such-thing-anywhere'], [], REPO_ROOT);
    expect(unmatched).toEqual(['no-such-thing-anywhere']);
    expect(runs).toEqual([]);
  });

  it('passes flags to vitest untouched, wherever the run lands', () => {
    const [, related] = planTargets(['packages/apack-sdk/src/types/sdk-entities.ts'], ['-t', 'a case'], REPO_ROOT).runs;
    expect(related!.args.slice(-2)).toEqual(['-t', 'a case']);
  });
});

describe('what the change set plans', () => {
  it('asks every host project once, and the pack suite only when it changed', () => {
    expect(planChanged(changedIn('apack-host'), [], REPO_ROOT).runs.map((r) => r.label))
      .toEqual([ENSURE_LABEL, 'the specs your changes affect']);
    expect(planChanged(changedIn('default-setup'), [], REPO_ROOT).runs.map((r) => r.label))
      .toEqual([ENSURE_LABEL, 'the specs your changes affect', 'packages/default-setup: (changed)']);
  });

  // The command never asks this — it reports "nothing changed" before planning — and the answer still has to
  // be the honest one, since a plan is read by more than its one caller
  it('plans nothing for no change at all', () => {
    expect(planChanged([], [], REPO_ROOT).runs).toEqual([]);
  });

  it('does not ask a host project separately, because the root run already covers it', () => {
    expect(planChanged(changedIn('apack-sdk'), [], REPO_ROOT).runs.map((r) => r.label))
      .toEqual([ENSURE_LABEL, 'the specs your changes affect']);
  });
});

describe('packageOf', () => {
  it('names the package a repo path is in, and null for one in none', () => {
    expect(packageOf('packages/apack-sdk/src/x.ts')).toBe('apack-sdk');
    expect(packageOf('scripts/lib/x.ts')).toBeNull();
    expect(packageOf('tests/e2e/smoke/smoke.spec.ts')).toBeNull();
  });
});

describe('how the arguments split', () => {
  it('gives vitest everything from the first flag, so a flag keeps its own value', () => {
    expect(splitArgs(['chain-schedule', '-t', 'a case']))
      .toEqual({ full: false, bail: true, dry: false, targets: ['chain-schedule'], flags: ['-t', 'a case'] });
    expect(splitArgs(['--changed', 'HEAD~1']))
      .toEqual({ full: false, bail: true, dry: false, targets: [], flags: ['--changed', 'HEAD~1'] });
  });

  it('consumes its own flags in first position, and nowhere else', () => {
    expect(splitArgs(['--full', 'packages/apack-sdk/src/x.ts']))
      .toEqual({ full: true, bail: true, dry: false, targets: ['packages/apack-sdk/src/x.ts'], flags: [] });
    expect(splitArgs(['--no-bail', 'packages/apack-sdk/src/x.ts']))
      .toEqual({ full: false, bail: false, dry: false, targets: ['packages/apack-sdk/src/x.ts'], flags: [] });
    // Not a target's suffix, and not a flag's value: both stay vitest's to accept or reject, because a
    // command that filtered it out wherever it appeared would eat the second one silently
    expect(splitArgs(['a-spec', '--full'])).toEqual({ full: false, bail: true, dry: false, targets: ['a-spec'], flags: ['--full'] });
    expect(splitArgs(['-t', '--full'])).toEqual({ full: false, bail: true, dry: false, targets: [], flags: ['-t', '--full'] });
    expect(splitArgs(['a-spec', '--no-bail']), 'the same rule, and the reason it is one rule')
      .toEqual({ full: false, bail: true, dry: false, targets: ['a-spec'], flags: ['--no-bail'] });
  });

  // A leading *run* rather than one flag, so the two compose in either order without position mattering
  // between them — `npm run spec:full -- --no-bail x` is the shape that needs it
  it('takes both, in either order', () => {
    expect(splitArgs(['--full', '--no-bail', 'x.ts'])).toMatchObject({ full: true, bail: false, targets: ['x.ts'] });
    expect(splitArgs(['--no-bail', '--full', 'x.ts'])).toMatchObject({ full: true, bail: false, targets: ['x.ts'] });
  });

  // The list and the parser are one declaration: a flag in OWN_FLAGS that splitArgs did not consume would
  // reach vitest as a filename, which is the failure this shape exists to make impossible
  it('consumes every flag it declares as its own', () => {
    expect(OWN_FLAGS.length, 'no flag was derived, so this proves nothing').toBeGreaterThan(0);
    for (const flag of OWN_FLAGS) expect(splitArgs([flag, 'x.ts']).flags, flag).toEqual([]);
  });
});

/**
 * A change set with nothing a spec could cover.
 *
 * It used to plan `packages:ensure` and a root `--changed` vitest that reported "No test files found" — 3.4s
 * measured — and a pack's README planned that pack's whole suite besides. Running anything at all after a doc
 * edit is the first entry in the root CLAUDE.md's list of time-wasters.
 */
describe('a change set a spec could not cover', () => {
  it('plans nothing at all, rather than a run whose answer is known', () => {
    expect(planChanged(['docs/goals/README.md', 'CLAUDE.md'], [], REPO_ROOT).runs).toEqual([]);
  });

  it('plans nothing for a doc inside a package either, which used to run that package', () => {
    expect(planChanged(['packages/default-setup/README.md'], [], REPO_ROOT).runs).toEqual([]);
  });

  /**
   * A pack's build edges are covered without being *coverable*: `apack.json` is a `.json` and a content source
   * may be a `.md`. Naming one as a target says what covers it, so a change set holding one must not answer
   * "nothing a spec could cover" — the two routes would contradict each other about the same file.
   */
  it.each(['packages/default-setup/apack.json', 'packages/default-setup/src/content/notes/welcome.md'])(
    'runs the pack suite for %s, which no extension test would call coverable', (changed) => {
      expect(planChanged([changed], [], REPO_ROOT).runs.map((r) => r.label))
        .toEqual([ENSURE_LABEL, 'packages/default-setup: (changed)']);
    });

  // And no root run for them: they are in no root project's graph, so asking is the empty vitest this route
  // stopped paying for
  it('asks the root only for what is in its graph', () => {
    const labels = planChanged(['packages/default-setup/apack.json'], [], REPO_ROOT).runs.map((r) => r.label);
    expect(labels).not.toContain('the specs your changes affect');
    expect(planChanged(['packages/default-setup/apack.json', 'packages/apack-sdk/src/x.ts'], [], REPO_ROOT)
      .runs.map((r) => r.label), 'and asks it when one of them is').toContain('the specs your changes affect');
  });

  it('still plans everything when one coverable file is among them', () => {
    const runs = planChanged(['docs/x.md', 'packages/apack-sdk/src/x.ts'], [], REPO_ROOT).runs;
    expect(runs.map((r) => r.label)).toContain('the specs your changes affect');
  });
});

/**
 * One property over every plan, rather than a case per mistake.
 *
 * `--full` planned `@app/default-setup`'s 87 specs twice when a dependency *and* the pack changed in one edit
 * — which this repo's no-backward-compatibility rule makes the normal shape of a change, not a corner. The
 * case written to pin it passed for an unrelated reason, so what holds it now is the invariant: a `Run` states
 * which suites it executes in full, and no plan may list one twice. Derived from the package list, so a new
 * package is covered without anyone adding a case.
 */
describe('no plan runs a suite twice', () => {
  const duplicated = (runs: readonly { covers?: readonly string[] }[]): string[] => {
    const seen = new Set<string>();
    return runs.flatMap((run) => (run.covers ?? []).filter((w) => (seen.has(w) ? true : (seen.add(w), false))));
  };

  it('holds for every package, as a change set and as a target, with and without --full', () => {
    for (const dir of PACKAGE_DIRS) {
      for (const full of [false, true]) {
        expect(duplicated(planChanged(changedIn(dir), [], REPO_ROOT, { full }).runs), `${dir} changed, full=${full}`).toEqual([]);
      }
    }
  });

  it('holds when a pack and one of its dependencies change together', () => {
    for (const suite of UNIT_SUITES.filter((s) => s.kind === 'pack')) {
      for (const dep of PACKAGE_DIRS.filter((d) => affectedPackSuites([d]).includes(suite.workspace))) {
        for (const full of [false, true]) {
          expect(duplicated(planChanged(changedIn(dep, suite.dir), [], REPO_ROOT, { full }).runs),
            `${dep} + ${suite.dir}, full=${full}`).toEqual([]);
        }
      }
    }
  });

  /**
   * What `covers` means, pinned, because the dedup above is only sound while it means "in full".
   *
   * A run that names specs claims nothing: it is a subset, and running a subset beside the whole suite is
   * wasteful rather than wrong. Were a filtered run to claim coverage, `notYetCovered` would suppress a pack
   * run that genuinely had not happened — which is the same class of silent under-running this whole command
   * was fixed for.
   */
  it('claims coverage only for a run with no spec named', () => {
    const named = planTargets(['packages/default-setup/tests/registries.spec.ts'], [], REPO_ROOT).runs;
    expect(named.map((r) => r.args)).toEqual([['test', '--', 'tests/registries.spec.ts']]);
    expect(named[0]!.covers, 'it runs two of 87 specs').toBeUndefined();
    // and the same package's whole suite does claim it
    expect(planChanged(changedIn('default-setup'), [], REPO_ROOT).runs.at(-1)!.covers).toEqual(['@app/default-setup']);
  });

  // The union is still complete: deduplicating must not drop the suite, only the second copy of it
  it('still runs the pack suite when a dependency alone changed', () => {
    const runs = planChanged(changedIn('apack-sdk'), [], REPO_ROOT, { full: true }).runs;
    expect(runs.flatMap((r) => r.covers ?? [])).toContain('@app/default-setup');
  });
});

/**
 * A tripwire, not a feature: `test-unit-pool.ts` takes `pack`/`host` and `--all` and no project filter, so
 * `packSuiteRun` runs *every* pack suite while its label names only the affected ones. Equal while there is
 * one. This fails when that stops being true, which is the moment the two would start disagreeing.
 */
it('has one pack suite, which is what lets the pool stand in for the affected ones', () => {
  expect(UNIT_SUITES.filter((s) => s.kind === 'pack').map((s) => s.workspace),
    "a second pack suite exists: either give test-unit-pool.ts a project filter, or widen packSuiteRun's "
    + 'label, which names the affected suites while the command runs both').toEqual(['@app/default-setup']);
});

/**
 * The package's own CLAUDE.md names every spec in it.
 *
 * `spec-plan.spec.ts` was added without a row, and ten cases were added to it before a review noticed. This
 * package already checks three lists for
 * stale entries (`NO_SUITE`, `LAYOUT_CHECKS`, `PACKS_AS_A_FIXTURE`); a table describing what is here is the
 * same kind of list and gets the same treatment, in both directions.
 */
/**
 * Which runs promise to have covered something, and what the promise is worth.
 *
 * `vitest related` exits 0 for a file the graph reaches no spec from, so a run's status cannot tell "nothing
 * covers this" from "everything covering this passed" — five of eight sampled entry modules answered zero and
 * exited 0. The promise is what makes the difference reportable, and it belongs to the route: a run that
 * legitimately executes nothing must not carry one.
 */
describe('which runs claim to have covered something', () => {
  const claims = (target: string): (string | undefined)[] => plan(target).map((r) => r.claimsCoverageOf);

  it('a source file is claimed, by the root route and by a pack\'s own', () => {
    expect(claims('packages/apack-sdk/src/fe/settings.ts')).toContain('packages/apack-sdk/src/fe/settings.ts');
    expect(claims('packages/default-setup/src/extensions/steps/fire/runtime.ts'))
      .toContain('packages/default-setup/src/extensions/steps/fire/runtime.ts');
  });

  // Each of these executes nothing for a reason of its own, and none of them is a hole
  it.each([
    ['a doc, which no module graph reaches', 'docs/goals/README.md'],
    ['a named spec, which is not a coverage question', 'packages/repo-checks/tests/spec-plan.spec.ts'],
    ['a directory of specs', 'packages/repo-checks/tests'],
    ['a vitest config, which plans whole suites', 'packages/repo-checks/vitest.config.ts'],
    // Ambient, which is the whole point of it: nothing imports a declaration file, so no spec can cover one
    ['a declaration file, which ends in .ts and is not code', 'packages/default-setup/src/env.d.ts'],
  ])('nothing claims %s', (_what, target) => {
    expect(claims(target).filter((c) => c !== undefined)).toEqual([]);
  });

  /**
   * Both routes, because the label and the claim are set in different places and only the root one had this.
   * `spec -- <a pack's CLAUDE.md>` printed *"every spec covering CLAUDE.md"*, ran nothing and exited 3 — the
   * exit code was right and the sentence above it said the opposite.
   */
  it.each([
    ['the root route', 'docs/goals/README.md'],
    ['the pack route', 'packages/default-setup/src/env.d.ts'],
  ])('withdraws the label too on %s, so the run does not read as a coverage answer', (_route, target) => {
    const labels = plan(target).map((r) => r.label).join(' ');
    expect(labels, 'a run was planned, or this asserts over nothing').toContain(target.split('/').pop()!);
    expect(labels).not.toContain('every spec covering');
  });

  it('claims a change set that holds code, and not one that holds only prose', () => {
    const claimed = (paths: string[]) => planChanged(paths, [], REPO_ROOT).runs
      .filter((r) => r.claimsCoverageOf !== undefined).length;

    expect(claimed(['packages/apack-sdk/src/fe/settings.ts'])).toBe(1);
    expect(claimed(['docs/goals/README.md', 'CLAUDE.md', 'packages/apack-sdk/README.md'])).toBe(0);
  });
});

describe('what a run\'s outcome is worth', () => {
  const claiming = { label: 'x', cwd: '/', command: 'npx', args: [], claimsCoverageOf: 'src/a.ts' } as Run;
  const plain = { label: 'x', cwd: '/', command: 'npx', args: [] } as Run;

  it.each([
    ['a failure is a failure, whatever it ran', claiming, 1, 3, 'fail'],
    ['a claiming run that executed nothing is a hole', claiming, 0, 0, 'uncovered'],
    ['a claiming run that executed something passed', claiming, 0, 3, 'pass'],
    // The case that makes counting files rather than tests load-bearing: a `-t` pattern matching no case runs
    // every file and skips every test, so a count of tests would report a hole for an ordinary filter
    ['a run that promised nothing passed, even at zero', plain, 0, 0, 'pass'],
  ])('%s', (_what, run, status, files, expected) => {
    expect(verdictOf(run, status, files)).toBe(expected);
  });
});

/**
 * What the whole plan exits with.
 *
 * The one step behind exit 3 that could fail silently, which is why it is a function with cases rather than two
 * lines at the bottom of `spec.ts`. Everything else in that chain is either a compile error or loud at runtime:
 * a reporter that stops being called makes every claiming run exit 3 about the missing count. Dropping
 * `uncovered` from this decision gives exit 0 for a file nothing covers — the defect exit 3 exists to prevent,
 * restored with no symptom and nothing failing.
 */
/**
 * **A target the plan reaches no run for**, which is the half the exit code below cannot see.
 *
 * `exitCodeFor` is driven by the *per-run* reports, so a plan with no runs in it had nothing to report and
 * exited 0: `npm run spec -- packages/preload` printed not one line and passed. The command says the
 * sentence and exits 3 now, and this is the fact it rests on — a workspace with no vitest config plans
 * nothing, and is not an unmatched name or a wide one, which have their own codes.
 *
 * Asserted against the real repo rather than a fixture because that is the claim: *this* tree has
 * workspaces with no suite, and the one named here is the one that found it.
 */
describe('a target with no runs at all', () => {
  it('plans nothing for a workspace with no suite, and is neither unmatched nor ambiguous', () => {
    const planned = planTargets(['packages/typescript-floor'], [], REPO_ROOT);

    expect(planned.runs).toEqual([]);
    expect(planned.unmatched).toEqual([]);
    expect(planned.ambiguous).toEqual([]);
    // What the command turns that into. Dropping it is the silent green this case exists for
    expect(exitCodeFor({ failed: 0, uncovered: planned.runs.length === 0 ? 1 : 0, noCount: 0 })).toBe(3);
  });

  /** A source directory whose specs live under `tests/` is the same shape, and the commoner one. */
  it('plans nothing for a source directory whose specs are elsewhere', () => {
    expect(planTargets(['packages/apack-host/src/database'], [], REPO_ROOT).runs).toEqual([]);
  });
});

describe('what the plan exits with', () => {
  const counts = (over: Partial<{ failed: number; uncovered: number; noCount: number }>) =>
    exitCodeFor({ failed: 0, uncovered: 0, noCount: 0, ...over });

  it.each([
    ['nothing to report', {}, 0],
    ['a spec failed', { failed: 1 }, 1],
    ['a file nothing covers', { uncovered: 1 }, 3],
    ['a count that never arrived', { noCount: 1 }, 3],
    ['both kinds of unanswered claim', { uncovered: 1, noCount: 1 }, 3],
    // A failure outranks a hole: both are printed, and 1 is the one to act on first
    ['a failure beside a hole', { failed: 1, uncovered: 1 }, 1],
    ['a failure beside a missing count', { failed: 1, noCount: 1 }, 1],
  ])('%s', (_what, over, expected) => {
    expect(counts(over)).toBe(expected);
  });
});

describe("the package's CLAUDE.md names what is here", () => {
  const HERE = path.join(REPO_ROOT, 'packages', 'repo-checks');
  const doc = (): string => fs.readFileSync(path.join(HERE, 'CLAUDE.md'), 'utf-8');
  const specs = (): string[] => fs.readdirSync(path.join(HERE, 'tests'))
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => f.replace(/\.(integration\.)?spec\.ts$/, ''));

  /**
   * The specs the table's rows name — the **rows**, not the file.
   *
   * One parse for both directions, which is the fix for two things at once. Searching the whole file let this
   * file's own *prose* vouch for a spec: it cites specs by name constantly, so a spec mentioned in a paragraph
   * counted as documented without ever getting a row. Latent rather than live — all 45 are in rows today — but
   * it is the same hole that let another command's flag satisfy the chain's flag check, where two commands
   * share a word on purpose.
   *
   * And the two directions now cannot disagree about what "named" means, which they could while one read rows
   * and the other read the file.
   */
  const namedInTable = (guide: string): string[] =>
    [...guide.matchAll(/^\| ((?:`[\w-]+`(?:, )?)+) \|/gm)]
      .flatMap(([, cell]) => [...cell.matchAll(/`([\w-]+)`/g)].map(([, name]) => name));

  it('leaves none of them out', () => {
    const missing = specs().filter((name) => !namedInTable(doc()).includes(name));
    expect(missing, 'add these to the "What is here" table in packages/repo-checks/CLAUDE.md, with what each '
      + 'one\'s subject is').toEqual([]);
  });

  it('names none that has gone', () => {
    expect(namedInTable(doc()).filter((name) => !specs().includes(name)),
      'these specs are gone or renamed; drop them from the table').toEqual([]);
  });

  /**
   * And the parse finds rows, which nothing proved while each direction had its own.
   *
   * Both cases above compare against it, so a format change that matched nothing would leave them comparing
   * two empty sets and passing over the whole table. The mutation is over the input, which is what lets this
   * ask whether the regex can fail rather than whether it did.
   */
  it('finds the table rows, so the two cases above are not comparing empty sets', () => {
    expect(population('the table rows', namedInTable(doc())).length).toBe(specs().length);

    expect(namedInTable('| `one`, `two` | what they cover |'), 'several in one row').toEqual(['one', 'two']);
    expect(namedInTable('prose naming `one` outside any row'), 'and prose is not a row').toEqual([]);
  });
});

/**
 * The two edges no module graph can see, and the packs they are derived for.
 *
 * A pack's specs import what `apack pack build` produced, never the source that produced it, so the edge runs
 * `src` -> build -> output -> spec and `related` reports the same emptiness it reports for a file nothing
 * covers. Those are opposite facts and until these routes existed they got the same sentence: a content source
 * was told *"No spec covers …"*, which `tests/content/` refutes.
 */
describe('a pack file whose specs sit behind a build', () => {
  const PACK = 'default-setup';
  const CONTENT = `packages/${PACK}/src/content/actions/claude-code/answer-question.ts`;
  const MANIFEST = `packages/${PACK}/apack.json`;
  /**
   * The pack's build inputs, derived from what `packBuildEdge` routes at the pack's own top level rather
   * than listed here — a copy of that list would agree with it by being written twice, which is what let
   * `package.json` and `tsconfig.json` go unrouted while the manifest beside them was cased four ways.
   */
  const BUILD_INPUTS = fs.readdirSync(path.join(REPO_ROOT, 'packages', PACK), { withFileTypes: true })
    .filter((e) => e.isFile() && packBuildEdge(`packages/${PACK}/${e.name}`, REPO_ROOT)?.specs.length === 0)
    .map((e) => `packages/${PACK}/${e.name}`).sort();

  /**
   * Derived from the tree, not named here: every pack under `packages/` is one with a manifest beside its
   * sources, and each must have a unit suite for its specs to be routed to. A pack arriving without one is
   * unroutable, which is a thing to fix rather than to discover later from a run that answered nothing.
   */
  it('routes every pack under packages/, so a new one cannot arrive unrouted', () => {
    const packs = fs.readdirSync(path.join(REPO_ROOT, 'packages'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(REPO_ROOT, 'packages', e.name, 'apack.json')))
      .map((e) => e.name);
    expect(packs.length, 'no pack was derived from the tree, so the cases below prove nothing').toBeGreaterThan(0);

    const suites = new Set(UNIT_SUITES.filter((s) => s.kind === 'pack').map((s) => s.dir));
    expect(packs.filter((p) => !suites.has(p)),
      'these packs have no unit suite, so nothing can be routed to them — declare one in unit-suites.ts').toEqual([]);
    for (const pack of packs) {
      expect(packBuildEdge(`packages/${pack}/apack.json`, REPO_ROOT), `${pack}'s manifest`).toBeDefined();
    }
  });

  it('sends a content source to the specs that read what building it produces', () => {
    const edge = packBuildEdge(CONTENT, REPO_ROOT);
    expect(edge?.suite.workspace).toBe('@app/default-setup');
    expect(edge?.specs, 'the content goldens, not the whole suite').toEqual(['tests/content']);
  });

  /**
   * Nothing narrower is honest: the manifest drives codegen into `src/__generated__/`, `package.json` holds
   * the `imports` map those specifiers resolve by, and `tsconfig.json` is what the build compiles with — so
   * every spec in the pack goes through all three.
   */
  it('sends each of the pack\'s build inputs to the whole suite', () => {
    expect(BUILD_INPUTS, 'nothing was derived, so every case over this population proves nothing')
      .toEqual([MANIFEST, `packages/${PACK}/package.json`, `packages/${PACK}/tsconfig.json`]);
    for (const input of BUILD_INPUTS) expect(packBuildEdge(input, REPO_ROOT)?.specs, input).toEqual([]);
  });

  it('leaves every other file in the pack alone', () => {
    expect(packBuildEdge(`packages/${PACK}/src/features/brain/be/system.ts`, REPO_ROOT)).toBeUndefined();
    expect(packBuildEdge(`packages/${PACK}/tests/content/content-parity.spec.ts`, REPO_ROOT)).toBeUndefined();
    expect(packBuildEdge('packages/apack-sdk/src/index.ts', REPO_ROOT), 'and every file outside a pack').toBeUndefined();
  });

  // The apply half is offered only where the pack has both halves, so a pack with sources and no goldens is
  // not routed at a directory that is not there
  it('offers the apply route only where the specs exist', () => {
    expect(packBuildEdge(`packages/${PACK}/src/content/x.ts`, path.join(REPO_ROOT, 'packages')),
      'a root where that pack has no tests/content').toBeUndefined();
  });

  /**
   * Beside the walk, not instead of it. An apply *helper* is imported by specs directly — measured, 3 for
   * `_helpers/thread-context.ts` — and routing every `src/content/**` file at the build would throw that
   * answer away to recommend a build instead. So the walk is still planned and carries what it cannot see.
   */
  it.each([CONTENT, ...BUILD_INPUTS])('still walks the pack graph for %s, carrying what the walk cannot see', (target) => {
    const [ensure, walk, ...rest] = planTargets([target], [], REPO_ROOT).runs;
    expect(ensure!.label).toBe(ENSURE_LABEL);
    expect(walk!.args, 'the direct importers are still answered').toContain('related');
    expect(rest, 'and nothing is built without --full').toEqual([]);
    expect(walk!.beyond?.target).toBe(target);
    expect(walk!.beyond?.how, 'which names the command that does answer it').toContain('spec:full');
  });

  // Without this the manifest exits 0 having run nothing: `.json` is not a source extension, so Decision 2's
  // test withholds the claim — and a build edge is that claim made directly, which is what overrides it
  it.each(BUILD_INPUTS)('claims coverage of %s, which no extension test would', (input) => {
    const walk = planTargets([input], [], REPO_ROOT).runs.find((r) => r.args.includes('related'))!;
    expect(walk.claimsCoverageOf).toBe(input);
  });

  /**
   * **The two routes must not contradict each other about the same file.** They answer different questions —
   * "what covers this target" and "what do these changes affect" — from one edge, and each reads it
   * separately, so the edge widening for one and not the other is a silent disagreement rather than a
   * failure. It has happened twice: `5420ce990` fixed a file the target route covered and the change-set
   * route called uncoverable, and `package.json` and `tsconfig.json` ran a pack's whole suite as targets
   * while a change set holding one planned nothing at all.
   */
  it.each([CONTENT, ...BUILD_INPUTS])('answers %s the same way as a target and as a change', (file) => {
    expect(planTargets([file], [], REPO_ROOT).runs, 'as a target').not.toEqual([]);
    expect(planChanged([file], [], REPO_ROOT).runs, 'as a change').not.toEqual([]);
  });

  /**
   * The control, so the case above is about the edge and not about every path in the pack: a pack doc is over
   * no edge, and neither route claims to cover it. The two still plan differently, and honestly — naming it
   * as a target walks the pack graph and reports that nothing covers it (exit 3), where a change set holding
   * only docs has nothing to report on and plans no run at all.
   */
  it('claims no coverage either way for a pack file no edge reaches', () => {
    const doc = `packages/${PACK}/CLAUDE.md`;
    expect(fs.existsSync(path.join(REPO_ROOT, doc)), doc).toBe(true);
    expect(packBuildEdge(doc, REPO_ROOT)).toBeUndefined();
    expect(planTargets([doc], [], REPO_ROOT).runs.map((r) => r.claimsCoverageOf), 'as a target')
      .toEqual([undefined, undefined]);
    expect(planChanged([doc], [], REPO_ROOT).runs, 'as a change').toEqual([]);
  });

  it('builds the pack and runs those specs under --full', () => {
    const planned = planTargets([CONTENT], [], REPO_ROOT, { full: true });
    expect(planned.runs.some((r) => r.args.includes('related')),
      'the walk is subsumed by the specs being run in full').toBe(false);
    expect(planned.runs.map((r) => r.args.join(' '))).toEqual([
      'run packages:ensure',
      'run build -w @app/default-setup',
      'test -- tests/content',
    ]);
  });

  // One build and one run for two content sources: the edge is the pack's, not the file's
  it('plans one build however many of a pack\'s files are named', () => {
    const planned = planTargets([CONTENT, `packages/${PACK}/src/content/prompts/index.ts`], [], REPO_ROOT, { full: true });
    expect(planned.runs.filter((r) => r.args.includes('build'))).toHaveLength(1);
    expect(planned.runs.filter((r) => r.args.includes('tests/content'))).toHaveLength(1);
  });

  // The manifest route runs the suite in full, so `covers` must say so or `--full` plans it twice — once here
  // and once as the pack suite a dependency change reaches
  it('declares the suite it runs in full, so nothing plans it twice', () => {
    const planned = planTargets([MANIFEST], [], REPO_ROOT, { full: true });
    const suiteRun = planned.runs.find((r) => r.cwd.endsWith(`packages/${PACK}`))!;
    expect(suiteRun.covers).toEqual(['@app/default-setup']);
  });
});

/**
 * What `spec:dry` prices, without collecting anything.
 *
 * The pricing is pure over a root it is given, so it is asserted here; the collecting half is in the
 * command, because it loads vitest's node API and the ordinary run must not pay for that.
 *
 * What it reads is the cache this machine's last pool run wrote, not a committed record — so there is no
 * hysteresis, no band and no confidence to report, and the one thing it has to get right is the honest
 * handling of a spec nothing here has measured. These cases run against a temp root, so they price
 * fixtures rather than whatever this machine last ran.
 */
describe('pricedSpecs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-dry-'));
  // Made at collection, so it is made even by a filtered run that executes none of these — which is how
  // nine of these directories reached $TMPDIR before anything removed one
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDurations(root, [
    { dir: 'apack-host', file: 'tests/a.spec.ts', half: 'fast', ms: 1200, overheadMs: 0 },
    { dir: 'apack-host', file: 'tests/b.spec.ts', half: 'fast', ms: 300, overheadMs: 0 },
  ], '2026-10-05T21:07:00.000Z');
  writeDurations(root, [
    { dir: 'apack-cli', file: 'tests/c.integration.spec.ts', half: 'integration', ms: 40_000, overheadMs: 0 },
  ], '2026-10-04T09:00:00.000Z');

  it('sums what this machine measured, and reports when it measured it', () => {
    const priced = pricedSpecs(['packages/apack-host/tests/a.spec.ts', 'packages/apack-host/tests/b.spec.ts'], root);
    expect(priced).toEqual({ ms: 1500, priced: 2, unpriced: [], measuredAt: '2026-10-05T21:07:00.000Z',
      // One reading apiece, so no trend: `trendOf` has nothing to compare against until a second run
      trend: new Map() });
  });

  // The half is in the key, so a spec is priced from the run that measured *it* rather than from whichever
  // of its suite's two records was written last
  it('prices a spec from its own half\'s record', () => {
    const priced = pricedSpecs(['packages/apack-cli/tests/c.integration.spec.ts'], root);
    expect(priced.ms).toBe(40_000);
    expect(priced.measuredAt, 'the record its own half came from').toBe('2026-10-04T09:00:00.000Z');
  });

  it('reports the oldest run its prices came from, since that is how stale the answer is', () => {
    const priced = pricedSpecs(['packages/apack-host/tests/a.spec.ts', 'packages/apack-cli/tests/c.integration.spec.ts'], root);
    expect(priced.measuredAt).toBe('2026-10-04T09:00:00.000Z');
  });

  // Named rather than counted free, which is the difference between a partial total and a wrong one: a
  // fresh clone has measured nothing, and a sum over none of twelve specs that does not say so is worse
  // than no sum at all
  it('names a spec no run here has measured instead of pricing it at zero', () => {
    const priced = pricedSpecs(['packages/apack-host/tests/a.spec.ts', 'packages/apack-host/tests/never-ran.spec.ts'], root);
    expect(priced.ms).toBe(1200);
    expect(priced.priced).toBe(1);
    expect(priced.unpriced).toEqual(['packages/apack-host/tests/never-ran.spec.ts']);
  });

  it('prices nothing at all where no run has written a cache', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-dry-empty-'));
    try {
      const priced = pricedSpecs(['packages/apack-host/tests/a.spec.ts'], empty);
      expect(priced).toEqual({ ms: 0, priced: 0, unpriced: ['packages/apack-host/tests/a.spec.ts'],
        measuredAt: undefined, trend: new Map() });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  /**
   * And it reports what a spec cost at the far end of the window, which is where the window becomes
   * readable at all.
   *
   * The pools record ten runs for every spec and print a trend for five — the slowest of a half — which is
   * what keeps that output bounded without a threshold. That left the ~349 fast-half specs under 500ms with
   * history and no way to see it. Asking by name needs no threshold, because the asking is the filter.
   */
  it('reports how a named spec has moved across the window', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-dry-trend-'));
    try {
      writeDurations(root, [{ dir: 'apack-host', file: 'tests/a.spec.ts', half: 'fast', ms: 1200, overheadMs: 0 }], '2026-10-01T00:00:00.000Z');
      writeDurations(root, [{ dir: 'apack-host', file: 'tests/a.spec.ts', half: 'fast', ms: 2900, overheadMs: 0 }], '2026-10-02T00:00:00.000Z');
      const priced = pricedSpecs(['packages/apack-host/tests/a.spec.ts'], root);
      expect(priced.ms, 'the price is still the newest reading').toBe(2900);
      expect(priced.trend.get('packages/apack-host/tests/a.spec.ts')).toEqual({ was: 1200, runs: 2 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // A spec outside `packages/` belongs to no unit suite, so no pool measured it and no record could hold it
  it('names a spec outside any package rather than reaching for a record it cannot have', () => {
    expect(pricedSpecs(['tests/e2e/smoke/launch.spec.ts'], root).unpriced).toEqual(['tests/e2e/smoke/launch.spec.ts']);
  });
});

/**
 * The other seam a root run cannot reach, and the one nothing said anything about.
 *
 * A pack suite is out of reach because it resolves `dist`; an integration half is out of reach because it
 * is a second vitest config whose specs the root projects `exclude`. The consequence is identical and the
 * silence was worse: `npm run spec -- packages/apack-cli/src/build/pack-rules.ts` printed *"every spec
 * covering pack-rules.ts"*, ran nine specs and exited 0, with `add-extensions.integration.spec.ts` — which
 * imports that module directly — among the ones it skipped. 22 modules in `@apackdev/cli` are imported
 * directly by an integration spec.
 *
 * `Half` reached `packageRun` when a named integration spec was fixed, and stopped there. The two routes
 * that make a *claim* never learned it.
 */
describe('a source file whose specs sit behind a second config', () => {
  const COVERED = 'packages/apack-cli/src/build/pack-rules.ts';

  it('partitions every package into those that reach an integration half and those that do not', () => {
    const reaches = PACKAGE_DIRS.filter((dir) => affectedIntegrationSuites([dir]).length > 0);
    expect(reaches.length, 'nothing reaches one, so every case here is vacuous').toBeGreaterThan(0);
    // And the rest genuinely say nothing, rather than being absent from a list
    for (const dir of PACKAGE_DIRS.filter((d) => !reaches.includes(d))) {
      expect(affectedIntegrationSuites([dir]), dir).toEqual([]);
    }
    // A suite reaches its own half: unlike a pack suite, this is the same package's second config
    for (const suite of INTEGRATION_SUITES) {
      expect(affectedIntegrationSuites([suite.dir]), suite.dir).toContain(suite.workspace);
    }
  });

  it('says so on a target whose integration half covers it', () => {
    const [, related] = planTargets([COVERED], [], REPO_ROOT).runs;
    expect(related!.notes?.join(' '), 'the run claims to cover it and reaches none of those specs')
      .toContain('@apackdev/cli');
    // Not "through a build": these specs resolve @apackdev/source like any host project, and spec:full
    // reaches them without building anything
    expect(related!.notes?.join(' ')).toContain('second config');
  });

  it('runs them under --full, through the pool the chain runs', () => {
    const planned = planTargets([COVERED], [], REPO_ROOT, { full: true }).runs;
    const pooled = planned.at(-1)!;
    expect(pooled.args).toEqual(['run', 'test:integration']);
    expect(planned.flatMap((run) => run.notes ?? []).join(' '),
      'and stops advising the command it is running').not.toContain('spec:full');
  });

  /**
   * What the pool would run, named rather than left to `covers`.
   *
   * `covers` is the obvious field and the wrong one: it means a unit suite executed *in full*, and pricing
   * reads that suite's whole record — but these three workspaces each keep one record holding both halves.
   * Using it predicted 260.9s for a run of 232.7s and listed fast specs among what the pool would execute.
   */
  it('prices as the half it runs, not as the records it draws from', () => {
    const pooled = planTargets([COVERED], [], REPO_ROOT, { full: true }).runs.at(-1)!;
    expect(pooled.covers, 'a unit suite run in full is what covers means, and this runs half of three').toBeUndefined();

    const derived = INTEGRATION_SUITES.flatMap((suite) =>
      specsUnder(path.join(REPO_ROOT, 'packages', suite.dir, 'tests'))
        .filter((spec) => spec.endsWith('.integration.spec.ts')));
    expect(derived.length, 'no integration specs were found, so this compares nothing').toBeGreaterThan(0);
    expect(pooled.specs?.length, 'every integration spec in the pool, and nothing from a fast half').toBe(derived.length);
    expect(pooled.specs?.every((spec) => spec.endsWith('.integration.spec.ts'))).toBe(true);
  });

  /**
   * Why the pack route carries no note, pinned rather than assumed.
   *
   * `packRelatedRun` has nowhere to put one, and that is only harmless while no integration half depends on
   * a pack — which is a fact about the dependency graph and not about the code. The day one does, a pack
   * source file starts claiming coverage it does not have, exactly as a CLI source file did, and this is
   * what says so instead of the defect being found again from the other end.
   */
  it('has no pack whose integration half would need naming, which is why the pack route says nothing', () => {
    for (const suite of UNIT_SUITES.filter((s) => s.kind === 'pack')) {
      expect(affectedIntegrationSuites([suite.dir]), `${suite.workspace} now reaches an integration half: `
        + 'packRelatedRun has to carry notes before this can be true again').toEqual([]);
    }
  });

  /**
   * The property the whole seam turns on, and the one that was false in both directions: a target route
   * claiming coverage it did not have, and a change-set route reporting *"No spec covers 1 changed file a
   * spec could cover"* for an integration spec — which covers itself.
   */
  it.each([COVERED, 'packages/apack-cli/tests/commands/release.integration.spec.ts'])(
    'never omits the half in silence for %s, as a target or as a change', (file) => {
      // Either is honest, and the two routes differ honestly: naming an integration spec runs it through
      // its own config, where the same file arriving in a change set can only be pointed at. What neither
      // may do is leave it out and say nothing, which is what both did
      const answered = (runs: readonly Run[]) => runs.some((run) => run.args.includes('test:integration')
        || run.args.some((arg) => arg.endsWith('vitest.integration.config.ts')))
        || runs.flatMap((run) => run.notes ?? []).join(' ').includes('integration half');

      for (const [route, runs] of [
        ['target', planTargets([file], [], REPO_ROOT).runs],
        ['change', planChanged([file], [], REPO_ROOT).runs],
      ] as const) {
        expect(runs, `${route}: nothing planned`).not.toEqual([]);
        expect(answered(runs), `${route}: the integration half is neither run nor named`).toBe(true);
      }
    });
});

describe('what the plan would list', () => {
  const SPEC = 'packages/repo-checks/tests/spec-plan.spec.ts';
  const PACK = 'default-setup';
  const CONTENT = `packages/${PACK}/src/content/actions/claude-code/answer-question.ts`;

  // Every `covers` is derived from UNIT_SUITES, so this cannot fire — and a skipped one is a whole suite
  // dropped from the answer in silence
  it('refuses a covered workspace that is no unit suite, rather than listing nothing for it', () => {
    expect(() => specsOfSuites(['@app/no-such-suite'], REPO_ROOT)).toThrow(/no unit suite/);
  });

  // `Run.specs` promises spec files. A producer that hands it a directory is making a claim about files
  // nobody enumerated, and the caller prints this as "the specs that would run"
  it('refuses a path that is not a spec file', () => {
    expect(() => checkedSpecs([`packages/${PACK}/tests/content`])).toThrow(/not a spec file/);
  });

  /**
   * The two halves composing, which is what neither of them alone could say.
   *
   * `packBuildEdge` names the content goldens as a *directory* and the listing reads *files*, and both were
   * right on their own: the apply run resolved to one unexpanded path, which is the whole of what `--full`
   * adds for a content source. Asserted over the plan rather than over `packageRun`, because the directory is
   * what the edge hands it and the expansion is what has to survive the trip.
   */
  it('expands the apply run the edge plans into files rather than the directory it names', () => {
    const suiteRun = planTargets([CONTENT], [], REPO_ROOT, { full: true }).runs
      .find((run) => run.specs !== undefined)!;

    expect(suiteRun.specs, 'the directory was expanded').not.toContain(`packages/${PACK}/tests/content`);
    expect(suiteRun.specs!.length, 'every golden under it').toBeGreaterThan(10);
    expect(checkedSpecs([...suiteRun.specs!].sort()), 'and every one of them is a spec file')
      .toHaveLength(suiteRun.specs!.length);
  });

  /**
   * A whole-suite run names no files, so its specs are walked from the packages it covers.
   *
   * The walk is the suite's inventory.
   */
  it('lists a whole suite by walking it, since the run names no files', () => {
    const listed = specsOfSuites(['@app/repo-checks'], REPO_ROOT);

    expect(listed.length, 'the suite has specs').toBeGreaterThan(10);
    expect(listed.every((spec) => spec.startsWith('packages/repo-checks/'))).toBe(true);
    expect(listed, 'including this one').toContain('packages/repo-checks/tests/spec-plan.spec.ts');
  });

  /**
   * Read from `chain-steps.ts`, never inferred, so the label cannot disagree with `check:tiers`. A
   * package's own `npm test` is not the chain's `test` step, and labelling it as needing the app would say
   * the pack suite launches one.
   */
  it('labels a run from the chain step it is, and nothing else', () => {
    const [ensure, walk] = planTargets(['packages/apack-sdk/src/types/sdk-entities.ts'], [], REPO_ROOT).runs;
    expect(needsAppForRun(ensure!, REPO_ROOT), 'packages:ensure needs no app').toBe(false);
    expect(needsAppForRun(walk!, REPO_ROOT), 'a root vitest is no chain step').toBeUndefined();

    const packageTest = planTargets([SPEC], [], REPO_ROOT).runs[0]!;
    expect(packageTest.args[0], 'npm test in a package').toBe('test');
    expect(needsAppForRun(packageTest, REPO_ROOT), 'which is not the chain step named test').toBeUndefined();
  });

  // Every run a plan can produce is either collected or explained: one that is neither would print an empty
  // prediction and read as costing nothing
  it('declares what it would collect for every run that answers a graph', () => {
    const planned = planTargets(['packages/apack-sdk/src/types/sdk-entities.ts'], [], REPO_ROOT, { full: true }).runs;
    for (const run of planned) {
      const answersAGraph = run.args.includes('related') || run.args.includes('--changed');
      expect(run.collects !== undefined, `${run.label}`).toBe(answersAGraph);
    }
    expect(planChanged(changedIn('apack-sdk'), [], REPO_ROOT).runs.find((r) => r.collects?.changed)).toBeDefined();
  });
});

/**
 * That the ordinary run pays nothing for the prediction.
 *
 * Collection is ~1.6s whatever it returns, which is 8% of a root run and most of a one-spec run. The command
 * keeps it out by loading both the collector and the pricing behind `await import`, so a plain `npm run spec`
 * never constructs vitest's node API at all — asserted from the source, because a static import is the one
 * way this regresses and it regresses silently.
 */
describe('the ordinary run does not collect', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts/spec.ts'), 'utf-8');
  /** Static imports only: `import x from 'y'` at the start of a line, never `await import('y')` */
  const staticImports = [...source.matchAll(/^import\s[^\n]*?from\s+'([^']+)'/gm)].map(([, spec]) => spec!);

  it('names no collector among its static imports', () => {
    expect(staticImports.length, 'nothing was parsed, so this proves nothing').toBeGreaterThan(3);
    expect(staticImports).not.toContain('vitest/node');
    expect(staticImports, 'the pricing loads chain-steps, which the ordinary run has no use for')
      .not.toContain('./lib/spec-dry.ts');
  });

  it('loads the collector behind an await import, so only --dry pays', () => {
    // One gate covers both: `spec-dry.ts` is what loads `vitest/node`, and the command loads `spec-dry.ts`
    // only under `--dry`. Asserted from the source because a static import is the one way this regresses,
    // and it regresses silently
    expect(source, './lib/spec-dry.ts').toContain("await import('./lib/spec-dry.ts')");
  });
});

/**
 * What the plan would run, asked of vitest rather than of the command's source.
 *
 * **The collection has to happen in the run's own root.** A pack walk's `related` path is relative to the
 * pack, and the pack is in no root project, so collecting from the repo root resolves nothing — `spec:dry`
 * answered 0 specs for a file the run answers with 3. That was guarded by a regex over `spec.ts`, which could
 * see the call site and not the answer: it caught one spelling of the regression, failed on a reformat it did
 * not anticipate, and could not have caught a prediction that was wrong for any other reason. Two of those
 * shipped.
 *
 * It costs one vitest node API, which is why there is one case and not four.
 */
/**
 * Which config a named spec is run from.
 *
 * A package with a split has two, and `npm test` loads the one whose `include` excludes
 * `*.integration.spec.ts`. So naming an integration spec matched no file: "No test files found", exit 1, for
 * 23 of the repo's 369 specs. It was loud rather than a false pass, which is why nothing caught it — the
 * command this belongs to spent four phases learning to refuse a quiet zero and could not run these at all.
 */
describe('a named spec runs from the config for its half', () => {
  const FAST = 'packages/repo-checks/tests/spec-plan.spec.ts';
  const INTEGRATION = 'packages/repo-checks/tests/import-specifiers.integration.spec.ts';
  const argsOf = (target: string) => planTargets([target], [], REPO_ROOT).runs.at(-1)!.args;

  it('leaves the fast half alone, which is every package without a split', () => {
    expect(argsOf(FAST)).toEqual(['test', '--', 'tests/spec-plan.spec.ts']);
  });

  it('points the integration half at its own config', () => {
    expect(argsOf(INTEGRATION))
      .toEqual(['test', '--', '--config', 'vitest.integration.config.ts', 'tests/import-specifiers.integration.spec.ts']);
  });

  // Through `npm test` with the config rather than the package's `test:integration` script: that script is
  // exactly this flag, and a half-to-script-name table would be a third place for the same fact
  it('keeps the pretest guard, which is why it goes through npm test at all', () => {
    expect(planTargets([INTEGRATION], [], REPO_ROOT).runs.at(-1)!.command).toBe('npm');
    expect(argsOf(INTEGRATION)[0]).toBe('test');
  });

  // One run per half, because one run cannot load two configs: whichever it loaded would drop the others
  // silently, which is the same defect one level along
  it('splits a package named on both sides into two runs', () => {
    const runs = planTargets([FAST, INTEGRATION], [], REPO_ROOT).runs;
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.args.includes('--config'))).toEqual([false, true]);
    expect(new Set(runs.map((r) => r.cwd)), 'both in the same package').toHaveProperty('size', 1);
  });

  // The list and the type are one declaration, so a third half cannot be added to one and missed by the
  // other — and every half it names has a config to run from
  it('has a config for every half it declares', () => {
    expect(HALVES.length, 'no halves were derived, so this proves nothing').toBeGreaterThan(1);
    for (const half of HALVES) expect(CONFIG_BY_HALF[half], half).toMatch(/^vitest\..*config\.ts$/);
  });
});
