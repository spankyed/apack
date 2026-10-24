import * as fs from 'node:fs';
import * as path from 'node:path';
import { BUILD_UNITS, repoRelative, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { PUBLISH_TREE } from '@apackdev/host/build/published-manifest';
import { coresFor } from './core-budget.ts';
import type { TimeoutClass } from './step-timeouts.ts';
import { UNIT_SUITES, type UnitSuite } from './unit-suites.ts';
import { CONFIG_BY_HALF, hasHalf, type Half } from './spec-halves.ts';
import { dependencySource, PACKAGE_DIRS, workspaceDeps } from './workspace-deps.ts';
import { LEG_TIMEOUT, scopeOf, TYPECHECK_LEGS, type Leg } from './typecheck-legs.ts';
import { API_CHECK_TIMEOUT } from './api-report-packages.ts';

/**
 * The pre-merge chain's steps and what each is allowed to read. Separate from `scripts/chain.ts` because
 * that module runs the chain when imported, and `check-test-tiers.ts` needs the table without running it.
 *
 *   1 pure      its own package's source, the in-memory runtime, fakes. No build output, no app.
 *   2 contract  the built @apackdev packages and a pack's build output. Not the app.
 *   3 app       the built app.
 *
 * A step that launches the app without saying so is the coupling this exists to catch: it welds a fast
 * check to a slow one, and the pair can then be neither cached nor reordered. `check:tiers` fails on one.
 * The reasoning and the measurements are in `docs/archive/goals/goal-test-tiers.md`, which calls the
 * declaration a tier; it is derived from the declared inputs now (`needsApp` below), and the three-value
 * version is in `docs/archive/plans/tier-split.md`.
 */


export interface ChainStep {
  /** The npm script, as `npm run <name>` */
  readonly name: string;
  /**
   * What the step reads, repo-relative; a directory is walked. This is its cache key, the same shape
   * `BuildUnit.inputs` has, so one fingerprint protocol covers both. Repo-relative rather than absolute
   * because this table is data that a spec and two scripts import — resolving paths is the consumer's job.
   *
   * Required, not optional, and now doubly so: the edges are derived from it. A step that declares no
   * inputs depends on nothing and is ordered first, which is a wrong answer rather than a missing one.
   * An earlier phase of this table added its ordering fields and left this out, and its "Done when"
   * passed anyway because it asserted the ordering those fields were for.
   */
  readonly inputs: readonly string[];
  /** What it writes, so a later step's `inputs` can name them instead of guessing at the same paths */
  readonly outputs?: readonly string[];
  /**
   * Generated trees inside `inputs` that this step declares the parent of and never reads. Every gitignored
   * input has to be accounted for — `packages/repo-checks/tests/chain-inputs.spec.ts` fails one that is neither a step's
   * output you depend on nor listed here — because an unaccounted one is either an undeclared dependency
   * (a race) or churn that stops the step ever caching. Each entry is a claim that the step reads around
   * the tree, so it belongs with evidence.
   */
  readonly excludes?: readonly string[];
  /**
   * Suffixes inside `inputs` this step does not read — `excludes` by extension rather than by path. The
   * rule, what it is sound over and why it exists is on `BuildUnit.excludeSuffixes`, which carries it.
   */
  readonly excludeSuffixes?: readonly string[];
  /**
   * What this step leaves on disk that says *why* it failed, kept before anything can overwrite it.
   *
   * The next run of the step is what overwrites it: a runner that clears its output directory on the way
   * in — Playwright does — takes what the failed attempt wrote, which is often the app's own log.
   *
   * **Declared rather than taken from `outputs`.** Most outputs are build product — `build:runtime` and
   * `build:default-setup` write hundreds of megabytes of it — which explains no failure and would be copied on every
   * one. Deriving it as "outputs nothing else reads" is the clever repair and gives a wrong answer in
   * silence. `chain-table.spec.ts` holds each entry to being a path the step declares it writes, so one
   * naming a tree nobody writes fails rather than copying nothing.
   *
   * **Kept on every failure rather than behind a flag, which 68K is what buys**: measured 2026-10-10, one
   * failing `test:smoke` left that much — the fixture's `app-<worker>.log` beside a 39K `trace.zip` and a
   * screenshot, since the repo's own `playwright.config.ts` sets `screenshot: 'on'` and
   * `trace: 'retain-on-failure'` (the helper in `@apackdev/testing/playwright` sets neither, so a pack's
   * suite leaves less). Evidence you have to ask for in advance is evidence you do not have, because you
   * learn you wanted it only after the failure.
   */
  readonly keepsOnFailure?: readonly string[];
  /**
   * What a step writes as an account of its run — test results, an app's log, traces — that no step reads.
   *
   * Two writers of one evidence path conflict, as two writers of an output do, and a failed step's evidence
   * is kept like `keepsOnFailure` (`keptOnFailure` below). **It is no part of the step's cache key**, which is
   * the difference from `outputs`: an output's bytes are what a later step consumes, so another writer
   * changing them makes the step stale; a result directory another run rewrote says nothing about whether
   * this step's inputs moved. Declared as an output, every E2E run turned `test:smoke` stale with no input
   * changed, since both write Playwright's output directory.
   */
  readonly evidence?: readonly string[];
  /**
   * A step the chain does not cache, and why. Set means uncached; the chain prints this sentence where a
   * cache verdict would go, so it is a reason and not a flag.
   *
   * Two kinds qualify. One is a pass that is not reproducible (the E2E suite). The other is a step whose
   * *effect* is recorded somewhere the chain's fingerprint cannot see: `packages:ensure` guarantees the
   * built packages are current, and whether they are is recorded in `node_modules/.cache/apack-packages-build`
   * — not in this step's inputs, and not in its outputs either, which `fingerprintUnit` excludes from the
   * content hash on purpose. Caching such a step is a second record of one fact, and the two can disagree.
   */
  readonly neverCachedBecause?: string;
  /**
   * Run only when asked for, and why — a step the chain knows about but does not gate on.
   *
   * A gate earns its place by catching regressions. A step that exists to be *driven* — to watch the app
   * while writing a feature, or to let an agent see what it built — is a different tool wearing the same
   * shape, and putting it in the chain taxes every merge for a job it was never doing.
   *
   * It stays declared rather than deleted, because its `inputs` are what tell `chain-inputs` that the tree
   * it reads is covered, and `--<flag>` puts it back. Nothing may `need` one: the default chain would then
   * be missing a dependency, which `chainSteps` refuses.
   */
  readonly optInBecause?: string;
  /**
   * What to pass the step so it ignores a cache of its own, appended by `chain.ts` under `--all`.
   *
   * **A step that keeps its own cache needs this, or `--all` lies about it.** The chain's `--all` overrides
   * the chain's stamps; it says nothing to a step that then consults stamps of its own, so the step runs,
   * skips its work and returns green — which is what the two unit pools did with 2634 tests behind them.
   * There is no other escape hatch: the three stamp stores under `node_modules/.cache` have no clear
   * command, so `--all` is the whole answer and has to be true.
   *
   * It is per step rather than a blanket forward because most steps' commands would reject an argument they
   * do not know, and per step rather than an environment variable because an environment variable is
   * inherited by everything a step spawns. This step's inner cache is the one to override; the same run's
   * nested `packages:ensure` calls are not, and there are 18 of them in a serial chain, each a stat and a
   * return. That is the reason an override never goes in the freshness primitive itself — `unitStaleReason`
   * honouring a global flag would turn those 18 stats into 18 builds behind one lock.
   */
  readonly forceArgs?: readonly string[];
  /**
   * That the step runs compiler-runtime, native-fixture or live-watcher suites, which do not run directly on a
   * daily-use Mac (`compilerTestsRunHere`, @apackdev/host/build/compiler-test-host). There the chain runs it in
   * the Linux test container (`scripts/linux-runner.ts`); elsewhere it runs as written.
   */
  readonly linuxOnMac?: true;
  /**
   * How long it may run before its process group is killed, by the kind of work it is
   * (`TIMEOUT_MS`, `scripts/lib/step-timeouts.ts`).
   *
   * Declared, and never derived from what a step costs: a class carries no machine (`step-timeouts.ts`).
   * Required, because a step with no class has no bound — the hang `boundedSpawn` was written for.
   */
  readonly timeout: TimeoutClass;
}

/** Every step, by name, for validating the derived edges */
const BY_NAME = new Map<string, ChainStep>();

/**
 * The order to run the steps in, derived from what each step reads and writes. Throws on an unknown
 * dependency or a cycle, before
 * anything runs: a graph that is wrong should not be discovered halfway through a six-minute chain.
 */
/**
 * The steps a run gates on: every step, minus the opt-in ones unless they were asked for.
 *
 * Refuses a graph where something needs an opt-in step, since the default run would then be missing a
 * dependency and the failure would arrive halfway through rather than here.
 */
export function chainSteps(include: readonly string[] = [], all: readonly ChainStep[] = CHAIN_STEPS): readonly ChainStep[] {
  const optIn = new Set(all.filter((s) => s.optInBecause !== undefined).map((s) => s.name));
  const kept = all.filter((s) => !optIn.has(s.name) || include.includes(s.name));
  const present = new Set(kept.map((s) => s.name));
  for (const step of kept) {
    // Against the whole table, not against what was kept: an edge to an opt-in step is the thing to refuse,
    // and deriving within `kept` would simply not find it.
    for (const need of dependsOn(step, all)) {
      if (!present.has(need)) {
        throw new Error(`Chain step ${step.name} depends on ${need}, which is opt-in — nothing may depend on one`);
      }
    }
  }
  return kept;
}

/** `child` is `parent` or sits under it */
const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(`${parent}/`);

/**
 * Whether an output lands somewhere a step actually reads — the one predicate both derivations rest on.
 *
 * An input and an output overlap if either contains the other: a step declaring `tests/packs` reads what
 * another writes at `tests/packs/x/dist`, and a step declaring that `dist` reads what another writes at
 * `tests/packs`. `excludes` is what takes it back: a step that declares a tree and says it reads around a
 * generated subtree does not depend on whoever writes there.
 *
 * Getting this wrong is quiet rather than loud, and it was wrong twice while this was being written — once
 * by ignoring `excludes` and once by dropping a whole input because a descendant was excluded. Both
 * produced a plausible edge set. The question is about the *output*, which is why the exclusion test is on
 * `output` and not on `input`.
 */
const consumes = (step: ChainStep, output: string): boolean =>
  step.inputs.some((input) => inside(output, input) || inside(input, output))
  && !(step.excludes ?? []).some((excluded) => inside(output, excluded));

/**
 * What a step must run after, derived from what the others write.
 *
 * Two questions over the same two fields:
 *
 * - **outputs into inputs** is a data edge: this step reads what that one writes, so it runs after it.
 * - **outputs into outputs** is a *mutex*: two steps writing the same path must not overlap, in either
 *   order. `conflictsOf` answers that one.
 */
/**
 * Memoised per step list, which is a scope rather than a key.
 *
 * The reduction below asks `dependsOn` of each ancestor, and without this each of those recomputes the
 * whole subgraph: measured on a complete DAG, 3ms at 8 steps, 13ms at 10, 110ms at 12, 1111ms at 14 —
 * ten times worse every two steps. Today's chain is 4ms because almost every edge points at one producer,
 * so the pairwise filter has nothing to pair; the shape that bites is a step reading several steps'
 * outputs, which is what adding outputs to more actions produces.
 *
 * Keyed on the array object, not its contents, and that is sound only because nothing mutates one: the
 * table is a `const`, and every caller that passes its own builds a fresh array. A `WeakMap` so a test's
 * throwaway list is collected with it. Mutating a list in place and asking again would read the old
 * answer, which is the one way to break this.
 */
const derivedEdges = new WeakMap<readonly ChainStep[], Map<string, readonly string[]>>();

/**
 * The steps whose edges are being computed right now, per list — because the memo cannot say.
 *
 * `memo.set` happens after the reduction returns, so a step mid-computation has no entry, and the
 * reduction asks `dependsOn` of its ancestors: through a cycle that re-enters a computation already on
 * the stack and recurses until the stack ends. `orderedSteps` has the cycle check that should catch it and
 * never gets the chance, because `planSteps` asks for every step's edges first — so the error for a
 * circular graph was `RangeError: Maximum call stack size exceeded`, and the one case that covered cycles
 * never reached this code (a two-step cycle leaves `direct` with one element, and the pairwise filter
 * short-circuits before `reachable` is called).
 *
 * Removed in a `finally` because this map outlives a throw: it is keyed on the list, which is never
 * cleared, so a name left behind would report a cycle on the next question about the same table.
 */
const inProgress = new WeakMap<readonly ChainStep[], Set<string>>();

export function dependsOn(step: ChainStep, steps: readonly ChainStep[] = CHAIN_STEPS): readonly string[] {
  const memo = derivedEdges.get(steps) ?? new Map<string, readonly string[]>();
  derivedEdges.set(steps, memo);
  const already = memo.get(step.name);
  if (already !== undefined) return already;

  const open = inProgress.get(steps) ?? new Set<string>();
  inProgress.set(steps, open);
  // The same wording `orderedSteps` uses, so a circular graph reads the same whichever door finds it
  if (open.has(step.name)) throw new Error(`Chain steps form a cycle through ${step.name}`);
  open.add(step.name);
  try {
    const direct = steps
      .filter((other) => other.name !== step.name && (other.outputs ?? []).some((output) => consumes(step, output)))
      .map((other) => other.name);
    // Transitively reduced, so the graph reads like the table did: `build:default-setup` needs `packages:ensure` and
    // everything after it needs `build:default-setup`, rather than every step naming every ancestor.
    const reachable = (name: string, seen = new Set<string>()): Set<string> => {
      const other = steps.find((candidate) => candidate.name === name);
      for (const next of other ? dependsOn(other, steps) : []) {
        if (!seen.has(next)) { seen.add(next); reachable(next, seen); }
      }
      return seen;
    };
    const edges = direct.filter((name) => !direct.some((other) => other !== name && reachable(other).has(name))).sort();
    memo.set(step.name, edges);
    return edges;
  } finally {
    open.delete(step.name);
  }
}

/**
 * The steps this one may not run beside, because they write where it writes.
 *
 * This is what `exclusive` stood in for, and it stood in badly: that flag was a *global* mutex, so a step
 * holding it blocked every other step rather than the ones it conflicts with. Both of its users had a real
 * conflict neither declared — one through an output it did not list at all, the other as a proxy for
 * "nothing may build the packages concurrently", which the data edges already enforce.
 *
 * A mutex has no direction. Which of two conflicting steps runs first is a scheduling preference, and
 * lives with the scheduler rather than here.
 */
export function conflictsOf(step: ChainStep, steps: readonly ChainStep[] = CHAIN_STEPS): readonly string[] {
  const overlaps = (a: readonly string[], b: readonly string[]): boolean =>
    a.some((one) => b.some((two) => inside(one, two) || inside(two, one)));
  // Two writers of one path, in either order. **A reader is not one of them**, and needs no mutex: a reader of
  // what a step produces is ordered after it by `dependsOn`, which is derived from these same outputs.
  //
  // It had a second arm, for a step writing *transiently* where another reads — a disturbance a reader must
  // not see, as against a product a reader waits for. `packages:check` was its only user, through `attw
  // --pack` packing a tarball inside each tree it checked, and that is a mutex against 29 of 30 steps for a
  // tool that takes a tarball path. `scripts/packages-check.ts` packs outside the repository instead, so the
  // distinction has no subject here; it is written down because it is what a future transient writer needs.
  const writes = (one: ChainStep) => [...(one.outputs ?? []), ...(one.evidence ?? [])];
  return steps
    .filter((other) => other.name !== step.name && overlaps(writes(other), writes(step)))
    .map((other) => other.name)
    .sort();
}

/** What the chain copies aside when a step fails: what it declares keeping, and all of its evidence */
export const keptOnFailure = (step: ChainStep): readonly string[] =>
  [...new Set([...(step.keepsOnFailure ?? []), ...(step.evidence ?? [])])];

/** A step with its edges worked out: what it waits for, and what it may not run beside. */
export interface PlannedStep extends ChainStep {
  readonly dependsOn: readonly string[];
  readonly conflicts: readonly string[];
  /**
   * What of the machine it takes (`coresFor`, `core-budget.ts`), for a run admitting on cores.
   *
   * Attached here with the edges, and for the same reason: it is derived from a declaration elsewhere, so
   * carrying it on the table would be a second record to disagree with that one.
   */
  readonly cores: number;
}

/**
 * Every step with its graph attached, which is the only form the scheduler sees.
 *
 * The edges are derived here rather than carried on the table, so there is no second record to disagree
 * with `inputs` and `outputs` — which is what `needs` and `exclusive` were, and what `chain-inputs` had a
 * case policing.
 */
export const planSteps = (steps: readonly ChainStep[] = CHAIN_STEPS): readonly PlannedStep[] =>
  steps.map((step) => ({ ...step, dependsOn: dependsOn(step, steps), conflicts: conflictsOf(step, steps), cores: coresFor(step.name) }));

export function orderedSteps(given: readonly ChainStep[] = CHAIN_STEPS): readonly PlannedStep[] {
  const steps = planSteps(given);
  BY_NAME.clear();
  for (const step of steps) {
    if (BY_NAME.has(step.name)) throw new Error(`Two chain steps named ${step.name}`);
    BY_NAME.set(step.name, step);
  }
  for (const step of steps) {
    for (const need of step.dependsOn) {
      if (!BY_NAME.has(need)) throw new Error(`Chain step ${step.name} depends on ${need}, which is not a step`);
    }
  }
  const order: PlannedStep[] = [];
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (step: PlannedStep): void => {
    if (done.has(step.name)) return;
    if (onPath.has(step.name)) throw new Error(`Chain steps form a cycle through ${step.name}`);
    onPath.add(step.name);
    for (const need of step.dependsOn) visit(BY_NAME.get(need) as PlannedStep);
    onPath.delete(step.name);
    done.add(step.name);
    order.push(step);
  };
  for (const step of steps) visit(step);
  return order;
}

/**
 * In dependency order. `build:default-setup` builds the built-in pack before `build:runtime` reads its outputs.
 *
 * `test:external-pack` is split: its contract half runs here, before `build:runtime`, because validating,
 * building and typechecking a pack and running its harness specs needs no app — proved by running it with
 * `packages/renderer/dist` moved aside. Its Playwright half needs the app.
 *
 * `test:packaged-authoring` needs the app whole. It is a linear scenario rather than two halves: step 8
 * needs the archive step 6 produced and step 9 reads the content step 8's app applied, so it takes a mode rather
 * than a split (Phase 2 of the goal).
 */
/**
 * The one file every step really does read: the installed toolchain, because a dependency moving changes
 * what any of them do.
 *
 * **`package.json` is not here**, and that is the point. Hashing the whole manifest to key on each step's
 * command would turn an edit to one script into a full chain. A unit carries its own `command`
 * (`commandText`, `scripts/lib/npm-scripts.ts`), which covers that job precisely.
 *
 * Its remaining job needs no declaration at all: `workspaces` decides what a workspace is, so adding one
 * changes `EVERY_WORKSPACE`, which changes the declared path list, which `fingerprintUnit` hashes. And
 * each workspace's own manifest is already an input through `WORKSPACE_PARTS`.
 */
const ROOT = ['package-lock.json'];

/**
 * The root vitest config a run of one half uses — which projects it pools is an input to every suite in it.
 *
 * `CONFIG_BY_HALF` is the one record of which file runs which half, and the one `hasHalf` and so
 * `INTEGRATION_SUITES` derive from. A suite declares only its own half's config: declaring both would make an
 * edit to the integration config re-run every fast project, and give the two halves of one suite an
 * identical declared set.
 *
 * A pack suite's fast half reads neither. `npm test -w <workspace>` runs that package's own config, which
 * `suiteWorkspace` already declares; the integration half reads this one whatever the suite's kind, because
 * the pool passes `--config` itself.
 *
 * Separate from `ROOT` because only the pools read them. They stay inside `EVERY_SOURCE` as well, since a
 * step that walks the tree — the lint, the import rules — walks these too, and the coverage guard in
 * `chain-inputs.spec.ts` is what would notice if they did not.
 */
const rootConfigFor = (suite: UnitSuite, half: Half): string[] =>
  (half === 'fast' && suite.kind === 'pack' ? [] : [CONFIG_BY_HALF[half]]);

/**
 * Every workspace, from the one definition that decides which they are (`workspace-deps.ts`, read from the
 * root `workspaces` field). Walking `packages/` instead would be right for a new directory and wrong for a
 * new workspace, and these names feed `EVERY_WORKSPACE` and so every step's inputs.
 */
const PACKAGES = PACKAGE_DIRS;

/**
 * A package's own source, its tests, its own tooling, its recorded files, and the files that say how it
 * compiles, tests and lints. `etc` is there because a spec reads it back — `api:check` regenerates the
 * `*.api.md` reports it holds and compares, so a hand-edited report has to re-run what asserts on it. An
 * empty `etc` is skipped by the walk. The config files are inputs in the plain sense — a vitest config decides which specs run at all,
 * and the renderer's tailwind and postcss configs decide what `build` emits. A name that the package does
 * not have costs nothing: the walk skips what is not there.
 *
 * Not the package directory itself, which would pull `dist` into the fingerprint and miss the cache on
 * every build.
 */
/**
 * Exported so a check can tell a path that is *offered* to every workspace from one someone wrote out by
 * hand: for these, absent is the ordinary case and the walk skips it, where a hand-written input that names
 * nothing is a step keyed on a file that does not exist (`chain-inputs.spec.ts`).
 */
export const WORKSPACE_PARTS = [
  // `templates` is the CLI's scaffold: pack code the specifier rules read and the CLI's own suite renders,
  // so a change to one has to invalidate the steps that read the workspace
  'src', 'tests', 'scripts', 'bin', 'etc', 'templates', 'index.js',
  // `bench` is in `@apackdev/ears`' tsconfig `include`, so its typecheck compiles the benchmark and has to
  // re-run when it moves. Only that workspace has one; the dep-file gate is what noticed
  'bench',
  // A pack's manifest, which `default-setup`'s specs import directly. Eleven workspaces have none
  // and the walk skips what is not there, so for those this adds a path and no bytes
  'apack.json',
  'package.json', 'tsconfig.json', 'tsconfig.package.json',
  // The two vitest configs from `CONFIG_BY_HALF`, which is where that naming is declared
  ...Object.values(CONFIG_BY_HALF), 'vite.config.ts', 'vite.config.js',
  'eslint.config.ts', 'postcss.config.cjs', 'tailwind.config.ts', 'tsdown.config.ts', 'env.d.ts',
];
const workspace = (pkg: string): string[] => WORKSPACE_PARTS.map((part) => `packages/${pkg}/${part}`);

/**
 * What a *suite* reads, which is the workspace plus its guide. A fingerprint skips prose (see `READS_MARKDOWN`
 * in `packages-built.ts`), so for all but one package this adds a path and no bytes — and that one is
 * `packages/repo-checks/CLAUDE.md`, whose "What is here" table `spec-plan.spec.ts` asserts. Here and not in
 * `WORKSPACE_PARTS`, so `typecheck`, which compiles the repo and reads no guide, does not take it on.
 */
const suiteWorkspace = (pkg: string): string[] => [...workspace(pkg), `packages/${pkg}/CLAUDE.md`];

/** Every workspace: what `typecheck` reads, since it compiles the repo rather than a package */
const EVERY_WORKSPACE = PACKAGES.flatMap(workspace);

/**
 * Every source tree in the repo: what a check reads when its subject is the repo rather than a package.
 *
 * `typecheck` is one, since it compiles the whole thing. The others are the repo-wide *guards* — a spec
 * that asks `git ls-files` what exists and then asserts something about all of it. Those live inside one
 * package's suite while their subject is everything, and the pool runs a project only when that project's
 * own inputs moved, so a guard declaring only its package's inputs is blind to the rest of the tree and
 * passes over a forbidden path committed anywhere else.
 *
 * Build output is not in here, because a guard's subject is source. `typecheck` adds its own.
 */
const EVERY_SOURCE = [...ROOT, ...Object.values(CONFIG_BY_HALF), ...EVERY_WORKSPACE, 'scripts', '.github/scripts', 'tests/e2e', 'tests/packs', 'tests/scripts',
  'tests/fixtures/claude-research/linux-electron-launch.mjs',
  'tests/fixtures/claude-research/install-system-policy.mjs',
  'tests/tsconfig.json', 'playwright.config.ts', 'types', 'electron-builder.mjs', 'build/build-metadata.ts', 'package.json',
  // The drive layer's one tracked file. The driving scripts beside it are gitignored and ad-hoc, so naming
  // the directory would re-run a typecheck every time someone poked at the app
  'drive/playwright.config.ts',
  'build/prod/verify-node-modules.mjs', 'build/prod/smoke-native.mjs',
  'packages/apack-cli/bin',
  'packages/apack-ears/bench/ears.bench.ts', 'packages/api/tsup.config.ts',
  'packages/dev-mode.js', 'packages/entry-point.mjs'];

/**
 * `packages:ensure` builds the publishable packages, so its inputs are theirs — taken from `BUILD_UNITS`
 * rather than copied beside it. A copy of someone else's input list is the thing that goes stale silently:
 * a file added to a build unit would leave this step cached against a key that never saw it.
 */
// Through `repoRelative`, because these land in `step.outputs` beside hand-written POSIX literals and
// `writerOf` compares the two
const relative = repoRelative;
const PACKAGE_BUILD_INPUTS = [...new Set(Object.values(BUILD_UNITS).flatMap((unit) => unit.inputs.map(relative)))].sort();
const PACKAGE_BUILD_OUTPUTS = [...new Set(Object.values(BUILD_UNITS).flatMap((unit) => unit.outputs.map(relative)))].sort();

/**
 * What a consumer reads: built outputs and package resolution metadata, excluding staged publish trees.
 *
 * `publish/` is a copy of what `files` names plus a derived manifest (`stagePublishTree`), written so a
 * tarball ships no `src/` — and **only `packages:check` opens one**, running `publint --strict` and `attw`
 * over each of the three staged trees by name. Nothing resolves *through* a staged tree: a
 * published source branch is a resolution failure rather than a fallback, which is why the tree exists.
 *
 * So a consuming step declares this rather than the whole build-output constant: the `publish/` trees could
 * change none of its answers, and declaring them would let an edit to a package's `files` or `exports` map —
 * which rewrites the derived `publish/package.json` — invalidate every consumer over the shape of a tarball.
 * Leaving them out moves no ordering edge or mutex: the edge to `packages:ensure` runs through the `dist`
 * trees, which every consumer reads.
 *
 * `chain-inputs.spec.ts` holds the rule, so a new step spreading the wrong constant is a failure rather
 * than a key nobody looks at. The narrowing stops here deliberately — `dep-files.ts` records why the same
 * move over a package's `dist` is a judgement this one is not.
 */
const PACKAGE_BUILD_READS = [...new Set([
  ...PACKAGE_BUILD_OUTPUTS.filter(out => !out.endsWith(`/${PUBLISH_TREE}`)),
  ...PACKAGE_BUILD_INPUTS.filter(input => input.endsWith('/package.json')),
])].sort();

/** What `build` writes: the app that `needsApp` steps read */
export const APP_OUTPUTS = ['packages/renderer/dist', 'packages/api/dist', 'packages/main/dist', 'packages/preload/dist'];

/**
 * Whether a step reads the built app — derived from what it declares, never written beside it.
 *
 * Derived because **the expensive consequence is already derived from the same inputs**: a step declaring
 * `APP_OUTPUTS` runs after `build:runtime` because `dependsOn` reads outputs against inputs, whatever any field
 * says. A declared field would be a second copy of that fact, able to disagree with the graph, with
 * `check:tiers` clauses spent keeping it equal. What this does *not* replace is the
 * script scan in `check-test-tiers.ts`: a step can launch the app while declaring none of its outputs, which
 * no reading of the inputs can see, and that is the clause that catches it.
 */
export const needsApp = (step: Pick<ChainStep, 'inputs'>): boolean =>
  step.inputs.some((input) => APP_OUTPUTS.includes(input));
/** The Electron entry and the dev-mode switch: not inside a package, and read by anything that starts the app */
const APP_ENTRY = ['packages/entry-point.mjs', 'packages/dev-mode.js'];
/** The wrapper a shell-script step runs through, and the module that bounds it */
const BOUNDED_RUNNER = ['scripts/bounded.ts', 'scripts/lib/bounded-spawn.ts'];

/**
 * What *runs* the app's builds, as against what those builds read.
 *
 * `build:runtime` is a scheduler over four build commands, and these decide which workspaces are built and
 * how. A pass recorded before the leg
 * table changed is not evidence about the pass after it — drop a leg and the step would otherwise stay
 * fresh while producing one `dist` fewer.
 *
 * `scripts/lib/measure.ts` is here for `--cores`'s parser alone, which is the shape `SUITE_RUNNER` has
 * too: a module that decides *how much of the machine* the step takes is part of what the step does.
 * `chain-inputs.spec.ts` derives this closure and fails anything in it left undeclared.
 *
 * `bounded-spawn.ts` alone and not `BOUNDED_RUNNER`: this step spawns through the module, not through the
 * `scripts/bounded.ts` wrapper a shell-script step runs under, and declaring the wrapper would re-run four
 * builds for an edit that cannot reach them.
 */
const APP_RUNNER = ['scripts/build-runtime.ts', 'scripts/lib/runtime-build-legs.ts', 'scripts/lib/bounded-spawn.ts',
  'scripts/lib/chain-schedule.ts', 'scripts/lib/exit-on-epipe.ts', 'scripts/lib/measure.ts'];

/**
 * What *runs* a unit suite, as against what the suite reads — and an input to every project all the same.
 *
 * These decide what runs and how: the runner picks which projects a pool runs, `unit-suites.ts` says which
 * pool a suite is even in, `with-source.mjs` supplies the `@apackdev/source` condition the host suites
 * resolve under, the bounded runner bounds the spawn, and `spec-durations.ts` and `spec-halves.ts` decide
 * what the run then *accepts* — a `@slow:` marker that is no longer true fails the step, so they are as
 * much a part of the verdict as the runner is. `over-budget.ts` and `test-timeouts.ts` say which of a run's passes it
 * reports as slow. A pass recorded before one of them changed is not evidence
 * about the pass after it, so a project whose runner moved is stale.
 *
 * **Every project declares them, not only the pool step.** Declared on the step alone, a runner edit makes
 * the step stale, it runs, finds every project fresh, and stamps green having tested nothing.
 */
const SOURCE_RUNNER = ['scripts/with-source.mjs', 'packages/apack-host/src/build/node-options.js',
  'packages/apack-host/src/build/node-options.d.ts'];
const SUITE_RUNNER = ['scripts/test-unit-pool.ts', 'scripts/lib/unit-pool.ts', 'scripts/lib/unit-suites.ts',
  'scripts/lib/exit-on-epipe.ts', ...SOURCE_RUNNER, 'scripts/lib/spec-durations.ts',
  'scripts/lib/spec-durations-reporter.ts', 'scripts/lib/over-budget.ts', 'scripts/lib/test-timeouts.ts',
  'scripts/lib/spec-halves.ts', 'scripts/lib/chain-only.ts', ...BOUNDED_RUNNER];
/**
 * What `build:default-setup` writes. `src/__generated__` is under the `src` it also reads, so it has to be declared:
 * `fingerprintUnit` excludes a unit's own output from its own fingerprint, and that is what stops the step
 * invalidating itself the first time codegen stops being byte-identical.
 */
export const PACK_OUTPUTS = ['packages/default-setup/dist', 'packages/default-setup/src/__generated__'];

/** Authored pack inputs for its build and facade. Runtime app checks consume PACK_OUTPUTS instead. */
const PACK_SOURCES = ['packages/default-setup/src', 'packages/default-setup/apack.json',
  'packages/default-setup/package.json'];

/**
 * What a step reads to derive something from the pack's sources, which `build:default-setup` and `facade:check` both do:
 * those sources, the test roots included by that tsconfig and captured during compiler startup,
 * the tsconfig itself, the committed facade report, and
 * the `@apackdev/cli` bundle that does the deriving.
 *
 * Named once because the two lists are identical and nothing would notice them drifting apart — the failure
 * `packages:ensure`' inputs are derived to avoid, a few hundred lines up. The two steps differ in what they
 * *write*, not in what they read: `build:default-setup` declares `PACK_OUTPUTS`, and the check declares nothing.
 */
const PACK_DERIVED_READS = [...ROOT, ...PACK_SOURCES, 'packages/default-setup/tsconfig.json',
  'packages/default-setup/tests', 'packages/default-setup/etc', ...PACKAGE_BUILD_READS];

/**
 * What building the fixture packs writes, derived from the fixtures themselves. These sit *inside*
 * `tests/packs`, which the same step declares as an input, for the same reason as above.
 */
const FIXTURE_PACKS = fs.readdirSync(path.join(REPO_ROOT, 'tests', 'packs'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(REPO_ROOT, 'tests', 'packs', entry.name, 'apack.json')))
  .map((entry) => entry.name)
  .sort();
const DEFAULT_FORK_OUTPUT = 'node_modules/.cache/apack-fixtures/default-fork';
const FIXTURE_OUTPUTS = FIXTURE_PACKS.flatMap((name) => [`tests/packs/${name}/dist`, `tests/packs/${name}/src/__generated__`]);

/**
 * What running a fixture pack's own Playwright suite leaves behind. Nothing reads it, and it changes every
 * run, so a step that declares `tests/packs` has to say it reads around this or it can never cache.
 */
const FIXTURE_TEST_OUTPUT = FIXTURE_PACKS.flatMap((name) => [`tests/packs/${name}/.apack/tests`, `tests/packs/${name}/.apack/drive`]);

/**
 * The unit suites that read build output, and which. Every other suite resolves workspace source through
 * the `@apackdev/source` condition and needs nothing built, which is what lets it start beside the builds.
 *
 * **This cannot be derived from the spec sources, and a scan of them is not the authority.** `@app/api`'s
 * specs never name the pack's `dist`: they boot the app runtime, and host code resolves the path. Declaring
 * that suite as reading nothing let it run beside `build:default-setup` under three lanes, where it failed with
 * "Missing or unreadable settings.content.json" — after passing serially forever, because `build:default-setup` always
 * happened to finish first.
 *
 * Ground truth comes from running each suite with the tree moved aside, which is repeatable:
 *
 *     mv packages/default-setup/dist packages/default-setup/.dist-aside
 *     for w in <the UNIT_SUITES workspaces>; do npm test -w $w; done
 *     mv packages/default-setup/.dist-aside packages/default-setup/dist
 *
 * Measured 2026-09-25: default-setup, @apackdev/cli and @app/api fail without it; the other five pass.
 *
 * `@apackdev/host` is listed anyway, and that is the second thing a scan would get wrong. Its
 * `sdk-bridge-drift.spec.ts` reads `dist/runtime/index.cjs` but *skips* when it is missing, so it passes
 * without the pack and would pass vacuously if it raced `build:default-setup`. A check that silently stops checking is
 * worse than one that fails, so its verdict depends on that tree and it declares it.
 */
/**
 * `repo` says the suite holds a guard whose subject is the whole tree, so its inputs are the whole tree.
 * Without it the pool skips the project while the thing it checks moves — see `EVERY_SOURCE`.
 */
export const SUITE_READS: Record<string, { packages?: true; pack?: true; repo?: true; inputs?: readonly string[]; integrationInputs?: readonly string[] }> = {
  // `pretest: ensure-packages-built`, `@apackdev/testing`'s bundle, and its own compiled content under `dist/`
  'default-setup': { packages: true, pack: true },
  // `pretest: ensure-packages-built`; it packs and installs the published packages, and `dependency-runtime`
  // builds a fixture pack against default-setup's `dist`
  'apack-cli': { packages: true, pack: true },
  // `@apackdev/testing`'s bundle; and `sdk-bridge-drift.spec.ts` reads `dist/runtime/index.cjs` when it is
  // there and skips when it is not, so the tree decides whether that check checks anything
  'apack-host': { packages: true, pack: true },
  // Boots the app runtime, which loads the built-in pack: `dist/runtime/index.cjs` and `settings.content.json`.
  // The runtime also imports root package metadata for the app version.
  api: { pack: true, inputs: ['package.json'] },
  // `pretest: ensure-packages-built`; `published-sdk-peers` reads the built `dist` and skips without it.
  // `repo`: six of its specs ask git what the repo holds — the chain's input coverage, spec placement,
  // the lint's scope, the import rules — so every one of them is about files this package does not own
  // The integration HMR check traverses the fixture packs' generated frontend entries.
  // `inputs: ['docs']`: `doc-links` resolves every relative link between the repo's documents, and a
  // dead link fails nothing on its own — so the tree it reads has to be in this step's key or the check
  // caches over a move. Only here, since a typo in a guide should not re-run `typecheck`.
  'repo-checks': { packages: true, repo: true, inputs: ['docs'], integrationInputs: FIXTURE_OUTPUTS },
  // `pretest: ensure-packages-built`; it npm-packs the built packages into a consumer and compiles it
  'publish-checks': { packages: true },
};


/**
 * The files a chain step is declared in — the two tables, as one list, repo-relative.
 *
 * Two readers need it and had their own copies: `declaredIn` (`scripts/chain.ts`), which points a run at the
 * reasoning behind a never-cached step, knew only this file and so could not locate the seventeen typecheck
 * legs or the generated pool steps. One question with two answers, and the one that was wrong was the one
 * nothing checked — `chain-graph.spec.ts` holds every step to being locatable through this list.
 */
export const STEP_TABLES = ['scripts/lib/chain-steps.ts', 'scripts/lib/typecheck-legs.ts'];

/**
 * What one unit suite's last pass depended on: its own workspace, its dependencies' source, whatever build
 * output it touches, and what ran it.
 *
 * **One definition for both cache layers, which is the invariant.** The chain step below declares the union
 * of this across a pool, and `scripts/lib/unit-pool.ts` fingerprints it per project so a pool runs only the
 * stale ones. Two layers over one body of work are only sound when the inner layer's inputs cover the
 * outer's: anything the outer treats as a reason to run has to be a reason for some inner unit to run, or
 * the step runs, skips everything and stamps green. Deriving both from here is what makes that hold by
 * construction rather than by anyone remembering; `chain-inputs.spec.ts` checks the step against what the
 * pool actually fingerprints, so re-adding a step-only input fails by name.
 *
 * **The union is wide, and measured, that costs almost nothing — which is the whole point of the pair.**
 * Over the 200 commits to 2026-10-02 (by prefix match against each declared path, with the files a
 * fingerprint skips removed): `test:unit:host` was stale in 154 of them, and when it ran **3.2 of its 11
 * projects** ran; `test:integration` 154, and 1.7 of 3. So a step declaring 365 paths pays its own startup
 * and hands the rest to the inner cache. 288 of those 365 were never a reason to run at all — `dist` and
 * `publish` trees, `bin/`, `env.d.ts`, `eslint.config.ts` — the same breadth the typecheck legs' 0-21% is
 * mostly made of (`scripts/lib/dep-files.ts`).
 *
 * **The one project that never benefits is `repo-checks`**, stale in 154 of 154 — it declares `EVERY_SOURCE`
 * below, because six of its specs ask git what the repo holds, and that is a rule rather than an oversight
 * (`fingerprint-scope.spec.ts`: a suite holding a guard over the whole repo declares the whole repo).
 * Splitting those six out so the other seventeen cache separately was costed and declined: they are specs
 * about this repo's tooling, so they are stale whenever `scripts/` moves — 97 of the same 200 commits — and
 * would re-run anyway. Worth revisiting if that suite's cost grows or its repo-wide specs stop dominating
 * it. The sample is this branch's own work, so `scripts/` and `repo-checks/tests` lead it by construction;
 * re-take it over a stretch of feature work before reading the per-project ranking as general.
 */
export function suiteInputs(suite: UnitSuite, half: Half): string[] {
  const reads = SUITE_READS[suite.dir] ?? {};
  return [
    ...ROOT,
    // A suite's half runs under one root config, so which projects that config pools is an input to it
    ...rootConfigFor(suite, half),
    ...SUITE_RUNNER,
    ...suiteWorkspace(suite.dir),
    ...workspaceDeps(suite.dir).flatMap(dependencySource),
    ...(reads.inputs ?? []),
    ...(half !== 'fast' ? reads.integrationInputs ?? [] : []),
    ...(reads.packages ? PACKAGE_BUILD_READS : []),
    ...(reads.pack ? PACK_OUTPUTS : []),
    ...(reads.repo ? EVERY_SOURCE : []),
  ];
}

/**
 * The suites with an expensive half, derived from which configs each package has rather than listed here.
 *
 * One step runs all of them (`npm run test:integration`), so the set has to be the same in two places: the
 * step's inputs, and the root script's `-w` flags. A package that gains an integration config is covered
 * by the first automatically, and `chain-inputs.spec.ts` fails the second until it names the package too —
 * which is the half a derivation cannot do for itself, an npm script being text.
 */
export const INTEGRATION_SUITES = UNIT_SUITES.filter((suite) => hasHalf(path.join(REPO_ROOT, 'packages', suite.dir), 'integration'));

/** The suites with a native half (`NATIVE_SUFFIX`), derived the same way: one step runs them, `npm run test:native` */
export const NATIVE_SUITES = UNIT_SUITES.filter((suite) => hasHalf(path.join(REPO_ROOT, 'packages', suite.dir), 'native'));

/**
 * The cache key of a step that runs suites: the union of what each of them reads, and nothing else.
 *
 * Every such step goes through here, so the step's key and the per-suite key are the same declaration
 * (`suiteInputs`) rather than two that have to agree. A step that builds its inputs some other way can
 * declare less than its suites read and still stamp green, which is a stale pass nothing reports — and
 * `suite-reads.spec.ts` cannot see it, because that compares each suite against `suiteInputs`, not against
 * whatever its step declared.
 *
 * The exclusion goes with it. Repository guards read fixture sources; the integration HMR check also
 * traverses generated frontend entries and must follow their producer. App test results remain excluded.
 */
function inputsForSuites(suites: readonly UnitSuite[], half: Half): Pick<ChainStep, 'inputs' | 'excludes'> {
  return {
    inputs: [...new Set(suites.flatMap((suite) => suiteInputs(suite, half)))].sort(),
    ...(suites.some((suite) => SUITE_READS[suite.dir]?.repo)
      ? { excludes: [...(half !== 'fast' ? [] : FIXTURE_OUTPUTS), ...FIXTURE_TEST_OUTPUT] }
      : {}),
  };
}

/**
 * One step per pool, not per suite.
 *
 * Eight steps meant eight vitest processes, which is the ceiling `docs/plans/test-unit-scheduling.md`
 * existed to remove: two schedulers with no shared budget. What the split was actually buying was the
 * per-package *cache key*, not the per-package *process*, and those are separable — the step's inputs are
 * the union across its pool, so a warm chain caches the whole step, and when it does run,
 * `test-unit-pool.ts` asks `suiteInputs` per project and passes `--project` for only the stale ones.
 *
 * Two pools rather than one because host suites resolve workspace source and the pack suite must resolve
 * the published `dist`, and Node conditions are per process: see `UnitSuite.kind`.
 */
/**
 * What a typecheck leg reads, from the scope it declares.
 *
 * Derived rather than listed, so a leg cannot carry an input set that disagrees with what it checks —
 * `typecheck-legs.spec.ts` holds the scope itself to what the leg's script names, and this turns that one
 * declaration into the key.
 *
 * **Every leg still declares the built `@apackdev` packages**, which is broader than most read and is kept
 * that way on purpose: the single `typecheck` step this replaces declared them, the edge into
 * `packages:ensure` derives from them, and the legs with no dep file — the lint, the import rules, the
 * API stamp — are exactly the ones whose reads nothing reports.
 *
 * **It does not declare the pack's `dist`, because no leg reads it.** Checked against the dep files: not
 * one of the fourteen reads `packages/default-setup/dist`. What `typecheck:pack` really reads is the 19
 * generated files under `src/__generated__`, which `build:default-setup` also writes and which `src` already covers —
 * so the edge to `build:default-setup` survives on the leg that has it, and the other fourteen stop waiting for a
 * build they never read.
 *
 * What the scope narrows is the source: an edit under the renderer does not invalidate `typecheck:ears`.
 *
 * `dep-files.spec.ts` checks each leg's declaration against what the compiler reported reading, which is
 * the half that would catch a scope narrower than the truth.
 */
const legInputs = (leg: Leg): string[] => [...new Set(scopeOf(leg) === 'repo'
  ? [...EVERY_SOURCE, ...PACKAGE_BUILD_READS]
  : [...ROOT,
    ...(leg.alsoReads ?? []),
    ...(scopeOf(leg) as readonly string[]).flatMap(suiteWorkspace),
    ...(scopeOf(leg) as readonly string[]).flatMap((dir) => workspaceDeps(dir)).flatMap(dependencySource),
    ...PACKAGE_BUILD_READS])].sort();

/**
 * One step per typecheck leg, which is what makes the chain's scheduler the only one.
 *
 * A single typecheck step running its legs on lanes of its own would be a second scheduler guessing how
 * much of the machine the chain leaves it. One scheduler owns every lane, and `npm run typecheck` remains
 * for a person running it directly, where there is nothing to contend with.
 *
 * `packages:ensure` is a leg *and* a step, and it is declared as a step: the legs that read what it builds
 * derive an edge to it from `PACKAGE_BUILD_OUTPUTS`, so there is nothing for a second copy to add.
 *
 * Measured 2026-10-01 under `chain --all`: the medians are within a second either way, since the chain is
 * core-bound, but the spread is 0.7s against 18s with two schedulers competing.
 */
const TYPECHECK_STEPS: readonly ChainStep[] = TYPECHECK_LEGS
  .filter((leg) => leg.name !== 'packages:ensure')
  .map((leg) => ({
    name: leg.name,
    // Declared beside the legs (`LEG_TIMEOUT`), so the runner and this copy of the same steps cannot
    // disagree about it
    timeout: LEG_TIMEOUT,
    inputs: legInputs(leg),
    // A leg reading every source tree reads around the fixture packs' build output for the same reason
    // the single step did: `tsc -p tests` compiles `e2e/**` only and `check:specifiers` filters
    // `__generated__` itself, so hashing it would tie the leg to a build it does not depend on.
    ...(scopeOf(leg) === 'repo' ? { excludes: [...FIXTURE_OUTPUTS, ...FIXTURE_TEST_OUTPUT] } : {}),
  }));

/**
 * Which step runs a pool, for the caller that has a pool and needs the step.
 *
 * **It does not generate the table's names, and that is deliberate.** `declaredAt` locates a step whose
 * name is generated by matching the *template literal* it was built from, which is how a run points at a
 * step's reasoning instead of repeating it — so building the names with a call to this would make the pool
 * steps unlocatable. The table keeps its literals; this is the reverse lookup, and `unit-pool.spec.ts` holds the two to each other so neither can
 * be renamed alone.
 */
export const poolStepName = (pool: 'host' | 'pack' | 'integration' | 'native'): string =>
  (pool === 'integration' || pool === 'native' ? `test:${pool}` : `test:unit:${pool}`);

const POOL_STEPS: readonly ChainStep[] = (['host', 'pack'] as const).map((kind) => {
  const suites = UNIT_SUITES.filter((suite) => suite.kind === kind);
  return {
    name: `test:unit:${kind}`,
    // A pool fans out across workers
    timeout: 'suite' as const,
    ...inputsForSuites(suites, 'fast'),
    // It keeps a cache of its own, so the chain's `--all` has to reach inside it
    forceArgs: ['--all'],
  };
});


export const CHAIN_STEPS: readonly ChainStep[] = [
  // Takes the package build lock, so it cannot share a lane with anything else that builds
  // This step has an inner cache too — `ensurePackagesBuilt()` consults the build stamps — and one input the
  // inner layer cannot see: `ensure-packages-built.ts`. That is safe, and worth saying why rather than
  // leaving a reader to check: the file is the command over the rule, so it cannot change what "built"
  // means, and the rule itself (`BUILD_UNITS` in `@apackdev/host`) is inside every unit's own inputs. It takes
  // no `forceArgs` for a second reason — 18 call sites reach `ensurePackagesBuilt()` in a serial chain, each
  // a stat and a return, so forcing it would turn them into 18 builds behind one lock.
  // Not cached. With the package stamps removed but `dist` still on disk, a cached step would report fresh —
  // its inputs had not moved — while `packagesBuiltOrRefuse()` refused, because the stamps are what it reads,
  // and every step that guards on the built packages would fail at collection. The step's own check is
  // content-addressed and returns in ~0.3s warm, so a chain-level cache on top buys nothing.
  { name: 'packages:ensure', timeout: 'suite',
    neverCachedBecause: 'what it guarantees is recorded in stamps of its own, which this fingerprint cannot '
      + 'see; its check is ~0.3s warm, so a cache on top only adds a record that can disagree',
    inputs: [...PACKAGE_BUILD_INPUTS, 'scripts/ensure-packages-built.ts'], outputs: PACKAGE_BUILD_OUTPUTS },
  // publint and attw over the five trees npm publishes, at seconds of cost, so a chain step rather than a
  // check left to the publish workflow.
  //
  // Not the dangling-path check, and the difference matters: publint skips any target behind a custom
  // condition (`hasCustomCondition`) and attw resolves standard conditions only, which is how 99 published
  // paths named files no tarball held. `@app/publish-checks`' `published-manifest-paths` is that check.
  //
  // It reads the published trees, which `PACKAGE_BUILD_OUTPUTS` covers along with the `dist` they are staged
  // from — the same constant `packages:ensure` declares as its outputs, so every input here is an ancestor's
  // output and the gitignored-input accounting holds without a second list to keep.
  /**
   * The reviewed reports of the published API, regenerated and compared.
   *
   * **A derivation, not a proxy.** It regenerates the reports and compares, so it has no record of its own to
   * go stale, and at its cost a hash of the declarations would buy nothing. A proxy's remedy is a *write*, so
   * one racing a rebuild in flight would record a hash of a half-written tree and look like it worked.
   *
   * Its inputs are the declarations it reads and the reports it compares against, so a hand-edited `etc/`
   * invalidates it.
   */
  // `suite` because it fans out — three extractions at once (`scripts/api-check.ts`) — which is the kind of
  // work that rung names. `chain-graph.spec.ts` holds every step to the rung its work implies
  { name: 'api:check', timeout: API_CHECK_TIMEOUT,
    // The three packages it reports on, and nothing else that was built: not the CLI and testing bundles it
    // never opens, nor the `publish/` trees, which are a staged copy of the same declarations.
    //
    // Each package's own `package.json` is where the entry set comes from (`reportEntries` over `exports`),
    // so it is declared outright — an entry added to a map must invalidate this step.
    //
    // The extractor and its config decide what a report says, so they belong in the key beside the trees.
    // `component-contracts.ts` writes every `.component.md` and `api-entries.ts` decides which entries get a
    // report at all, so each is a module whose edit moves a report while the script that imports it does not.
    // The closure check in `chain-inputs.spec.ts` is what found them and what keeps the next one from hiding
    inputs: [...ROOT,
      'packages/apack-ears/dist', 'packages/apack-sdk/dist', 'packages/apack-ui/dist',
      'packages/apack-ears/package.json', 'packages/apack-sdk/package.json', 'packages/apack-ui/package.json',
      'scripts/api-check.ts', 'scripts/lib/api-report-packages.ts', 'scripts/lib/exit-on-epipe.ts',
      // `bounded-spawn` is how this runs the three extractions
      'scripts/lib/bounded-spawn.ts',
      'scripts/api-reports.ts', 'scripts/component-contracts.ts', 'scripts/lib/api-entries.ts',
      'packages/apack-ears/etc', 'packages/apack-sdk/etc', 'packages/apack-ui/etc',
      'packages/apack-ears/tsconfig.api-extractor.json', 'packages/apack-sdk/tsconfig.api-extractor.json',
      'packages/apack-ui/tsconfig.package.json'],
    // A report is a function of the declarations a package built. The compiled output beside them is what
    // `declaration: true` emits past them, and no report has ever read one
    excludeSuffixes: ['.js', '.mjs', '.cjs', '.js.map', '.mjs.map', '.cjs.map', '.css', '.css.map'] },
  // Nothing it runs writes into a tree another step reads, so it takes no mutex: `scripts/packages-check.ts`
  // packs each tarball `attw` wants into a temp directory outside the repository, where `attw --pack` packed
  // it inside the tree it was checking, which conflicted with every other step reading those trees.
  { name: 'packages:check', timeout: 'quick',
    // Its own script and what that reaches, as `api:check` declares its own: `packages-check-plan.ts` decides
    // which tool is asked of which tree, and `published-manifest.ts` is where `packTree` lives — so an edit to
    // either moves what this step checks while a fingerprint over the trees alone would read fresh. The two
    // modules beside it are that module's own imports, which the closure check in `chain-inputs.spec.ts`
    // follows: over-declaring costs a cache hit, under-declaring is silent
    inputs: [...ROOT, ...PACKAGE_BUILD_OUTPUTS,
      'scripts/packages-check.ts', 'scripts/lib/packages-check-plan.ts', 'scripts/lib/exit-on-epipe.ts',
      'packages/apack-host/src/build/published-manifest.ts',
      'packages/apack-host/src/build/source-resolution.ts',
      'packages/apack-host/src/build/node-options.js', 'packages/apack-host/src/build/node-options.d.ts',
      'packages/apack-host/src/replace-dir.ts'] },
  // Build the built-in pack before build:runtime reads its outputs.
  // Includes cold compiler capture, codegen, all bundles and final source/input verification.
  { name: 'build:default-setup', timeout: 'suite', outputs: PACK_OUTPUTS,
    // Compiler startup captures every root in the pack tsconfig, including its tests.
    //
    // The CLI's sources reach here through `PACKAGE_BUILD_OUTPUTS`, since an edit to them makes the
    // `@apackdev/cli` build unit stale and `packages:ensure` rewrites the bundle this declares — and what the
    // bundle does decides what this step writes.
    //
    // `etc` is the committed facade report, which the build reads to warn when the bundle it has just
    // produced has outgrown it. A read is a read, so a hand-edited report invalidates this step, even though
    // what it buys here is a warning rather than a verdict — `facade:check` below is the step that fails
    inputs: PACK_DERIVED_READS },
  // Compare the committed report with a verified current build; never regenerate shared inputs here.
  // Source/dependency freshness uses the build's recorded context, not this inspecting command's compiler.
  { name: 'facade:check', timeout: 'quick',
    inputs: [...PACK_DERIVED_READS, ...PACK_OUTPUTS] },
  // The fixture packs depend on default-setup, so they need its snapshot from build:default-setup
  //
  // The third place in this chain with a cache inside a cached step, and the one that is benign: `apack
  // build` skips `generate-entries` when its generation stamp matches. It takes no `forceArgs` because a skip
  // there cannot make the step a no-op — the script runs four commands per fixture (`validate`, `build`,
  // `tsc --noEmit`, `test --contract`) and only the second caches anything, so the step still validates,
  // typechecks and runs the harness specs however that hash reads. That is the whole reason, and it is the
  // condition to re-check: were this step's work ever to become `apack pack build` alone, or were that skip to
  // grow to cover the typecheck or the specs, it would be stale for a reason its inner layer cannot see, so
  // it would run, skip everything and stamp green.
  { name: 'test:external-pack:contract', timeout: 'suite', outputs: FIXTURE_OUTPUTS,
    // It declares `tests/packs` for the pack sources; the Playwright output under each pack is written
    // by `:app`, changes every run, and is read by nothing
    excludes: FIXTURE_TEST_OUTPUT,
    inputs: [...ROOT, ...BOUNDED_RUNNER, 'tests/packs', 'tests/scripts/test-external-pack-contract.sh',
      'tests/scripts/lib', ...PACKAGE_BUILD_READS, ...PACK_OUTPUTS] },
  // A full shipped-pack fork is a separate producer, not work charged to the fixture contract suite.
  // Its 120s is the shipped build's measured 60s with as much again for the archive phase, which is not measured separately.
  // A 600s build, 180s archive and 120s housekeeping compose the existing 900s scenario bound.
  { name: 'test:external-pack:fork', timeout: 'scenario', outputs: [DEFAULT_FORK_OUTPUT],
    inputs: [...PACK_DERIVED_READS, ...BOUNDED_RUNNER, 'tests/scripts/prepare-default-pack-fork.ts',
      ...['apack-host', ...workspaceDeps('apack-host')].flatMap(dependencySource), ...PACK_OUTPUTS] },
  // The widest inputs in the table, and honestly so: it compiles every workspace, the scripts and the
  // tests, and lints them. A change anywhere in the repo's TypeScript is a change to what it checks.
  ...TYPECHECK_STEPS,
  ...POOL_STEPS,
  // The CLI specs that run a real build, install or child process. They need the built packages,
  // never the app — which is why they can run before `build` rather than behind it.
  // Needs `build:default-setup` and not just `packages:ensure`, because `dependency-runtime` builds a pack that depends
  // on default-setup and so reads its `dist`. Table order promises nothing (`orderedSteps`), so the edge is declared.
  { name: 'test:integration', timeout: 'acceptance',
    // It keeps a cache of its own, like the two unit pools, so `--all` has to reach inside it
    forceArgs: ['--all'],
    ...inputsForSuites(INTEGRATION_SUITES, 'integration') },
  // Native runtime and live-watcher scenarios, beside integration rather than inside it: same reads, and a
  // run of its own so it can be scheduled, selected and sharded apart from the ordinary integration specs.
  { name: 'test:native', timeout: 'acceptance', linuxOnMac: true,
    forceArgs: ['--all'],
    ...inputsForSuites(NATIVE_SUITES, 'native') },
  // build:default-setup owns pack outputs; build:runtime only builds the four app workspaces.
  // **No pack's `src` here, and that is a property of the build rather than an omission.** Nothing compiles a
  // pack into the app: a pack's backend is loaded at run time from its own `dist/runtime/index.cjs` and its
  // frontend fetched over `pack://`, so what this reads of a pack is `PACK_OUTPUTS` — its `dist`, which holds
  // both bundles. A pack source edit reaches this step through `build:default-setup`. `check:tiers` and the
  // app build's own header keep an app bundle from tracing into a pack's `src`
  { name: 'build:runtime', timeout: 'suite', outputs: APP_OUTPUTS,
    inputs: [...ROOT, ...APP_RUNNER, ...['renderer', 'api', 'main', 'preload', 'apack-host'].flatMap(workspace),
      'packages/api/tsup.config.ts', 'build/build-metadata.ts', 'package.json', ...APP_ENTRY,
      ...PACKAGE_BUILD_READS, ...PACK_OUTPUTS] },
  // App checks load the shipped pack separately at runtime. Its bytes can change while every
  // app workspace bundle stays identical, so their cache keys must include PACK_OUTPUTS too.
  // Each fixture pack's Playwright suite on one worker per three cores, with the default-fork lifecycle
  // beside them where there are cores for it.
  { name: 'test:external-pack:app', timeout: 'scenario',
    // Its own Playwright output, rewritten every run
    excludes: FIXTURE_TEST_OUTPUT,
    // PACKAGE_BUILD_OUTPUTS because the fixture it drives *is* one: `@apackdev/testing` resolves to its
    // built bundle, which launches Electron, finds the window and bypasses onboarding. Reached by package
    // name rather than by path, so nothing that reads a step's text can see the edge
    keepsOnFailure: FIXTURE_TEST_OUTPUT,
    inputs: [...ROOT, ...BOUNDED_RUNNER, 'tests/packs', 'tests/scripts/test-external-pack-app.sh',
      'tests/scripts/test-default-pack-fork.ts', 'tests/scripts/prepare-default-pack-fork.ts', DEFAULT_FORK_OUTPUT, 'tests/scripts/lib', 'playwright.config.ts', ...PACKAGE_BUILD_READS, ...APP_OUTPUTS, ...PACK_OUTPUTS] },
  // Never cached: it drives real Electron with real timing and is the likeliest step to be flaky, and a
  // flaky pass cached green hides an intermittent failure indefinitely. 28s is cheap enough to always pay.
  // It declares what it writes although it is never cached and so never reads a stamp: the guard that a
  // step depending on another's output says so can only see outputs that are declared, and a step declaring
  // `tests` would otherwise contain these and never cache.
  // The four cases that say the app is an app: it launches without crashing, reaches `connected`, has
  // its surfaces, and runs in its own data dir. **This one is a gate**, where the suite around it is not.
  //
  // The distinction is what the suite failed and these pass: a regression gate has to assert something a
  // change could break, and "the app starts" is the assertion every other check silently assumes. Taking
  // the whole suite off the chain took that with it, and 3.5s is not a price worth arguing about for the
  // one check that makes a green run mean anything.
  //
  // `test` depends on it so the two never run at once: both drive Playwright at `.apack/tests/results`, which it
  // wipes at the start of a run, and a full suite is also the faster failure for having gone through this.
  //
  // **Cached, where the suite is not**, and the difference is the subject rather than the mechanism. The
  // suite is never cached because it drives real timing across fourteen files and a flaky pass cached
  // green hides an intermittent failure. These four cases are deterministic, and every input they have is
  // declared — so an unchanged stamp means the same app, and running it again asks a question already
  // answered. Uncached it put the warm chain back to 5.6s from 0.9s, which is most of what taking the
  // suite off the gate bought.
  { name: 'test:smoke', timeout: 'suite',
    // The fixture writes the app's stdout and stderr here (`app-<workerIndex>.log`), which is the only
    // account of why an app did not start or did not close. Playwright clears the directory on the way in,
    // so the next run would take it
    evidence: ['.apack/tests/results'],
    inputs: [...ROOT, 'tests/e2e/smoke', 'playwright.config.ts',
      ...SOURCE_RUNNER, ...APP_ENTRY, ...PACKAGE_BUILD_READS, ...APP_OUTPUTS, ...PACK_OUTPUTS] },
  // The rest of the E2E suite. **Opt-in, not a gate** — `npm run chain -- --e2e`.
  //
  // It was built to be driven: to watch the app while writing a feature, and to let an agent see what it
  // built. It became a chain step, and then the reasoning about it became about caching a flaky pass —
  // which is a question you only ask of a regression gate. It has not caught one. Off the chain it costs
  // nothing and is still there when you want it, which is what it was for.
  { name: 'test:e2e', timeout: 'suite',
    optInBecause: 'it is a harness for driving the app, not a regression gate; nothing has needed it to fail',
    neverCachedBecause: 'it drives real Electron, and a flaky pass cached green hides an intermittent failure',
    evidence: ['.apack/tests/results'],
    // The published trees, because the fixture every spec imports resolves `@apackdev/testing`'s built bundle
    // from one of them — and `packages:check` packs a tarball inside those trees and recreates them, which a
    // reader must not observe. Declaring them is what makes that a mutex instead of a scheduling accident;
    // the step is never cached, so it buys the ordering and costs no precision
    inputs: [...ROOT, 'tests/e2e', 'playwright.config.ts', ...SOURCE_RUNNER, ...APP_ENTRY,
      ...PACKAGE_BUILD_READS, ...APP_OUTPUTS, ...PACK_OUTPUTS] },
  /**
   * Two steps, split at the app boundary: only the last of the check's nine phases launches one.
   *
   * The author half hands over through `tests/authoring-handoff`, its output and the app half's input, so
   * the edge derives like any other. The work dir that names is **outside** the checkout deliberately — a
   * pack built inside it would resolve `@apackdev/*` by walking up to the workspace `node_modules`, which is
   * what the check exists to disprove — so the handoff carries a path and the archive's digest instead.
   *
   * Neither half deletes that dir: it is the author half's declared output, and a step whose output is gone
   * reads as never-built. The author half clears the previous run's at its start.
   */
  { name: 'test:packaged-authoring:author', timeout: 'scenario',
    outputs: ['tests/authoring-handoff', 'tests/authoring-handoff/work-ready', 'tests/authoring-handoff/archive'],
    // APACK_HOST selects default-setup's built snapshot for the external pack's dependency.
    inputs: [...ROOT, ...BOUNDED_RUNNER, 'tests/scripts/test-packaged-authoring-author.sh',
      'tests/scripts/lib', ...PACKAGE_BUILD_READS, ...PACK_OUTPUTS] },
  { name: 'test:packaged-authoring:app', timeout: 'suite',
    inputs: [...ROOT, ...BOUNDED_RUNNER, 'tests/scripts/test-packaged-authoring-app.sh',
      'tests/scripts/lib', 'tests/authoring-handoff', ...PACKAGE_BUILD_READS, ...APP_OUTPUTS, ...PACK_OUTPUTS] },
];
