/**
 * What `npm run spec` runs for what you gave it, as data.
 *
 * The definition, not the command — `scripts/spec.ts` is the command over it, the same split as
 * `scripts/test-unit-pool.ts` over `scripts/lib/unit-pool.ts`. Separate so a spec can assert the routing
 * without running anything, which is the only way a decision like *"a source file runs every spec that
 * covers it"* stays true.
 *
 * **The rule.** A spec path, a directory or a name names specs directly, so those run in the package that
 * holds them — that is what you asked for. A **source file** is a different question: after an edit you
 * want *what could this break*, and the answer is every spec that imports it, transitively, wherever it
 * lives. The file's own package would be one of the seven suites covering `@apackdev/sdk`, reported green.
 *
 * Vitest already answers it properly: the root `vitest.config.ts` lists every host project and `related`
 * resolves the module graph across all of them **in one process**. So a source file plans one root run.
 * Measured 2026-09-26: `packages/apack-sdk/src/types/sdk-entities.ts` reaches 104 files, and
 * `scripts/lib/chain-steps.ts` 4 — wider than its own package and transitive.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { INTEGRATION_SUITES } from './chain-steps.ts';
import { CONFIG_BY_HALF, HALVES, type Half, halfOfPath } from './spec-halves.ts';
import { UNIT_SUITES } from './unit-suites.ts';
import { workspaceDeps } from './workspace-deps.ts';

/** One command to run, and where. A plan is a list of these, in order. */
export interface Run {
  /** Printed before it runs, so the output says what is being answered */
  readonly label: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
  /**
   * Printed after it, for what the mechanism cannot cover.
   *
   * A list, because a run can sit behind more than one seam at once. A source file that a pack suite reaches
   * through `dist` and an integration half reaches through a second config is behind both, and while there
   * was one seam one slot was enough — the second could only have arrived by displacing the first.
   */
  readonly notes?: readonly string[];
  /**
   * The unit suites this run executes **in full**, by workspace name.
   *
   * What makes "planned twice" a checkable property rather than a case someone has to think of: a filtered
   * run (a named spec, `related`, `--changed`) covers nothing here, because it is a subset and running a
   * subset beside the whole suite is not the same mistake. `spec-plan.spec.ts` asserts no plan lists one
   * suite twice, which is how a dependency *and* its pack changing together stopped planning the pack's
   * 87 specs under both `npm test -w` and `test:unit:pack`.
   */
  readonly covers?: readonly string[];
  /**
   * The target this run promises to have covered, when it makes that promise: a route that answers "every
   * spec that covers X" and then runs none has not passed, it has found a hole.
   *
   * Absent for every run that legitimately executes nothing. A whole-suite run names no file; a `-t` pattern
   * that matches no case is a filter, not a claim, and still executes its files; `test:unit:pack` skips on its
   * own stamp. So the promise belongs to the route rather than to the count, and only the two `related` routes
   * and `--changed` make it — over a target a spec could cover, which is what `couldBeCovered` decides.
   */
  readonly claimsCoverageOf?: string;
  /**
   * Specs covering this run's target that the run itself cannot reach. Printed after it when it found some —
   * as `note` is — and *in place of* "no spec covers it" when it found none, which is the case it exists for.
   */
  readonly beyond?: BuildEdge;
  /**
   * The vitest options that produce this run's file list without running it, for `spec:dry`.
   *
   * Declared rather than parsed back out of `args`, so the prediction asks the same question the run does
   * and a change to one is a change to both in the same place.
   */
  readonly collects?: { readonly related?: readonly string[]; readonly changed?: boolean };
  /**
   * The spec files this run executes, repo-relative, where naming the target already said which they are.
   *
   * The other half of what `spec:dry` prices, beside `collects` and `covers`: a plan whose runs are none of
   * the three would predict nothing for them and read as costing nothing, which is the failure an unpriced
   * spec is named for.
   */
  readonly specs?: readonly string[];
}

/**
 * Specs that cover a target and that no walk of the module graph will reach, because a build stands between
 * them: `src` -> `apack pack build` -> build output -> the spec that reads it.
 *
 * **Beside a run, never instead of one.** An apply *helper* is imported by specs directly — measured,
 * `src/content/actions/claude-code/_helpers/thread-context.ts` reaches 3 — and routing every `src/content/**`
 * file at the build would throw that answer away to recommend a build. So the walk still runs and this is
 * what it could not see, which is the shape `packSuiteNote` already has.
 *
 * What it changes when the walk finds nothing is the sentence. `related` reports the same emptiness for a
 * file nothing covers and for one whose specs are behind a build, and those are opposite facts — a gap in
 * the suite against a gap in the router. Until this existed the content source got the first for the second:
 * *"No spec covers …"*, which `tests/content/` refutes.
 */
export interface BuildEdge {
  /** Repo-relative, as the user gave it */
  readonly target: string;
  /** What covers it and how it is reached, as a sentence fragment */
  readonly covers: string;
  /** The command that answers it */
  readonly how: string;
}

/** Exported for `spec-dry.ts`, which refuses anything else in a run's file list */
export const IS_SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * A file a spec could plausibly cover, which is what makes "no spec covers it" a finding rather than a fact
 * about the file. A `.md`, a `.json` fixture or a shell script reaches no module graph and never will.
 *
 * A declaration file is the same kind of fact and ends in `.ts`, so it is excluded by name: nothing imports
 * `env.d.ts` or `electron.d.ts` — they are ambient, which is the whole point of them — and there are five under
 * each package's own `src`. The repo's two other declaration-file patterns are about *emitted* declarations
 * rather than this question, so this one is declared here beside its siblings rather than shared with them.
 *
 * Declared here rather than borrowed from `import-source-conditions.ts`' `CODE_FILE`, which has the same shape
 * today: that one answers what a bundler compiles, and tying spec routing to it would move this rule whenever
 * that one changed for its own reasons.
 */
const IS_COVERABLE = /\.(?:[cm]?[jt]sx?|vue)$/;
const IS_DECLARATION = /\.d\.[cm]?ts$/;
const couldBeCovered = (rel: string): boolean => IS_COVERABLE.test(rel) && !IS_DECLARATION.test(rel);

/**
 * What a claiming run's outcome was, given its exit status and how many spec files it executed.
 *
 * `no count` is the case that keeps the check honest: a claiming run whose count never arrived has not passed,
 * because the thing that would have told us it ran something is the thing that broke. Reading that as a pass is
 * how this whole mechanism would go quiet without anything failing.
 */
export type Verdict = 'pass' | 'fail' | 'uncovered' | 'no count';

/**
 * A run's verdict. Pure, and here rather than in `spec.ts`, because this is the half a spec asserts.
 *
 * Spec **files**, never tests: a `-t` pattern matching no case runs every file and skips every test, so a
 * count of tests would report a hole for what is an ordinary filter.
 */
export function verdictOf(run: Run, status: number, specFilesRun: number | undefined): Verdict {
  if (status !== 0) return 'fail';
  if (run.claimsCoverageOf === undefined) return 'pass';
  if (specFilesRun === undefined) return 'no count';
  return specFilesRun === 0 ? 'uncovered' : 'pass';
}

/**
 * The code a run of the whole plan exits with: **1** a spec failed, **3** a claim went unanswered, **0** nothing
 * to report.
 *
 * Here rather than inline in `spec.ts` because it is the one step of the chain behind exit 3 that can fail
 * *silently*. Everything else either compiles or says so at runtime — a reporter that stops being called makes
 * every claiming run exit 3 complaining about the missing count. Dropping `uncovered` from this decision instead
 * gives exit 0 for a file nothing covers, which is the defect the code exists to prevent, back with no symptom.
 * So it is a pure function with cases rather than two lines nothing reads.
 *
 * A failure outranks a hole: both are reported, and 1 is the one to act on first.
 */
export function exitCodeFor(counts: { failed: number; uncovered: number; noCount: number }): 0 | 1 | 3 {
  if (counts.failed > 0) return 1;
  return counts.uncovered > 0 || counts.noCount > 0 ? 3 : 0;
}
const SKIP = new Set(['node_modules', 'dist', '.git', '.temp', 'dist-ssr', 'coverage', '__generated__']);

/**
 * The specs a bare name stands for, narrowest reading first: the file's stem, then its name, then the path inside
 * its package. The `packages/<name>/` prefix is never searched, because every path has it — searching the whole
 * repo-relative path made `pack` match 355 of 368 spec files, which ran the suite, the app E2E included, for a plausible
 * search term.
 */
export function matchByName(query: string, root: string): string[] {
  const all = [...specsUnder(path.join(root, 'packages')), ...specsUnder(path.join(root, 'tests'))];
  const stem = (f: string) => path.basename(f).replace(IS_SPEC, '');
  const inPackage = (f: string) => path.relative(root, f).replace(/^packages\/[^/]+\//, '');
  for (const reading of [
    (f: string) => stem(f) === query,
    (f: string) => path.basename(f).includes(query),
    (f: string) => inPackage(f).includes(query),
  ]) {
    const found = all.filter(reading);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Whether a name reads as a search rather than a target, in which case the caller lists it instead of running it.
 * A few files in one or two suites is someone narrowing; wider than that and crossing suites means tiers and
 * built-package dependencies they did not ask for.
 */
export function tooBroad(specs: string[], root: string): boolean {
  const suites = new Set(specs.map((s) => packageOf(path.relative(root, s))));
  return specs.length > 4 || suites.size > 2;
}

export function specsUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specsUnder(full);
    return IS_SPEC.test(entry.name) ? [full] : [];
  });
}

/** The package a repo path belongs to, or null when it is in none: the repo root, `scripts/`, `docs/` */
export const packageOf = (rel: string): string | null => /^packages\/([^/]+)\//.exec(rel)?.[1] ?? null;

/**
 * The integration halves a change could reach: the edited package's own, and any whose package depends on it.
 *
 * **A second seam, and not the same one.** A pack suite is out of reach because it resolves `dist`, so no
 * module graph connects an edit to it without a build. An integration half is out of reach for a duller
 * reason — it is a second vitest config, and the root projects `exclude` its specs — but the consequence is
 * the same and was worse, because nothing said so: `npm run spec -- <a source file>` printed *"every spec
 * covering X"* over a run that had skipped every integration spec covering X. Measured, 22 modules in
 * `@apackdev/cli` alone are imported directly by one.
 *
 * Which is also why the sentence must not say "through a build": these specs resolve `@apackdev/source` like
 * any host project, so `spec:full` reaches them without building anything.
 */
export function affectedIntegrationSuites(editedPackages: readonly (string | null)[], root?: string): string[] {
  const edited = new Set(editedPackages.filter((pkg): pkg is string => pkg !== null));
  return INTEGRATION_SUITES
    .filter((suite) => edited.has(suite.dir) || workspaceDeps(suite.dir, root).some((dep) => edited.has(dep)))
    .map((suite) => suite.workspace);
}

/** What a run says about the integration halves it did not reach — nothing under `--full`, where they run */
const integrationNote = (affected: readonly string[], full = false): string | undefined =>
  affected.length === 0 || full ? undefined
    : `not in this answer: ${affected.join(', ')}'s integration half also covers this and runs from a second `
      + 'config, which the root projects exclude — npm run spec:full, or npm run test:integration';

/**
 * The run that answers it: the pool, which is what the chain runs and what one suite's config cannot be.
 *
 * It runs every integration half, not only the affected ones — as `packSuiteRun` does, because one pooled
 * run is what the step is and splitting it would be slower than running it whole.
 *
 * **Its file list is named rather than `covers`**, which would be the obvious thing and is wrong here.
 * `covers` means a unit suite executed *in full*, and pricing reads that suite's whole record — but these
 * three workspaces each keep one record holding both halves, and the pool runs one of them. Measured, the
 * prediction came out at 260.9s for a run of 232.7s and listed fast specs among what it would execute.
 * `packSuiteRun` can use `covers` honestly because a pack's record is its whole suite.
 */
const integrationRun = (root: string): Run => ({
  label: 'the integration halves, as the chain pools them',
  cwd: root,
  command: 'npm',
  args: ['run', 'test:integration'],
  specs: INTEGRATION_SUITES.flatMap((suite) => specsUnder(path.join(root, 'packages', suite.dir, 'tests'))
    .filter((spec) => halfOfPath(spec) === 'integration')
    .map((spec) => path.relative(root, spec))).sort(),
});

/**
 * The packages the root run already covers, so nothing plans them twice. Read from the root config's
 * literal list, which `chain-inputs.spec.ts` holds equal to `UNIT_SUITES`' host suites.
 */
export function rootProjects(root: string): string[] {
  const config = fs.readFileSync(path.join(root, CONFIG_BY_HALF.fast), 'utf-8');
  return [...config.matchAll(/^\s*'packages\/([\w-]+)',$/gm)].map(([, dir]) => dir);
}

/** The one run the command does not announce: it is a precondition, not an answer */
export const ENSURE_LABEL = 'the published packages are built';

/** `packages:ensure`, which a root run needs because npm fires no `pretest` for it */
const ensurePackages = (root: string): Run => ({
  label: ENSURE_LABEL,
  cwd: root,
  command: 'npm',
  args: ['run', 'packages:ensure'],
});

/**
 * One vitest over every host project: `related --run <file>` after an edit, `--changed --run` for the
 * change set. `args` is everything after `vitest`, in order, so the call site reads as the command does.
 */
const rootRun = (root: string, label: string, args: readonly string[], flags: readonly string[],
  notes: readonly (string | undefined)[] = [], claimsCoverageOf?: string): Run => ({
  label,
  cwd: root,
  command: 'npx',
  args: ['vitest', ...args, ...flags],
  notes: notes.filter((note): note is string => note !== undefined),
  claimsCoverageOf,
  collects: args[0] === 'related' ? { related: [args[2]!] } : { changed: true },
});

/** A package's own suite, through its `test` script so its pretest and vitest config still apply */
/**
 * A package's own suite, through its `test` script so its `pretest` guard and its vitest config still apply.
 *
 * **The half decides the config.** A package with a split runs its integration specs from a second config,
 * and `npm test` alone loads the first — whose `include` excludes `*.integration.spec.ts`, so naming one
 * matched no file and the run reported "No test files found" and exited 1. 23 of the repo's 369 specs could
 * not be named. The config comes from `CONFIG_BY_HALF` rather than from a half-to-script-name table, because
 * each package's `test:integration` script *is* that flag and a second mapping would be a third place for
 * the same fact to be written.
 */
const packageRun = (root: string, pkg: string, args: readonly string[], flags: readonly string[], label: string,
  half: Half = 'fast'): Run => ({
  label: `packages/${pkg}: ${label}`,
  cwd: path.join(root, 'packages', pkg),
  command: 'npm',
  args: ['test', '--', ...(half === 'fast' ? [] : ['--config', CONFIG_BY_HALF[half]]), ...args, ...flags],
  // Expanded here rather than where it is priced, because the field promises *spec files* and one of its
  // producers hands it a directory: the apply edge's `tests/content`, which vitest resolves as a filter and a
  // cost record has no row for. Unexpanded it priced that run at one unrecorded spec — zero — which is the
  // whole of what `--full` adds. `args` is untouched, so the run is the same run
  specs: args.length === 0 ? undefined : args.flatMap((arg) => {
    const abs = path.join(root, 'packages', pkg, arg);
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory()
      ? specsUnder(abs).map((spec) => path.relative(root, spec))
      : [path.join('packages', pkg, arg)];
  }),
  // Only a run with no spec named executes the suite in full; anything else is a subset
  covers: args.length === 0 ? UNIT_SUITES.filter((suite) => suite.dir === pkg).map((suite) => suite.workspace) : undefined,
});

/** Playwright's, for a `tests/e2e` path — the root's `test:e2e` script rather than a package's */
const e2eRun = (root: string, specs: readonly string[], flags: readonly string[]): Run => ({
  label: 'tests/e2e (playwright)',
  cwd: root,
  command: 'npm',
  args: ['run', 'test:e2e', '--', ...specs.map((s) => path.relative(root, s)), ...flags],
  specs: specs.map((spec) => path.relative(root, spec)),
});

const groupByPackage = (specs: readonly string[], root: string): Map<string | null, string[]> => {
  const byPkg = new Map<string | null, string[]>();
  for (const spec of specs) {
    const pkg = packageOf(path.relative(root, spec));
    byPkg.set(pkg, [...(byPkg.get(pkg) ?? []), spec]);
  }
  return byPkg;
};

/**
 * A vitest config is read as *data* by `suite-timeouts.spec.ts` and `chain-inputs.spec.ts`, never imported,
 * so no module graph reaches it. It keeps an explicit route; everything else a root run finds.
 */
const IS_VITEST_CONFIG = /(^|\/)vitest\.[\w.]*config\.ts$/;
const CONFIG_READER = 'internal-repo-checks';

/** `--full` asks for the answer a rebuild would give as well, which costs a build and the pack suite */
export interface PlanOptions { readonly full?: boolean }

/**
 * The flags the command consumes rather than passing to vitest, as a leading run of the arguments.
 *
 * A list and its type in one declaration, because each one is read in two places — here and the header that
 * documents it — and a flag in one and not the other is a flag that silently becomes a filename.
 */
export const OWN_FLAGS = ['--full', '--no-bail', '--dry'] as const;
export type OwnFlag = (typeof OWN_FLAGS)[number];

/**
 * The command's arguments, split.
 *
 * **Targets first, then flags: everything from the first `-` onward is vitest's, verbatim.** Splitting at the
 * first flag rather than filtering by prefix is what makes a flag's *value* its own — `-t "a case"`,
 * `--changed HEAD~1`, `--bail 1` — without this having to know which flags take one.
 *
 * `OWN_FLAGS` are the arguments the command consumes, and only as a **leading run**. That is what keeps the
 * rule above exact rather than nearly true: filtering them out wherever they appeared would silently eat one
 * that was another flag's value, and reading them after a target would make position meaningful in a way
 * nothing else here is. `npm run spec:full` puts `--full` there, so nobody types it; `--no-bail` is typed,
 * and `npm run spec -- --no-bail src/x.ts` is the shape it has to have.
 */
export function splitArgs(argv: readonly string[]): {
  full: boolean; bail: boolean; dry: boolean; targets: string[]; flags: string[];
} {
  // `Set<OwnFlag>`, so each `own.has` below is checked against the list rather than spell-checked: adding a
  // flag to `OWN_FLAGS` and reading a different spelling here is a compile error, which is what makes the
  // list and the type one declaration rather than two that happen to agree
  const own = new Set<OwnFlag>();
  const isOwn = (arg: string | undefined): arg is OwnFlag => (OWN_FLAGS as readonly string[]).includes(arg!);
  let start = 0;
  for (let arg = argv[start]; isOwn(arg); arg = argv[++start]) own.add(arg);
  const rest = argv.slice(start);
  const firstFlag = rest.findIndex((a) => a.startsWith('-'));
  return {
    full: own.has('--full'),
    bail: !own.has('--no-bail'),
    dry: own.has('--dry'),
    targets: firstFlag === -1 ? rest : rest.slice(0, firstFlag),
    flags: firstFlag === -1 ? [] : rest.slice(firstFlag),
  };
}

export interface Planned {
  readonly runs: readonly Run[];
  /** Targets that matched nothing, so the command can fail rather than pass silently */
  readonly unmatched: readonly string[];
  /** Names that read as a search: listed for the caller to narrow, rather than run */
  readonly ambiguous: readonly { readonly query: string; readonly specs: readonly string[] }[];
}

export function planTargets(targets: readonly string[], flags: readonly string[], root: string,
  { full = false }: PlanOptions = {}): Planned {
  const runs: Run[] = [];
  const unmatched: string[] = [];
  const ambiguous: { query: string; specs: string[] }[] = [];
  const named: string[] = [];          // spec files the targets name, grouped at the end
  const sourcePackages: (string | null)[] = [];   // whose integration suites can cover the changes
  let wantsRoot = false;      // a root run was planned, so the pack suites it cannot reach are worth naming
  let needsEnsure = false;    // a run was planned that npm fires no `pretest` for

  for (const arg of targets) {
    const abs = path.resolve(root, arg);
    const rel = path.relative(root, abs);
    const exists = fs.existsSync(abs);

    if (exists && fs.statSync(abs).isDirectory()) {
      named.push(...specsUnder(abs));
    } else if (exists && IS_SPEC.test(abs)) {
      named.push(abs);
    } else if (exists && IS_VITEST_CONFIG.test(rel)) {
      // Its own package's suite too, since a config decides what that package runs at all
      const own = packageOf(rel);
      if (own !== null && own !== CONFIG_READER) runs.push(packageRun(root, own, [], flags, '(its config changed)'));
      runs.push(packageRun(root, CONFIG_READER, [], flags, 'the checks that read every config'));
    } else if (exists) {
      const coverable = couldBeCovered(rel) ? rel : undefined;
      wantsRoot = true;
      needsEnsure = true;
      sourcePackages.push(packageOf(rel));
      runs.push(rootRun(root, coverable === undefined ? `the specs that import ${rel}, if any` : `every spec covering ${rel}`,
        ['related', '--run', rel], flags, [integrationNote(affectedIntegrationSuites([packageOf(rel)], root), full)], coverable));
    } else {
      const matches = matchByName(arg, root);
      if (matches.length === 0) unmatched.push(arg);
      else if (tooBroad(matches, root)) ambiguous.push({ query: arg, specs: matches });
      else named.push(...matches);
    }
  }

  // Grouped by package *and half*: the two halves are two configs, so naming one spec of each in a package
  // is two runs. One run with both would load a single config and silently drop whichever specs it excludes
  for (const [pkg, specs] of groupByPackage(named, root)) {
    if (pkg === null) { runs.push(e2eRun(root, specs, flags)); continue; }
    const inPackage = (spec: string) => path.relative(path.join(root, 'packages', pkg), spec);
    for (const half of HALVES) {
      const ofHalf = specs.filter((spec) => halfOfPath(spec) === half);
      if (ofHalf.length === 0) continue;
      runs.push(packageRun(root, pkg, ofHalf.map(inPackage), flags, ofHalf.map(inPackage).join(' '), half));
    }
  }

  if (full && wantsRoot && affectedIntegrationSuites(sourcePackages, root).length > 0) runs.push(integrationRun(root));
  return { runs: needsEnsure ? [ensurePackages(root), ...runs] : runs, unmatched, ambiguous };
}

/**
 * With no target: the specs your uncommitted changes affect.
 *
 * One root `--changed` answers it for every host project at once, resolving the same graph `related` does
 * — including a change under `scripts/`, which reaches `@app/internal-repo-checks` through its specs' imports. The
 * pack suite is asked separately because it is not a root project, and it is asked at all because a change
 * *inside* it is the one thing a root run cannot see.
 *
 * Takes the changed paths rather than their packages, and derives the packages here: what the caller has is
 * `git status`, and deciding is this file's job. It also needs the paths themselves, to say whether anything
 * that changed was code a spec could cover.
 */
export function planChanged(changedPaths: readonly string[], flags: readonly string[], root: string,
  { full = false }: PlanOptions = {}): Planned {
  // The claim is over the part of the change set a spec could cover. A doc-only change set has none — which
  // is also why this takes the paths: a package name cannot say whether what changed inside it was code.
  const coverable = changedPaths.filter(couldBeCovered);
  if (coverable.length === 0) return { runs: [], unmatched: [], ambiguous: [] };

  const changedPackages = [...new Set(changedPaths.map(packageOf))].filter((pkg) => pkg !== null);
  const affectedIntegration = affectedIntegrationSuites(changedPackages, root);
  // No root run when nothing in the change set is in its graph: a pack's manifest and its content sources are
  // covered by that pack's own suite below, and asking the root for them is the empty vitest this route
  // stopped paying for
  const runs: Run[] = [ensurePackages(root)];
  if (coverable.length > 0) {
    runs.push(rootRun(root, 'the specs your changes affect', ['--changed', '--run'], flags,
      [integrationNote(affectedIntegration, full)],
      `${coverable.length} changed file${coverable.length === 1 ? '' : 's'} a spec could cover`));
  }
  const pack = rootProjects(root);
  for (const pkg of changedPackages) {
    if (!pack.includes(pkg)) runs.push(packageRun(root, pkg, [], flags, '(changed)'));
  }
  if (full && affectedIntegration.length > 0) runs.push(integrationRun(root));
  return { runs, unmatched: [], ambiguous: [] };
}
