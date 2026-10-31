/**
 * A unit pool's per-project cache: where a project's stamp lives and what it is a fingerprint of.
 *
 * The definition, not the command — `scripts/test-unit-pool.ts` is the command over it, the same split as
 * `scripts/ensure-packages-built.ts` over `@apackdev/host/build/packages-built`. It is a module of its own for
 * one reason: the guard in `chain-inputs.spec.ts` has to read what the pool actually fingerprints, and the
 * pool script runs its `main()` on import, so a spec cannot ask it.
 *
 * Both this and the chain's pool step derive from `suiteInputs`, whose doc carries the rule the pair of
 * caches holds to and what happened when it did not.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { holdExclusiveLock, type ExclusiveLock } from '@apackdev/host/exclusive-lock';
import { diffableStamp, REPO_ROOT, stampedRunAll, type BuildUnit, type StampedUnit } from '@apackdev/host/build/packages-built';
import { INTEGRATION_SUITES, NATIVE_SUITES, poolStepName, suiteInputs } from './chain-steps.ts';
import { CONFIG_BY_HALF, hasSplit, type Half } from './spec-halves.ts';
import { coresFor } from './core-budget.ts';
import { UNIT_SUITES, type UnitSuite } from './unit-suites.ts';
import type { ReportedRun } from './spec-durations-reporter.ts';
import { asDuration, cachedDurations, costliestFiles, costOf, halfBound, halfTotal, markedSpecs, outlierIn, placementOf, readDurationRuns, trendIn, uncheckedNote, UNMARKED_NOTE, type FileDuration } from './spec-durations.ts';

/**
 * Beside the package builds' and the chain's stamps, in the same cache directory and the same format, so one
 * `fingerprintUnit` and one reader cover all three.
 */
export const POOL_STAMP_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'apack-unit-pool');

/**
 * Keyed by directory **and half**, because a suite with two halves has two things to remember.
 *
 * A suite with an integration config runs twice over one input set, and the two runs are not interchangeable:
 * its fast half can have passed while its expensive half never has. One path for both would let the second be
 * skipped on the first's record, which is the hole that kept the integration half from being pooled at all.
 *
 * **The path is where a record is kept, not what says which record it is** — that is the command in
 * `poolUnitFor`'s fingerprint, below. The half is in the path as well so that a reader of the cache
 * directory can tell the two files apart, and the provenance for the same reason: a chain pass and a lone
 * pass are two things to remember about one suite, exactly as its two halves are.
 */
export const poolStampFor = (suite: UnitSuite, half: Half, provenance: Provenance): string =>
  path.join(POOL_STAMP_DIR, `${suite.dir}.${half}.${provenance}.json`);

/**
 * This module's export that names a stamp, beside `packages-built.ts`'s three.
 *
 * Two declarations rather than one shared list, because each belongs beside the functions it names: a
 * stamp reader added here is in view of whoever adds it, which a central list two files away is not.
 */
export const STAMP_READERS = { poolStampFor } as const;

/**
 * Set on a run whose verdict must not be recorded, and read here because this is where the records are kept.
 *
 * A shard runs part of each project's specs, so a pass says nothing about the whole project; recording its
 * project stamps would let the next run skip specs it never ran (`test-unit-pool.ts` sets it for `--shard`).
 *
 * **Builds are deliberately not suppressed.** `ensurePackagesBuilt`'s stamps are read as a *precondition* by
 * other processes in the same run — `packagesBuiltOrRefuse` at every suite's collection — so a build that
 * happened and did not record it turns the run into a refusal about stale packages, which fails about the
 * wrong thing. A build records a fact about files, which is true whoever asked for it; this suppresses a
 * verdict about behaviour.
 */
export const DIAGNOSTIC_RUN_ENV = 'APACK_DIAGNOSTIC_RUN';

/**
 * Set by the chain on every step it spawns, and read here because this is where the stamps are kept.
 *
 * **It exists because a pass established alone is not the pass the chain is looking for.** Without it the
 * sequence is three commands: `npm run test:unit:host` passes serially and writes eleven project stamps,
 * `npm run chain` finds its own step stamp stale and runs the pool, the pool finds every project fresh and
 * runs **zero tests**, and the step records green in 0.8s. Observed repeatedly on 2026-10-06. The suites
 * were never run under the concurrency that is the only condition reproducing what the chain was built to
 * catch — the birpc timeout a blocked worker causes, and the 5s default a crowded `tsc` crosses.
 *
 * A positive signal rather than another negative one: the chain is the thing that knows it is the chain,
 * and anything else running a pool is by definition running it some other way.
 */
export const CHAIN_RUN_ENV = 'APACK_CHAIN_RUN';
export const CHAIN_CORES_ENV = 'APACK_CHAIN_CORES';

/**
 * Under what conditions a pool run happened, as one declaration with the type derived from it.
 *
 * Two values because two is what has consumers, and the names are the claim each one makes: `chain` is a
 * pass under the chain's concurrency, `alone` is a pass by itself. A third would need a condition anything
 * distinguishes.
 */
export const PROVENANCES = ['chain', 'alone'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** Which kind of run this is. Anything that is not the chain is `alone`, including a pack author's. */
export const provenanceOf = (env: NodeJS.ProcessEnv = process.env): Provenance =>
  (env[CHAIN_RUN_ENV] === '1' ? 'chain' : 'alone');

/** Whether this run may record what it proved */
export const recordsVerdict = (env: NodeJS.ProcessEnv = process.env): boolean => env[DIAGNOSTIC_RUN_ENV] !== '1';

/**
 * The run, stamped where its verdict may be recorded and left unrecorded where it may not.
 *
 * One function rather than a branch at the call site, so the question is asked in the module that owns the
 * stamps and a spec can watch both answers without running a suite.
 */
export async function recordRun(
  units: readonly StampedUnit[],
  run: () => void | Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Existing stamps are left exactly as they are: `stampedRunAll` clears them before the run, and clearing
  // them here would make a diagnostic invalidate records it is not allowed to write either.
  if (!recordsVerdict(env)) {
    await run();
    return;
  }
  await stampedRunAll(units, run);
}

const projectArgs = (suites: readonly UnitSuite[]): string[] =>
  suites.flatMap((suite) => ['--project', suite.workspace]);

/**
 * The durations reporter, on every pool's invocation.
 *
 * `--reporter=default` goes with it because naming any reporter *replaces* the human output — the same
 * rule `scripts/spec.ts` handles for the count reporter. The pool names the destination in the
 * environment, so this path is stable and belongs in the fingerprint: a change to what the reporter
 * records is a change to what a run proves, which is exactly the kind of thing `poolUnitFor`'s command
 * text exists to notice.
 */
const REPORTER = path.join(REPO_ROOT, 'scripts', 'lib', 'spec-durations-reporter.ts');
const reporterArgs = (): string[] => ['--reporter=default', `--reporter=${REPORTER}`];

/** A budget caps the configured pool width; it never raises it above this machine's default. */
export const poolWorkerLimit = (pool: Pool, budget?: number): number =>
  Math.min(budget ?? Infinity, coresFor(poolStepName(pool)));

/** The chain's admitted budget also bounds the worker processes its pools start. */
export function poolWorkers(pool: Pool, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = env[CHAIN_CORES_ENV];
  if (value === undefined) return undefined;
  const cores = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(cores)) throw new Error(`Invalid ${CHAIN_CORES_ENV}: ${value}`);
  return poolWorkerLimit(pool, cores);
}

function workerArgs(workers?: number): string[] {
  return workers === undefined ? [] : [`--maxWorkers=${workers}`];
}

/**
 * The pools: which half each one runs, which suites belong to it, and how it runs them.
 *
 * A pool is a resolution and a half, not a kind of test. `host` and `pack` split on resolution — Node
 * conditions are per process, so those two cannot share one — and `integration` splits on the half, which is
 * why it needs no third resolution: its suites *are* host suites, and what makes them a pool is that a second
 * config holds their expensive specs. `INTEGRATION_SUITES` derives that membership from those configs, so a
 * package that gains one joins this pool without an edit here.
 *
 * `run` is where they differ. Projects of one root config go to a single vitest with `--project`; a pack suite
 * is its own config resolving the published `dist`, so it can share a run with nothing — not even another pack
 * suite.
 *
 * Here rather than in the command, so a spec can ask which suites a pool covers and under which key. The
 * command runs its `main()` on import, which is the reason this module exists at all.
 */
export const POOLS = {
  host: {
    half: 'fast' as Half,
    suites: () => UNIT_SUITES.filter((suite) => suite.kind === 'host'),
    // with-source supplies the @apackdev/source condition the host suites resolve under
    run: (stale: readonly UnitSuite[], workers?: number) => [{ suites: stale, command: 'node', args: ['scripts/with-source.mjs', 'npx', 'vitest', 'run', ...projectArgs(stale), ...workerArgs(workers), ...reporterArgs()] }],
  },
  pack: {
    half: 'fast' as Half,
    suites: () => UNIT_SUITES.filter((suite) => suite.kind === 'pack'),
    // `--` so npm forwards the reporter flags to vitest rather than reading them itself
    run: (stale: readonly UnitSuite[], workers?: number) => stale.map((suite) => ({ suites: [suite], command: 'npm', args: ['test', '-w', suite.workspace, '--', ...workerArgs(workers), ...reporterArgs()] })),
  },
  integration: {
    half: 'integration' as Half,
    suites: () => INTEGRATION_SUITES,
    // The root integration config declares the condition itself, and carries the worker cap that makes this
    // pool faster at half the cores than at all of them. Bail is a CLI option so Vitest forwards it to
    // each project; a root-only test.bail setting is not inherited by project configs.
    run: (stale: readonly UnitSuite[], workers?: number) => [{ suites: stale, command: 'npx', args: ['vitest', 'run', '--bail=1', '--config', CONFIG_BY_HALF.integration, ...projectArgs(stale), ...workerArgs(workers), ...reporterArgs()] }],
  },
  native: {
    half: 'native' as Half,
    suites: () => NATIVE_SUITES,
    // The same shape as integration, over the native half's root config
    run: (stale: readonly UnitSuite[], workers?: number) => [{ suites: stale, command: 'npx', args: ['vitest', 'run', '--bail=1', '--config', CONFIG_BY_HALF.native, ...projectArgs(stale), ...workerArgs(workers), ...reporterArgs()] }],
  },
} as const;

export type Pool = keyof typeof POOLS;

/** The pools by the chain step each one is, so a step name can be asked which pool it is */
const POOL_BY_STEP: ReadonlyMap<string, Pool> =
  new Map((Object.keys(POOLS) as Pool[]).map((pool) => [poolStepName(pool), pool]));

export const poolForStep = (step: string): Pool | undefined => POOL_BY_STEP.get(step);

/**
 * The command that runs a step's whole work on its own: what `npm run measure` should be handed for it, and
 * what a pool step's cache key names (`unitFor`, `chain-stamps.ts`).
 *
 * **A pool step cannot be named by its npm script.** All three keep a cache of their own — the reason they
 * declare `forceArgs: ['--all']` — so `npm run test:integration` a second time finds every project up to
 * date and returns in under a second, measuring nothing. So a pool names the vitest invocation underneath,
 * from `POOLS[pool].run` — the same declaration the pool itself runs, so the two cannot drift — minus the
 * durations reporter, which is bookkeeping rather than the work, and over the whole pool rather than the
 * suites one run found stale.
 *
 * Every other step runs its work unconditionally, so its npm script is the command.
 */
export function measureCommandFor(stepName: string, budget?: number): string {
  const pool = POOL_BY_STEP.get(stepName);
  if (pool === undefined) return `npm run ${stepName}`;
  const reporters = new Set(reporterArgs());
  return POOLS[pool].run(POOLS[pool].suites(), budget === undefined ? undefined : poolWorkerLimit(pool, budget))
    .map(({ command, args }) => {
      const kept = args.filter((arg) => !reporters.has(arg));
      // npm's `--` forwards the flags after it; with the reporters gone it forwards nothing and reads as a
      // typo in a line someone is about to run
      if (kept.at(-1) === '--') kept.pop();
      return [command, ...kept].join(' ');
    })
    // A pool that runs one invocation per suite costs all of them, so the remedy has to as well
    .join(' && ');
}

/**
 * Every stamp any pool would write, which is what makes the rest dead.
 *
 * Derived from `POOLS`, so a pool that loses a suite — or a key that changes shape, as it did when the half
 * joined it — leaves files nothing will ever read again. The chain prunes its own stamp directory for the same
 * reason (`pruneStamps`, `scripts/chain.ts`): a cache that only ever grows is one where a name collision with
 * something long gone is a silent pass.
 */
export const livePoolStamps = (): Set<string> => new Set(
  (Object.keys(POOLS) as Pool[]).flatMap((name) => POOLS[name].suites().flatMap((suite) =>
    PROVENANCES.map((provenance) => path.basename(poolStampFor(suite, POOLS[name].half, provenance))))),
);

/**
 * One run per pool, beside the stamps it writes.
 *
 * **Per pool rather than per directory**, which is narrower than *a stamp directory has one writer* and is
 * the right unit here: a stamp's name carries its pool's half and provenance, so two pools write disjoint
 * files, and `prunePoolStamps` derives `live` from *every* pool's keys so one pool's prune cannot remove
 * another's. Two runs of the **same** pool is the case that collides — same filenames, each stamping what the
 * other's vitest is still running.
 *
 * Not `.json`: `prunePoolStamps` removes every `.json` here that no pool would write, so a lock named that
 * way would be deleted by the next run while this one held it.
 */
export const poolLockFor = (pool: Pool): string => path.join(POOL_STAMP_DIR, `${pool}.lock`);

/** Takes a pool's lock, or throws naming the run that holds it */
export function holdPoolLock(pool: Pool, file = poolLockFor(pool)): ExclusiveLock {
  return holdExclusiveLock({
    file,
    what: `npm run ${poolStepName(pool)}`,
    refuse: (holder) => new Error(`another ${pool} pool run holds ${path.relative(process.cwd(), file)}: ${holder}\n`
      + "Both would stamp the projects the other is still running, so neither run's record would describe a\n"
      + 'run that happened. Wait for it to finish.\n'
      + `If none is running, delete ${path.relative(process.cwd(), file)} and try again.`),
  });
}

/** Drops the stamps no pool would write. Every pool knows every pool's keys, so any run may do it. */
export function prunePoolStamps(): void {
  if (!fs.existsSync(POOL_STAMP_DIR)) return;
  const live = livePoolStamps();
  for (const file of fs.readdirSync(POOL_STAMP_DIR)) {
    if (file.endsWith('.json') && !live.has(file)) fs.rmSync(path.join(POOL_STAMP_DIR, file));
  }
}

/**
 * A project as a build unit, so it goes through the same freshness check as everything else.
 *
 * **Keyed by pool, and the command is why.** A suite with an expensive half is two units over one input set,
 * and if they hashed the same preimage a stamp read under the wrong key would come out *fresh* — the
 * expensive half skipped on the fast half's record. `unitStaleReason` consults nothing but the
 * fingerprint, by design, since it recomputes its own side: the only place an identity can live is the
 * preimage, which is what `BuildUnit.command` is for.
 *
 * Pool rather than half, because `host` and `pack` are both the fast half and run differently. The text is what
 * it would take to run *this* suite alone in this pool, taken from the pool's own `run` so that nothing
 * restates how a pool runs: it does not vary with which other suites a given run found stale.
 *
 * So **a suite that moves pools re-runs**, being run a different way — where the stamp's path, keyed by the
 * half, would have called that the same record. Undo this and the two halves share one preimage again.
 *
 * **The provenance is in the preimage for the same reason**, and it is what keeps a lone pass out of the
 * chain's answer: the two runs hash differently, so the chain never reads a suite that passed by itself as
 * fresh, and a person's own loop goes on skipping what it has already run. Putting it only in the path
 * would not do it — `unitStaleReason` consults the fingerprint and nothing else, so a record found under
 * one name with the other's preimage comes back *fresh*, which is the defect the half was added to fix.
 */
export const poolUnitFor = (suite: UnitSuite, pool: Pool, provenance: Provenance, workers?: number): BuildUnit => ({
  inputs: suiteInputs(suite, POOLS[pool].half).map((input) => path.join(REPO_ROOT, input)),
  outputs: [],
  command: `${POOLS[pool].run([suite], workers).map(({ command, args }) => [command, ...args].join(' ')).join(' && ')} [${provenance}]`,
});

/**
 * The projects a run was asked for and did not report.
 *
 * **A `--project` filter that matches nothing is silently dropped**, as long as one other filter matched:
 * measured, `--project @apackdev/ears --project @apackdev/no-such-project` runs ears, ignores the second and
 * exits 0 with no warning. Only a filter matching *nothing at all* is an error. So a suite whose workspace
 * stopped matching its vitest project name would be stamped as having passed a run it was excluded from,
 * and would then stay cached — "recorded fresh having never run", through a different door.
 *
 * Checked rather than adapted to. Stamping only what reported would make the run "correct" while quietly
 * testing less, which is the failure being prevented, just smaller.
 *
 * **It reads the reporter's account, not the console.** Vitest prints project labels in two spellings and
 * only for a multi-project run, and a project that ran *zero files* appears in no output at all; the
 * reporter names every project the run started (`onTestRunStart`).
 */
export function projectsThatDidNotRun(asked: readonly string[], run: ReportedRun): string[] {
  const reported = new Set(run.projects);
  return asked.filter((project) => !reported.has(project));
}

/**
 * The one line a half gets when its slowest files stand apart from the rest of it.
 *
 * After the weight and the bound, before the ranking: it is a verdict *about* the ranking, so it reads as
 * one once the reader knows how heavy the half is. Silent where nothing stands out, which is every half in
 * this repo today — `outlierIn` carries what the thresholds are and what they were measured against.
 */
const outlierLines = (rows: readonly FileDuration[], half: Half, width: number, whole: boolean): string[] => {
  // **Only over a half this run measured whole.** "Out of line with its half" is unanswerable from part of
  // one: a pool runs the projects whose inputs moved, and a run covering a single suite's integration half
  // read 23.2s over 9.1s — 2.54x, and an artefact of the population rather than a file worth splitting.
  // Derived from which suites reported rather than a minimum file count, which would be a declared
  // population floor standing in for the question actually being asked.
  if (!whole) return [];
  const found = outlierIn(rows, half);
  if (found === undefined) return [];
  const named = found.above.map((row) => `${row.dir}/${row.file}`).join(', ');
  const sizes = found.above.map((row) => asDuration(row.ms)).join(' + ');
  return [`${`${found.ratio.toFixed(1)}x`.padStart(width)}  ${named} at ${sizes} against `
    + `${asDuration(found.belowMs)} — out of line with its half, so a candidate for splitting`];
};

/**
 * The part of a pool step nobody's figures account for.
 *
 * **`max(floor, work/cores)` is a lower bound and the run is reliably above it**, which is the thing two
 * numbers side by side cannot show. Measured 2026-10-06 on the integration half: a 31.2s floor and a 27.0s
 * `work/cores` under a ~50s wall, so nineteen seconds belonged to neither — and acting on the pair as
 * though it predicted the wall is what split that half's largest file for no gain. Printing the remainder
 * turns that from an inference a reader has to avoid into a number they can see, and gives anyone
 * attacking contention a figure that moves.
 *
 * Both readings here come from inside the pool, so the gap is scheduling and contention together: workers
 * waiting on each other, and the step's own start-up. Nothing in this subsystem measures either, which is
 * what the line says rather than implies.
 */
const unaccountedLines = (bound: { floorMs: number; perCoreMs: number; binds: string },
  width: number, wallMs: number | undefined): string[] => {
  // No bound to subtract from where overhead was never recorded, and nothing to say about a step whose
  // wall this caller did not measure — a spec reading the cache is the case for the second
  if (wallMs === undefined || bound.binds === 'unknown') return [];
  const lower = Math.max(bound.floorMs, bound.perCoreMs);
  const gap = wallMs - lower;
  if (gap <= 0) return [];
  return [`${asDuration(gap).padStart(width)}  of the step's ${asDuration(wallMs)} is neither figure`
    + ' — contention and start-up, which nothing here measures'];
};

/**
 * What a run says about its own `@slow:` markers, for whoever reports on a run that passed.
 *
 * **The reported half of the gate was computed and never printed.** `placementOf`'s `unmarked` list is a
 * report rather than a failure — load can push a file into a tail and never out of one — and the only
 * thing that printed it was the pool's own stdout, which both callers buffer and show only when a step
 * fails. So the direction deliberately left as a report was visible only when something else broke, which
 * is the one shape a partial result must not take: silent.
 *
 * **The files are named rather than counted**, because the ranking below cannot stand in for them. That is
 * ordered by cost and this list by test time (`slowestFiles`, the quantity the bar is taken over), so an
 * unmarked file in the tail need not be among the five rows a reader can see.
 *
 * Gated on a whole half exactly as `outlierLines` is, and for the same reason — the bar is this run's own
 * p90, so a partial run's is taken over whichever projects happened to be stale. Where it cannot speak it
 * says why, rather than leaving the half with no line.
 */
const placementLines = (rows: readonly FileDuration[], marked: ReadonlyMap<string, Map<string, string>>,
  half: Half, width: number, measured: number, all: number): string[] => {
  const placement = placementOf(rows, marked, { whole: measured === all });
  const unmarked = placement.unmarked.filter((row) => row.half === half);
  const unchecked = placement.unplaceable.find((one) => one.half === half);
  const lines: string[] = [];
  if (unmarked.length > 0) {
    const named = unmarked.map((row) => `${row.dir}/${row.file}`).join(', ');
    lines.push(`${String(unmarked.length).padStart(width)}  in the slow tail and unmarked: ${named}`
      + ` — ${UNMARKED_NOTE}`);
  }
  if (unchecked !== undefined) {
    lines.push(`${'—'.padStart(width)}  no @slow: marker checked here — `
      + uncheckedNote(unchecked.why, { files: unchecked.files, covered: measured, all }));
  }
  return lines;
};

/**
 * How many of this pool's `@slow:` markers guard a spec that could not move anyway.
 *
 * The gate's whole subject is whether a spec belongs in the other half, and `hasSplit` already records
 * what makes that available: *"a package with one config has nowhere to move a spec to."* Nothing counted
 * the markers against it, and the count is the finding — **eleven of the fourteen are in such a package**,
 * so for those the remedy the gate points at costs a new vitest config and a root project entry rather
 * than a rename. The three in `@apackdev/cli` have both halves and so could move today.
 *
 * That is what this line is for: the gap between the markers that could act on this evidence and the ones
 * that could not — how much of the gate's population is reachable, which is what a reader of a passing run
 * sees here.
 *
 * Silent at zero, so the output stops mentioning it the moment a package gains a second half or a marker
 * lands in one of the three that already have one.
 */
const markerReachLines = (marked: ReadonlyMap<string, Map<string, string>>, width: number, root: string): string[] => {
  const dirs = [...marked].flatMap(([dir, files]) => [...files.keys()].map(() => dir));
  const stuck = dirs.filter((dir) => !hasSplit(path.join(root, 'packages', dir)));
  if (stuck.length === 0) return [];
  return [`${String(stuck.length).padStart(width)}  of ${dirs.length} @slow: marker(s) sit in a package with`
    + ' no second half, so no spec they guard can move without a new vitest config'];
};

/**
 * What a finished pool run measured, as lines for whoever reports on it.
 *
 * Here rather than in either caller because both need it and neither performed the run: `scripts/chain.ts`
 * and `scripts/test-unit.ts` each spawn a pool and buffer its output, printing it only on failure — so
 * until this existed the ranking the pool printed reached nobody running `npm run chain` or
 * `npm run test:unit`, which are the two commands anyone runs. It reads what the run *wrote* rather than
 * parsing what it printed, so there is nothing to keep in step with vitest.
 *
 * The half's total comes first because it is the number a ranking cannot give: measured 2026-10-05, the
 * five slowest files hold 46% of `repo-checks`' fast half and 97% of `apack-sdk`'s, and the shape no
 * top-five can show at all is many files each creeping a little — 349 of 388 fast-half files are under
 * 500ms and total 24.1s between them.
 *
 * **The root and the core count come from the caller**, defaulting to this repo and this box. Not for
 * flexibility — nothing passes anything else in production. It is what makes the lines below assertable:
 * a spec plants a cache under a temp root, names a core count, and reads back every line, which is
 * otherwise impossible for the most-read output in this subsystem. The partial-run guard in particular
 * rested on one hand-run check before this.
 *
 * **Only what the run being reported on actually measured**, which `since` is for. A pool runs the projects
 * whose inputs moved, so a step can run, find none of them stale and measure nothing — and a chain step in
 * exactly that state was observed returning in 0.8s and printing 17.3s of file time over 100 files that a
 * direct run minutes earlier had measured. True of the machine, and not of that step. A record older than
 * `since` is left out, so a partial run reports its own subset and a run that measured nothing reports
 * nothing.
 */
export function poolDurationLines(pool: Pool, width: number, since: Date,
  { root = REPO_ROOT, workers = coresFor(poolStepName(pool)), wallMs }:
    { root?: string; workers?: number; wallMs?: number } = {}): string[] {
  const { half, suites } = POOLS[pool];
  const covered = suites();
  const rows = cachedDurations(root, covered, half, since);
  if (rows.length === 0) return [];
  const total = halfTotal(rows, half);
  // **The pool's own worker count, not the machine's cores.** `work/cores` is about how many of this half's
  // files run at once, which is what the scheduler admits the step on (`coresFor`, `POOL_WIDTH`) — and the
  // integration pool declares half the box, so handing it `availableParallelism()` understated its work by
  // 2x and the gap line below reported 47% of that step's wall as unexplained. It was this.
  const bound = halfBound(rows, half, workers);
  /** Which of the pool's suites this run actually measured, which is what says whether a half is whole */
  const measured = new Set(rows.map((row) => row.dir));
  const marked = new Map(covered.map((suite) => [suite.dir, markedSpecs(path.join(root, 'packages', suite.dir))]));
  const windows = new Map(covered.map((suite) => [suite.dir, readDurationRuns(root, suite.dir, half)]));
  return [
    `${asDuration(total.ms).padStart(width)}  ${half} half, ${total.files} file(s) this run measured`
      + `, ${asDuration(total.overheadMs)} of import and setup around them`,
    // Which of the two can bound the run, because a floor under `work/cores` cannot — and reading it the
    // other way is what split a 96-case file for no gain. `halfBound` carries that story.
    bound.binds === 'unknown'
      // No verdict rather than the wrong one: without overhead the work is understated, so the floor looks
      // binding when it is not — which is the reading that split a 96-case file for nothing
      ? `${asDuration(bound.perCoreMs).padStart(width)}  work/cores over a ${asDuration(bound.floorMs)} floor`
        + ` — which binds is unknown: ${bound.unmeasured} file(s) predate overhead, so re-run the pool`
      // The clause is on the line because the verdict alone reads as a prediction, and acting on one that
      // way is what split the integration half's largest file for no wall-clock gain — both figures are
      // measured inside the pool, so they compare soundly with each other and with nothing else.
      // `halfBound` carries the measurement; this is the half of it a reader of the output needs.
      : `${asDuration(bound.perCoreMs).padStart(width)}  work/cores against a ${asDuration(bound.floorMs)} floor`
        + ` — ${bound.binds}-bound: the larger of the two, which is not a prediction of the wall`,
    ...unaccountedLines(bound, width, wallMs),
    ...outlierLines(rows, half, width, measured.size === covered.length),
    ...placementLines(rows, marked, half, width, measured.size, covered.length),
    ...markerReachLines(marked, width, root),
    // Costliest, not slowest: the two lines above judge a file by what it cost, and a ranking by test time
    // beside them could omit the very file the outlier line names
    ...costliestFiles(rows, half).map((row) => {
      const reason = marked.get(row.dir)?.get(row.file);
      // The window's oldest reading beside the newest, which is the only thing the history is printed for
      const trend = trendIn(windows.get(row.dir), row.file);
      const moved = trend === undefined ? '' : `  (was ${asDuration(trend.was)} over ${trend.runs} runs)`;
      // The cost, with the test time beside it where overhead is the larger part — otherwise a reader
      // comparing this column to the half's total is comparing two different quantities
      const cost = costOf(row);
      return `${asDuration(cost).padStart(width)}  ${row.dir}/${row.file}`
        + `${cost - row.ms > row.ms ? `, ${asDuration(row.ms)} of it tests` : ''}${moved}`
        + `${reason === undefined ? '' : `  @slow: ${reason}`}`;
    }),
  ];
}

/**
 * Why one project is about to run, given what its stamp was read as and what a diff of its inputs would say.
 *
 * A pool exists to run a subset, so every non-empty run makes a claim about which projects moved — and
 * `npm run chain -- --dry` cannot settle it, because it reports on the *step*, a different unit with a
 * different input set. It can say what moved under `test:unit:host` while being unable to say which of the
 * eleven projects inside it that was.
 *
 * Pure, over a read and a thunk, so the answers can be checked without a stamp on disk — and `??`
 * short-circuits, so the diff is never computed for a stamp that may not be diffed. It takes the *read* rather
 * than the record because that is what makes the two inseparable: the caller cannot reach the fields a diff
 * needs without having been told whether they are readable. Narrowing for itself, a caller could print a
 * file name beside a reason saying the stamp could not be read at all.
 */
export const whyItRuns = (read: ReturnType<typeof diffableStamp>, moved: () => string): string =>
  read.undiffable ?? (moved() || 'its inputs changed');
