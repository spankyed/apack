import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { relativeSpecifiers } from '../../../scripts/lib/module-graph.ts';
import { repoFiles } from './_support/repo-files.ts';
import { INTEGRATION_SUFFIX, hasSplit } from '../../../scripts/lib/spec-halves.ts';

/**
 * A spec lives with the thing it can break.
 *
 * The rule this repo already applies to repositories and migrations, checked for specs. Two ways it fails,
 * and they have different causes:
 *
 * - **A package has source and no suite.** Then there is nowhere for its specs to be, so they end up in a
 *   neighbour — and `npm run spec`, which asks which package a changed file belongs to, finds nothing to
 *   run. `@apackdev/testing` and `@apackdev/ui` were in this state: six specs about them lived in `@apackdev/cli`,
 *   and asking for the specs covering `@apackdev/testing/src/launch-env.ts` did not report "none", it crashed
 *   in vitest's project resolution, because with no config of its own vitest walked up to the root one and
 *   resolved its `projects` list against the wrong directory.
 * - **A spec reaches into another package's tree.** The assertion is right and the location is not, so a
 *   failure points at the wrong package and a rename in one breaks a suite in another.
 *
 * Neither is a mistake anyone makes on purpose; both are what a package extraction leaves behind when the
 * tests do not follow it. Every one this repo has done — `@apackdev/host` out of the api, `@apackdev/testing`,
 * `@apackdev/ui`, `@app/internal-repo-checks` — left some, and nothing noticed any of them. That is what these two
 * checks are for: not to find today's, which `goal-test-placement.md` moved, but to fail on the next one.
 *
 * The repo's own `scripts/` is the other half of this and lives in `repo-check-boundary.spec.ts`; between
 * them every tree a spec can reach across is covered.
 */

const IS_SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

const tracked = (): string[] =>
  repoFiles();

const packageDirs = (): string[] =>
  [...PACKAGE_DIRS];

/**
 * A package with source and deliberately no suite, and why. An entry here is a claim that nothing in its
 * `src/` is worth a spec — which is a strong claim, so it carries a reason and is reported when it stops
 * applying.
 */
const NO_SUITE: Record<string, string> = {};

describe('a package with source has a suite', () => {
  const withSource = (): string[] => packageDirs().filter((dir) => fs.existsSync(path.join(REPO_ROOT, 'packages', dir, 'src')));
  const hasSuite = (dir: string): boolean => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', dir, 'package.json'), 'utf-8')) as
      { scripts?: Record<string, string> };
    return manifest.scripts?.test !== undefined;
  };

  it('leaves none of them without one', () => {
    const missing = withSource().filter((dir) => !hasSuite(dir) && !(dir in NO_SUITE));
    expect(missing, 'give these a vitest config and a `test` script, or add them to NO_SUITE with a reason: '
      + 'a package with no suite has nowhere to put its specs, so they end up in a neighbour where '
      + 'npm run spec cannot find them from a change to what they cover').toEqual([]);
  });

  // A list of exceptions is only honest while each one is still an exception
  it('lists no exception that has stopped applying', () => {
    const stale = Object.keys(NO_SUITE).filter((dir) => !withSource().includes(dir) || hasSuite(dir));
    expect(stale, 'these are gone, have no src/, or now have a suite; drop them from NO_SUITE').toEqual([]);
  });
});

/**
 * A spec that reads another package's tree without going through its published entry, and why. Kept for a
 * spec whose subject genuinely spans packages — not for one that is simply in the wrong place, which is a
 * move rather than an entry here.
 */
const SPANS_PACKAGES: Record<string, string> = {
  'packages/apack-cli/tests/build/fe-bundler-ui-theme.spec.ts':
    "its four tests are a chain across three packages: @apackdev/ui's preset defines the shades its components "
    + 'name, the renderer applies that preset instead of copying the colours, and a built build.bundleUi pack '
    + 'ships CSS for them. Moving it to @apackdev/ui would put a dependency on the app\'s tree and a fixture '
    + "pack's build output into a leaf package's suite; splitting it would lose the chain",
};

/**
 * A spec that packs the published packages into a consumer, and why it is not in `@app/internal-publish-checks`.
 *
 * Every entry is a claim that the packed consumer is the spec's *fixture* rather than its *subject* — that
 * what fails when the spec fails is the package it lives in, not the publish. That is a real distinction and
 * the reason `@apackdev/cli` keeps three of these, but it is not one a checker can make, so it is written
 * down per spec.
 */
const PACKS_AS_A_FIXTURE: Record<string, string> = {
  'packages/apack-cli/tests/build/facade-typing.integration.spec.ts':
    "the facade gate: it compiles a dependent pack against the packed packages, so a failure is apack pack build's",
  'packages/apack-cli/tests/build/facade-typing-published.integration.spec.ts':
    'the same gate asked of the layout a pack author has, which is the half of that suite the packed '
    + 'consumer belongs to — it reaches the fixture through _support/facade-packs.ts, as its sibling does',
  'packages/apack-cli/tests/build/facade-type-data.integration.spec.ts':
    'CLI dependency type-data admission and execution refusal use the shared facade fixture; '
    + 'the producer/consumer build is the fixture, not a check of package publication',
  'packages/apack-cli/tests/build/fe-bundler-host-registry.integration.spec.ts':
    "the FE bundler's host-registry proxying, with a packed consumer as the thing it bundles against",
  'packages/apack-cli/tests/build/types-bundler-determinism.integration.spec.ts':
    'the types bundler emits the same facade from the workspace and from the packed tarballs — the packed '
    + 'side is one of two inputs to a comparison about the bundler',
  'packages/apack-cli/tests/build/facade-nested-consumer.integration.spec.ts':
    "the types bundler's facade, compiled where the packed packages are installed nested — the consumer is where "
    + 'the facade is used, and the subject is what the bundler wrote',
};

describe('a spec about the published packages lives in @app/internal-publish-checks', () => {
  const FIXTURE = '@app/internal-publish-checks';
  const HOME = 'packages/internal-publish-checks/';

  /**
   * Importing the packing fixture is the signal: nothing else in the repo installs a published consumer.
   *
   * **Read through the spec's own `_support` as well as its text**, because a shared fixture is exactly
   * where that import goes when two specs want it. Observed 2026-10-06: splitting `facade-typing` in two
   * moved its `installPublishedPackages` into `_support/facade-packs.ts`, and since a support module is not
   * a spec, both halves stopped tripping this rule — the entry in the table below went stale while the
   * thing it excuses carried on happening. One level and only into `_support`, which is cheap over four
   * hundred specs where a module-closure walk would not be, and is where the pattern actually is.
   */
  const packs = (spec: string): boolean => {
    const read = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
    const source = read(spec);
    if (source.includes(`from '${FIXTURE}'`)) return true;
    return [...source.matchAll(/from '(\.\.?\/[^']*_support\/[^']+)'/g)].some(([, specifier]) => {
      const named = path.join(path.dirname(spec), specifier!);
      const found = [`${named}.ts`, named].find((candidate) => fs.existsSync(path.join(REPO_ROOT, candidate)));
      return found !== undefined && read(found).includes(`from '${FIXTURE}'`);
    });
  };

  const specs = (): string[] => tracked().filter((file) => IS_SPEC.test(file) && file.startsWith('packages/'));

  it('there are some, so this check is not vacuous', () => {
    expect(specs().filter((file) => file.startsWith(HOME) || packs(file))).not.toEqual([]);
  });

  it('leaves none of them elsewhere', () => {
    const elsewhere = specs()
      .filter((file) => !file.startsWith(HOME) && packs(file))
      .filter((file) => !(file in PACKS_AS_A_FIXTURE));
    expect(elsewhere, `move these to ${HOME}, or record in PACKS_AS_A_FIXTURE why the packed consumer is `
      + "this spec's fixture rather than its subject").toEqual([]);
  });

  it('lists no exception that has stopped applying', () => {
    const stale = Object.keys(PACKS_AS_A_FIXTURE)
      .filter((file) => !fs.existsSync(path.join(REPO_ROOT, file)) || !packs(file));
    expect(stale, 'these are gone or no longer pack a consumer; drop them from PACKS_AS_A_FIXTURE').toEqual([]);
  });
});

/**
 * A directory under `tests/` that holds specs and names no directory under `src/`, and why.
 *
 * It was landed full by `goal-tests-mirror-source.md` Phase 2 — nine entries, each one work not yet done —
 * so that the guard was green before anything moved and each phase deleted its own. The two left are the
 * other kind: a directory naming a module of a package this one *depends on*, which its own `src/` has no
 * counterpart for and should not grow one. Both are `@apackdev/cli`, which is where the specs that drive a
 * pack's whole toolchain live ([`goal-test-placement.md`](../../../docs/archive/goals/goal-test-placement.md)
 * settled that), so the toolchain's parts are what its directories can name.
 *
 * The bar for a new entry is that: not "this spans two modules" — Decision 6 places those at the entry point
 * they drive — but "what it covers is another package's, and this package holds it on purpose".
 */
const NOT_MIRRORED_YET: Record<string, string> = {
  'apack-cli/harness': "@apackdev/testing's harness: the scaffolded setup, a dependency's cached runtime, and "
    + 'isolatedDataDir. The CLI owns the commands that launch it (`apack pack test`, `init-tests`) and none of the '
    + 'harness itself, so a tests/commands/ name would say the wrong thing about all three',
};

describe("a spec's directory names one under src/", () => {
  const SPEC_EXT = ['.ts', '.tsx', '.vue', '.mts'];

  /** A directory mirrors `src/` when the same path is a directory there, or a module with an extension */
  const mirrorsSource = (srcRoot: string, rel: string): boolean => {
    const target = path.join(srcRoot, rel);
    return (fs.existsSync(target) && fs.statSync(target).isDirectory())
      || SPEC_EXT.some((ext) => fs.existsSync(target + ext));
  };

  const holdsASpec = (dir: string): boolean => {
    const walk = (at: string): boolean => fs.readdirSync(at, { withFileTypes: true }).some((entry) => {
      if (entry.name === 'node_modules') return false;
      const full = path.join(at, entry.name);
      return entry.isDirectory() ? walk(full) : IS_SPEC.test(entry.name);
    });
    return fs.existsSync(dir) && walk(dir);
  };

  /** Every `tests/` directory holding a spec, as `<package>/<path under tests>` */
  const specDirs = (): string[] => packageDirs().flatMap((pkg) => {
    const root = path.join(REPO_ROOT, 'packages', pkg, 'tests');
    if (!fs.existsSync(root)) return [];
    const walk = (at: string): string[] => fs.readdirSync(at, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('_'))
      .flatMap((entry) => {
        const full = path.join(at, entry.name);
        return [path.relative(root, full), ...walk(full)];
      });
    return walk(root).filter((rel) => holdsASpec(path.join(root, rel))).map((rel) => `${pkg}/${rel}`);
  });

  const unmirrored = (): string[] => specDirs().filter((entry) => {
    const [pkg, ...rest] = entry.split('/');
    return !mirrorsSource(path.join(REPO_ROOT, 'packages', pkg!, 'src'), rest.join('/'));
  });

  it('there are some, so this check is not vacuous', () => {
    expect(specDirs()).not.toEqual([]);
  });

  it('leaves none unaccounted for', () => {
    expect(unmirrored().filter((entry) => !(entry in NOT_MIRRORED_YET)),
      "a directory under tests/ names a directory under src/, or takes a _ prefix if it is support, or is "
      + 'recorded in NOT_MIRRORED_YET while it waits to be moved').toEqual([]);
  });

  it('records nothing that has been moved already', () => {
    const live = new Set(unmirrored());
    expect(Object.keys(NOT_MIRRORED_YET).filter((entry) => !live.has(entry)),
      'these mirror src/ now, or are gone; drop them from NOT_MIRRORED_YET').toEqual([]);
  });
});

describe('a spec does not reach into another package', () => {
  /**
   * Whether a specifier names something on disk, trying the extensions a TypeScript import may leave off.
   *
   * It is what keeps this from reading a spec's own fixtures as imports. `import-specifiers.integration`
   * writes files full of import statements into temp directories to feed the specifier checker, and a
   * pattern over the spec's text cannot tell those from the spec's own — but they name paths that do not
   * exist (`../../code/fe/state`), so resolving separates them without an exception list.
   */
  const resolves = (target: string): boolean =>
    ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.vue', '/index.ts', '/index.js']
      .some((suffix) => fs.existsSync(path.join(REPO_ROOT, target + suffix)));

  /** Every relative import in a spec that resolves inside a different package under `packages/` */
  const reaches = (spec: string): string[] => {
    const own = /^packages\/([^/]+)\//.exec(spec)?.[1];
    if (own === undefined) return [];
    const dir = path.dirname(spec);
    const out = new Set<string>();
    for (const specifier of relativeSpecifiers(path.join(REPO_ROOT, spec))) {
      const target = path.normalize(path.join(dir, specifier));
      const into = /^packages\/([^/]+)\//.exec(target)?.[1];
      if (into !== undefined && into !== own && resolves(target)) out.add(target);
    }
    return [...out].sort();
  };

  const specs = (): string[] => tracked().filter((file) => IS_SPEC.test(file) && file.startsWith('packages/'));

  it('leaves none of them doing it', () => {
    const offenders = specs()
      .filter((spec) => !(spec in SPANS_PACKAGES))
      .flatMap((spec) => reaches(spec).map((target) => `${spec} -> ${target}`));
    expect(offenders, 'move the spec to the package whose source it reads, or import that package by name if '
      + 'it publishes what the spec needs; a relative path into another package makes a rename there break a '
      + 'suite here, and a failure point at the wrong package').toEqual([]);
  });

  it('lists no exception that has stopped applying', () => {
    const stale = Object.keys(SPANS_PACKAGES)
      .filter((spec) => !fs.existsSync(path.join(REPO_ROOT, spec)) || reaches(spec).length === 0);
    expect(stale, 'these are gone or no longer reach another package; drop them from SPANS_PACKAGES').toEqual([]);
  });
});

/**
 * `.integration.spec.ts` is machinery, not description.
 *
 * The suffix is what `halfOfPath` reads to decide which half a spec runs in, so it means something only
 * where there is a second half — a package with both `vitest.config.ts` and `vitest.integration.config.ts`.
 * Elsewhere it is a name that says nothing, and worse than nothing: measured, a package whose include glob
 * takes every `.spec.ts` under `tests/` and excludes nothing still collects the renamed file, so the spec
 * goes on running in the same pool at the same cost while the placement checks fall silent about it. That is the
 * shape of advice `spec-cost:update` used to give, and it is why this rule exists rather than a comment.
 *
 * This lives here rather than in `suite-split.spec.ts` because it reads no cost — its inputs are a filename
 * and whether a config file exists — and because that file's population is the twelve hand-written
 * `UNIT_SUITES` entries, where this one walks every workspace.
 */
describe('an integration suffix names a half that exists', () => {
  const packageOf = (file: string): string => file.split('/').slice(0, 2).join('/');

  /** The rule itself, over whatever list it is given, so a case can hand it one that breaks. */
  const homeless = (files: readonly string[]): string[] =>
    files.filter((file) => file.endsWith(INTEGRATION_SUFFIX) && !hasSplit(path.join(REPO_ROOT, packageOf(file))));

  const suffixed = (): string[] =>
    tracked().filter((file) => file.startsWith('packages/') && file.endsWith(INTEGRATION_SUFFIX));

  it('there are some, so this check is not vacuous', () => {
    expect(suffixed()).not.toEqual([]);
  });

  it('leaves none in a package with only one half', () => {
    expect(homeless(suffixed()), 'rename these without the suffix: their package has no integration half, so '
      + 'the name claims a placement that does not exist and no runner treats them differently').toEqual([]);
  });

  // The firing case. The tree is green, so the branch that reports is unreachable from it — and a rule whose
  // reporting branch nothing has watched run is one that can be broken without anything noticing. The package
  // is derived rather than named, so this cannot outlive the fact it rests on.
  it('reports one that is in a package with no second half', () => {
    const single = packageDirs().find((dir) => !hasSplit(path.join(REPO_ROOT, 'packages', dir)));
    expect(single, 'every package has both halves, so this case has nothing to build on').toBeDefined();

    const both = packageDirs().find((dir) => hasSplit(path.join(REPO_ROOT, 'packages', dir)));
    expect(both, 'no package has both halves, so the rule would refuse every suffix').toBeDefined();

    expect(homeless([`packages/${single!}/tests/a${INTEGRATION_SUFFIX}`])).toHaveLength(1);
    expect(homeless([`packages/${both!}/tests/a${INTEGRATION_SUFFIX}`]), 'a real half is left alone').toEqual([]);
    expect(homeless([`packages/${single!}/tests/a.spec.ts`]), 'an unsuffixed spec is not its business').toEqual([]);
  });
});

/**
 * And some config actually runs it.
 *
 * The three checks above ask where a spec *should* be. This asks the blunter question none of them does:
 * whether any runner looks at the directory it is in. A spec nothing collects is the worst shape a test
 * can take — it reads as coverage in review, costs nothing to keep, and runs zero times for ever.
 *
 * **It is reachable today.** Every config's include is `tests/**`, so a spec colocated in `src/` is
 * collected by nothing: planted one and asked vitest, which matched 0 files. No package colocates now, but
 * `@app/default-setup` ran six that way until they moved, and `specFiles` still walks `src/` as a net.
 *
 * **It had a check and lost it.** `suite-split.spec.ts`'s *"records every spec, so a new one cannot be
 * placed by accident"* compared every spec on disk against the recorded costs and failed on a difference,
 * so an uncollected spec showed up as one nothing had ever measured. That file went on 2026-10-05 with the
 * cost records it asserted, and this question went with it — which is the one loss in that deletion worth
 * paying a check for, since the other four are dormant, deliberate, or cheaper gone.
 *
 * The roots are derived from the configs rather than from the convention: asserting "under `tests/`" would
 * restate a population the configs decide, which is the failure the root `CLAUDE.md` records for the seven
 * places that listed `packages/` where the root `workspaces` field already said it.
 */
describe('a spec is collected by some config', () => {
  /** Where a config's globs are declared, following the helper a pack's config delegates to */
  const DELEGATES: Record<string, string> = {
    definePackTestConfig: path.join('packages', 'apack-testing', 'src', 'vitest.ts'),
  };

  /**
   * The literal directory a glob starts with, or nothing where it starts with a wildcard.
   *
   * A prefix rather than a match, because the globs here are not all translatable by hand —
   * `tests/**\/*.{spec,test}.?(c|m)[jt]s?(x)` is extglob — and a hand-rolled translator getting that
   * wrong is how a check starts passing over the thing it was written for. The prefix is enough for the
   * defect: a spec in an unlooked-at directory is under no included root at all.
   */
  const globRoot = (glob: string): string | undefined => {
    const literal: string[] = [];
    for (const part of glob.split('/')) {
      if (/[*?{[]/.test(part)) break;
      literal.push(part);
    }
    return literal.length === 0 ? undefined : literal.join('/');
  };

  /**
   * The roots a config's `include` or `exclude` arrays name, read as text.
   *
   * Text rather than an import, for `suite-timeouts.spec.ts`' reason: importing a pack's config creates a
   * temp data dir. The cost is that every array under the key is collected, a nested
   * `benchmark.include` among them — so the included set can be a little wider than the test runner's, and the
   * direction of that error is a spec under `bench/` going unreported. Narrowing it means parsing the
   * nesting, which means importing.
   */
  /**
   * The quoted strings of the array starting at `from`, scanned with the quotes in mind.
   *
   * Not a regular expression over the brackets, and the reason is the first thing this check found — about
   * itself. `@app/renderer` includes `tests/**` + an extglob ending `[jt]s?(x)`, so a capture bounded by
   * the next `]` stopped inside the glob, read the array as holding nothing, and reported all eight of that
   * package's specs as collected by no config. A `]` inside a string is not a bracket, so quoted runs are
   * skipped whole and the depth count never sees one.
   */
  const globsFrom = (text: string, from: number): string[] => {
    const found: string[] = [];
    let at = text.indexOf('[', from);
    if (at === -1) return found;
    let depth = 0;
    for (; at < text.length; at++) {
      const ch = text[at]!;
      if (ch === '\'' || ch === '"' || ch === '`') {
        const end = text.indexOf(ch, at + 1);
        if (end === -1) break;
        found.push(text.slice(at + 1, end));
        at = end;
        continue;
      }
      if (ch === '[') depth += 1;
      else if (ch === ']') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return found;
  };

  const rootsOf = (file: string, key: 'include' | 'exclude'): string[] => {
    const own = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
    const delegate = Object.entries(DELEGATES).find(([name]) => own.includes(name))?.[1];
    const text = [own, ...[delegate]
      .filter((other) => other !== undefined)
      .map((other) => fs.readFileSync(path.join(REPO_ROOT, other), 'utf-8'))].join('\n');
    const found: string[] = [];
    for (const match of text.matchAll(new RegExp(`\\b${key}:\\s*\\[`, 'g'))) {
      for (const glob of globsFrom(text, match.index)) {
        const root = globRoot(glob);
        if (root !== undefined) found.push(root);
      }
    }
    return found;
  };

  const configsOf = (dir: string): string[] =>
    ['vitest.config.ts', 'vitest.integration.config.ts']
      .map((name) => path.join('packages', dir, name))
      .filter((file) => fs.existsSync(path.join(REPO_ROOT, file)));

  const under = (file: string, root: string): boolean => file === root || file.startsWith(`${root}/`);

  /** The rule, over whatever list it is given, so a case can hand it one that breaks */
  const uncollected = (files: readonly string[]): string[] => files.filter((file) => {
    const [, dir, ...rest] = file.split('/');
    const relative = rest.join('/');
    return !configsOf(dir!).some((config) =>
      rootsOf(config, 'include').some((root) => under(relative, root))
      && !rootsOf(config, 'exclude').some((root) => under(relative, root)));
  });

  /**
   * `templates/` is left out: the CLI's scaffold holds two `tests/e2e/*.spec.ts` that belong to whatever
   * pack is generated from them, and no config here should collect one. `specFiles` ignores that directory
   * for the same reason.
   */
  const specs = (): string[] => tracked()
    .filter((file) => file.startsWith('packages/') && IS_SPEC.test(file))
    .filter((file) => !file.split('/').includes('templates'))
    .filter((file) => configsOf(file.split('/')[1]!).length > 0);

  it('finds the specs and the configs, so this is not vacuous', () => {
    expect(specs().length, 'no specs derived, so every case below passes over nothing').toBeGreaterThan(300);
    const parsed = packageDirs().flatMap(configsOf).map((config) => rootsOf(config, 'include'));
    expect(parsed.length, 'no configs found').toBeGreaterThan(10);
    // A config whose globs did not parse reads as one that includes nothing, which would fail every spec
    // in its package rather than pass — but say it here, so the cause is named once instead of inferred
    // from a wall of paths
    expect(parsed.filter((roots) => roots.length === 0), 'these configs declare no include this could read').toEqual([]);
  });

  it('leaves none that nothing would collect', () => {
    expect(uncollected(specs()), 'no config looks in the directory these are in, so they never run').toEqual([]);
  });

  // The firing case, built from a real package rather than a named one. The tree is green, so the
  // reporting branch is unreachable from it — and a rule nothing has watched report is one that can be
  // broken without anything noticing.
  it('reports a spec colocated in src/, which is the way this really happens', () => {
    const dir = packageDirs().find((d) => configsOf(d).length > 0 && rootsOf(configsOf(d)[0]!, 'include').includes('tests'));
    expect(dir, 'no package includes a tests/ root, so this case has nothing to build on').toBeDefined();
    expect(uncollected([`packages/${dir!}/src/colocated.spec.ts`])).toHaveLength(1);
    expect(uncollected([`packages/${dir!}/tests/collected.spec.ts`]), 'one under tests/ is left alone').toEqual([]);
  });

  // And the other way a directory goes unlooked-at: inside an included root but excluded again
  it('reports a spec under a subtree its own config excludes', () => {
    const pack = packageDirs().find((d) => configsOf(d).some((c) => rootsOf(c, 'exclude').includes('tests/_support')));
    expect(pack, 'no config excludes tests/_support, so this case has nothing to build on').toBeDefined();
    expect(uncollected([`packages/${pack!}/tests/_support/helper.spec.ts`])).toHaveLength(1);
  });
});
