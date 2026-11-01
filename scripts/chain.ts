// The pre-merge chain: every check, in order, with per-step timings.
//
//   npm run chain
//
// It exists for the timings and the failure output, not for speed. Each step's output is buffered and
// printed only if it fails, so a failure is not buried under six passing suites, and the summary says
// where the time went — which otherwise has to be reconstructed from log file mtimes.
//
// Every step's output is also **kept**, in this run's own directory (`lib/chain-evidence.ts`), which is what
// makes the printing a convenience rather than the only copy. A run whose output was piped away, or read in
// a terminal that has since scrolled, is still answerable afterwards.
//
// HOW MUCH OF THE MACHINE IT TAKES, AND WHY THAT IS A BUDGET
//
// The steps are parallelisable and the hard part was never the ordering: after `packages:ensure` and
// `build`, nothing writes what another step reads, each app launch takes its own port (`getPort` in main's
// `ApiServer`) and its own data dir (`mkdtemp` in `@apackdev/testing`), and `ensurePackagesBuilt` returns
// before taking the build lock when nothing is stale. One step did not admit to its shared state —
// `test:packaged-authoring` runs `npm run packages:build` first (`tests/scripts/test-packaged-authoring.sh`)
// and so rewrites the `dist/` every other step reads — and `APACK_PACKAGES_PREBUILT=1` reports that now
// rather than racing it.
//
// **The constraint is cores.** Measured 2026-09-24 over seven steps, three at a time cut wall time from
// 348s to 168s by doing 268s of work, and a variant that took the whole machine for one step did 567s of
// it: `@apackdev/cli` went from 56s to 118s and began reporting errors it does not report alone. Spending
// the machine is the whole question, and both runs spent more of it than it had.
//
// **So the unit is cores, not steps**, which took two corrections to see. The first premise was "every step
// already uses all the cores"; `typecheck` was sixteen single-threaded compilers chained with `&&`, holding
// one core for half a minute while nine sat idle, and running its legs at once took it from 29.3s to 10.8s.
// Each leg is its own step now. The second was that a count of steps could meter them at all: nineteen
// steps are one `tsc` and two are a nine-worker vitest pool, so one number ran 3 of 10 cores through the
// typecheck phase and 18 workers on 10 through the test phase. A step declares what it takes
// (`core-budget.ts`), the scheduler admits on the sum, and that is a measured 169.4s against 202.8s with
// half the spread — `budgetFrom` below carries the numbers.
//
// What is left is the floor, and it is not a scheduling problem: the critical path is most of the run, so
// the way to a shorter chain is a cheaper step.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { changedInputs, diffableStamp, firstChange, freshnessSweep, INPUTS_CHANGED, PACKAGES_PREBUILT_ENV, REPO_ROOT, stampedRun, stampRecord, unitStaleReason } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, type ChainStep, chainSteps, keptOnFailure, needsApp, orderedSteps, STEP_TABLES } from './lib/chain-steps.ts';
import { stampFor, STAMP_DIR, unitFor } from './lib/chain-stamps.ts';
import { evidenceLine, openRunEvidence, pruneRunEvidence, type RunEvidence } from './lib/chain-evidence.ts';
import { CHAIN_FLAGS, chainHelp } from './lib/chain-flags.ts';
import { CHAIN_WAIT_MS, ChainLockHeld, chainInvocation, holdChainLock } from './lib/chain-lock.ts';
import type { ExclusiveLock } from '@apackdev/host/exclusive-lock';
import { timeoutMsFor, timedOutBecause, type TimeoutClass } from './lib/step-timeouts.ts';
import { box } from './lib/core-budget.ts';
import { compilerTestsRunHere } from '@apackdev/host/build/compiler-test-host';
import { readStepSeconds, recordStepDurations, withRecordedSeconds } from './lib/step-durations.ts';
import { asCount, parseFlags } from './lib/measure.ts';
import { schedule } from './lib/chain-schedule.ts';
import { measurementsFrom, willNotCache } from './lib/step-timing.ts';
import { briefly, criticalPathLine, pathSavingsLine, cores, declaredAt, dim, DRY_REASON_COLUMN, howLong, identicalRewrites, marker, movedWhileItRan, oneLine, REASON_COLUMN, staleLines, STEP_NAME_WIDTH, TIME_COLUMN, voidedLine, whenChanged, wrapAt, writerOf } from './lib/chain-output.ts';
import { slowestTests } from './lib/slow-tests.ts';
import { overBudgetLines } from './lib/over-budget.ts';
import { CHAIN_RUN_ENV, CHAIN_CORES_ENV, poolWorkerLimit, poolForStep, poolDurationLines } from './lib/unit-pool.ts';
import { parseShard, selectOnly, shardArg, STRICT_JOBS, strictJobSteps, type Shard, type StrictJob } from './lib/chain-only.ts';
import { TYPECHECK_LEGS } from './lib/typecheck-legs.ts';
import { exitOnEpipe } from './lib/exit-on-epipe.ts';

exitOnEpipe();

import { boundedSpawn } from './lib/bounded-spawn.ts';

/**
 * Each step is cached on its own declared inputs, through the same protocol the package builds use:
 * `fingerprintUnit` over `ChainStep.inputs`, `unitStaleReason` to decide, `stampedRun` to record. One
 * protocol, one fingerprint, one reader — which is why the chain's stamps live beside the
 * builds' rather than inventing a second format.
 *
 * This replaces a whole-tree fingerprint, which skipped the chain only when nothing tracked had changed at
 * all. The argument for that was that every expensive step transitively reads nearly the whole repo, and
 * for the steps that need the app it is still true: they read it, so a change anywhere in it re-runs them.
 * What it missed is that most of the chain needs no app. The eight unit suites read their own package and
 * its dependencies' source, so a one-package edit re-runs one suite; a doc edit re-runs nothing.
 *
 * There is no cascade rule, and there does not need to be one. A step that produces something declares it
 * in `outputs`, and the steps that read it declare those same paths in their `inputs`, so a rebuild that
 * changed the output changes the dependents' fingerprints — and a rebuild that produced identical bytes
 * leaves them fresh, which is the right answer and one a "needed step ran" rule would get wrong.
 */
/**
 * A pool step's own ranking, in the step's time column beside its slow tests.
 *
 * Empty for every other step, and for a pool step this run skipped — `poolDurationLines` has why.
 */
const poolLines = (name: string, ms: number, budget: number): string[] => {
  const pool = poolForStep(name);
  if (pool === undefined) return [];
  // When the step started, so records a previous run wrote are left out rather than printed as this one's
  const measured = poolDurationLines(pool, 6, new Date(Date.now() - ms), { wallMs: ms, workers: poolWorkerLimit(pool, budget) });
  if (measured.length > 0) return measured;
  // **A pool step that ran and measured nothing is the one line that otherwise reads as a mystery**: `ok`
  // in 0.7s with no ranking under it, for a step whose reason says its inputs changed. The step did its
  // job — it asked the pool, and the pool found every project already current against its own records — but
  // nothing on screen said which of those two things happened. The pool says it in output the chain buffers
  // and prints only on failure, so this is where it has to be said.
  return [`${''.padStart(6)}  nothing measured — every project was already fresh`];
};


/**
 * Where a run points when it says a step is never cached: the sentence is there, the argument above it.
 *
 * Both tables, because a step is declared in either — this searched only `chain-steps.ts` and so could not
 * locate the seventeen typecheck legs or the two generated pool steps. Read once, at module load, rather
 * than per row.
 */
const stepTables = STEP_TABLES.map((file) => ({ file, source: fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8') }));
const declaredIn = (name: string): string | undefined => {
  for (const { file, source } of stepTables) {
    const line = declaredAt(source, name);
    if (line !== undefined) return `${file}:${line}`;
  }
  return undefined;
};

/**
 * Drop stamps for steps that no longer exist, and for steps that are not cached.
 *
 * A stamp is a record *about* a step, so one whose step has gone is a record with no subject — and this
 * chain found a real one: `typecheck.json` outlived the step by the time it became eighteen. Harmless on
 * its own, and exactly the shape the rest of this work removes, which is reason enough not to keep it.
 *
 * The uncached case is the one that would be a bug rather than litter. A step declaring
 * `neverCachedBecause` must never be skipped on a stamp, and `runAndStamp` returns before `stampedRun`
 * for one — so a stamp for such a step means that branch stopped holding. Clearing it here keeps the
 * store true to the table; `chain-stamps.spec.ts` is what fails if the branch breaks.
 */
function pruneStamps(): void {
  if (!fs.existsSync(STAMP_DIR)) return;
  const live = new Map(CHAIN_STEPS.map((step) => [path.basename(stampFor(step.name)), step]));
  for (const file of fs.readdirSync(STAMP_DIR)) {
    if (!file.endsWith('.json')) continue;
    const step = live.get(file);
    if (step === undefined || step.neverCachedBecause !== undefined) fs.rmSync(path.join(STAMP_DIR, file));
  }
}

/** What a finished step may have changed: its products */
const wrote = (step: ChainStep): string[] =>
  (step.outputs ?? []).map((target) => path.join(REPO_ROOT, target));

type Result = { step: string; ms: number; code: number; output: string; timedOut?: true; stalled?: true };

/**
 * What moved under a step's inputs since its last successful run, against that run's own stamp.
 *
 * Everything here is the stamp's: the per-file digests it recorded, the declared set it recorded, and the two
 * timestamps bracketing the run. So the files named are exactly the ones the verdict is about — the previous
 * version walked mtimes instead and named a file a test rewrites with identical bytes, which sent a diagnosis
 * after the wrong thing. mtime is still read, but only to place a change the digests already found.
 *
 * Asked only of a step already known to be stale, so its walk and its stats are paid on the runs with
 * something to report — and over the same sweep that reached the verdict, so the digests are already read rather
 * than walked a second time.
 */
function whatMoved(
  step: ChainStep,
  steps: readonly ChainStep[],
  asking: { changedInputs: typeof changedInputs },
  budget: number,
): Omit<Parameters<typeof staleLines>[0], 'name' | 'nameWidth' | 'reason'> {
  const nothing = { gained: [], lost: [], files: [], identical: [] };
  // An undiffable stamp is required of the types and unreachable from here, which is worth saying rather than
  // leaving as a fallback someone trusts: this is asked only of a step that *passed* in this run, and a step
  // that passed rewrote its own stamp a moment ago with every field in it. The state it stands for — a stamp
  // from before the digests were recorded, or one in a shape its reader refuses — is reachable only by whoever
  // asks about a run they did not just watch, which is `--dry`, the question "why would this run?". That is
  // where naming the files would pay next, and it would make this branch live.
  const { stamp: record, undiffable } = diffableStamp(stampRecord(stampFor(step.name)));
  if (record === undefined) return { ...nothing, undiffable };
  const changes = asking.changedInputs(unitFor(step, budget), record);
  const at = (file: string) => {
    try {
      return fs.statSync(path.join(REPO_ROOT, file)).mtimeMs;
    } catch {
      return undefined; // gone between the diff and this stat, which the diff already called removed
    }
  };
  const asOf = (field: string | undefined) => (field === undefined ? undefined : Date.parse(field));
  const [from, until] = [asOf(record.takenAt), asOf(record.builtAt)];
  const files = ([
    ...changes.changed.map((file) => ({ file, how: 'changed' as const })),
    ...changes.added.map((file) => ({ file, how: 'added' as const })),
    ...changes.removed.map((file) => ({ file, how: 'removed' as const })),
  ]).map((found) => ({ ...found, when: whenChanged(at(found.file), from, until), writer: writerOf(found.file, steps) }))
    // What ran beside this step comes first: it is the case with an ordering to fix, where a change since the
    // run is usually the edit you just made
    .sort((a, b) => Number(a.when !== 'while it ran') - Number(b.when !== 'while it ran'));
  const identical = identicalRewrites({
    recorded: Object.keys(record.files),
    differing: new Set(files.map((found) => found.file)),
    mtimeOf: at,
    from,
    until,
  });
  // `undefined` rather than omitted: the field is required so that a caller which has read the stamp says so
  return { gained: changes.gained, lost: changes.lost, files, identical, undiffable: undefined };
}

/**
 * A step, under a budget sized from what it costs healthy. An overrun kills its whole process group.
 *
 * `force` carries the step's `forceArgs` when the chain was given `--all`. A step that keeps a cache of its
 * own cannot see this chain's override, so without them `--all` runs the step and the step skips its work:
 * the two unit pools did exactly that. Only steps that declare them get any, because most steps' commands
 * would reject an argument they do not know.
 */
async function run(step: string, timeout: TimeoutClass, force: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): Promise<Result> {
  const args = ['run', step];
  // npm forwards what follows `--` to the script's own command, which is how this chain was given `--all`
  const direct = force.length === 0 ? args : [...args, '--', ...force];
  // A step whose suites cannot run on this Mac runs the same npm command in the Linux test container
  const withForce = inLinuxContainer(step) ? ['run', 'test:linux', '--', 'npm', ...direct] : direct;
  // Explicit feedback limits may shorten the declared work class's ceiling. A step in the container does its
  // work in the VM, where its process tree here cannot see it, so only the ceiling bounds it.
  const { code, output, ms, timedOut, stalled } = await boundedSpawn('npm', withForce, timeoutMsFor(timeout),
    { env, ...(withForce === direct ? {} : { idleMs: false as const }) });
  const result = { step, ms, code, output, timedOut, stalled };
  // Here rather than where a step's result is read, because this is the one place a step's bytes exist and
  // every caller passes through it. Written as the step ends, so a run that is interrupted keeps what finished.
  evidence?.keep(step, result);
  return result;
}

/** Whether this machine runs `step` in the Linux test container rather than directly (`ChainStep.linuxOnMac`) */
const inLinuxContainer = (step: string): boolean =>
  CHAIN_STEPS.find((candidate) => candidate.name === step)?.linuxOnMac === true && !compilerTestsRunHere();

/**
 * Where this run's per-step output goes, assigned once `main` holds the lock.
 *
 * One binding rather than a parameter threaded through `run` and `runAndStamp`: neither decides anything
 * about it, and a parameter on both would be two signatures carrying a thing they only pass on. Being
 * `undefined` until then is also what keeps `--dry` writing nothing — by construction, since a dry plan
 * returns before this is set, rather than by a branch somebody has to remember.
 */
let evidence: RunEvidence | undefined;


const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;


/**
 * The environment a step runs in: every step but `packages:ensure` is told the packages are already built.
 *
 * It is, and the graph is why — all 27 others are transitively ordered after it, which `chain-graph.spec.ts`
 * asserts, so none of them can be the process that still has building to do. Under the flag a package found
 * stale is reported (`PackagesWentStale`, naming what moved and what usually moves it) instead of rebuilt,
 * because rebuilding it would race whatever is writing it and fail about the race.
 *
 * `packages:ensure` is excluded because it is that writer: with the flag it would refuse the one job it has.
 */
/**
 * What a step is spawned with. `CHAIN_RUN_ENV` on every one of them, because a step that caches inside
 * itself has to know whose run this is: a pool's per-project stamps record a pass under the chain's
 * concurrency separately from one established alone, and the chain is the only thing that can say which
 * this is.
 */
const envFor = (step: ChainStep, budget: number): NodeJS.ProcessEnv => ({
  ...process.env,
  [CHAIN_RUN_ENV]: '1',
  [CHAIN_CORES_ENV]: String(budget),
  ...(step.name === 'packages:ensure' ? {} : { [PACKAGES_PREBUILT_ENV]: '1' }),
});


/** Thrown to leave `stampedRun` without a stamp: a failed step must read as never run */
class StepFailed extends Error {
  constructor(readonly result: Result) { super(result.step); }
}

/**
 * The step, with its stamp written only where it passed. The fingerprint is taken before it runs, so a
 * source edited mid-run records as not done rather than as covered.
 */
async function runAndStamp(step: ChainStep, all: boolean, budget: number, extra: readonly string[] = []): Promise<Result> {
  const force = [...all ? step.forceArgs ?? [] : [], ...extra];
  // A shard of a step passed part of it, which is not the step: it records nothing, as the pool beneath it does
  if (step.neverCachedBecause !== undefined || extra.length > 0) return run(step.name, step.timeout, force, envFor(step, budget));
  let result: Result | undefined;
  try {
    await stampedRun(step.name, unitFor(step, budget), stampFor(step.name), async () => {
      result = await run(step.name, step.timeout, force, envFor(step, budget));
      if (result.code !== 0) throw new StepFailed(result);
    });
  } catch (err) {
    if (!(err instanceof StepFailed)) throw err;
    return err.result;
  }
  return result!;
}


/**
 * How much of the machine a run may take, in cores. The default is what this machine has.
 *
 * **Measured 2026-10-02, `--all` runs interleaved in pairs on an idle 10-core box, three each:**
 *
 *     3 lanes     202.8s  210.7s  176.6s    median 202.8s, spread 34.1s
 *     10 cores    169.4s  178.3s  163.0s    median 169.4s, spread 15.3s
 *
 * The budget won every pair, by a median of 32.4s, and halved the spread — the half the typecheck
 * flattening bought as well (18s to 0.7s there, for a median that did not move). The budgeted run landed
 * 9s off its own measured critical path, so little scheduling slack is left in it.
 *
 * **What a count of steps could not ask.** Nineteen of these steps are one `tsc` and two are a nine-worker
 * vitest pool, so one number metering both ran 3 of 10 cores through the typecheck phase and 18 workers on
 * 10 through the test phase. `--lanes` is gone rather than kept beside this: its one remaining job was
 * `--lanes 1`, and `--cores 1` is already serial, the budget being soft enough to admit the first ready
 * step and nothing beside it.
 *
 * A simulation over the declared `seconds` put the lanes at 201s and the budget at 198s — right about the
 * old default and pessimistic about the new one by 29s, because it charges every step the cost it was
 * measured at under three lanes, which is the contention a budget removes. Worth knowing before trusting
 * the next such simulation in either direction.
 *
 * Defaulting to this machine's cores means a smaller box gets its own budget rather than this one's, and
 * that much is untested: on four cores the two unit pools nearly serialise, and whether that beats the
 * oversubscription a step count produced there has not been measured anywhere.
 *
 * **`--cores N` is a cap on what to spend of *this* box, not a pretend box of N.** Each step's width is
 * resolved against the machine (`coresFor` reads `box()`), so the flag moves the budget and leaves the
 * widths alone. That is what makes `--cores 12` on ten cores a deliberate-oversubscription measurement
 * rather than a simulation of twelve, and `--cores 4` a cap a nine-core pool cannot fit inside, so it runs
 * alone. Resolving the widths against the flag instead was proposed and declined: it would turn the flag
 * into a simulation nothing can validate on the box it runs on, and the oversubscription it permits is
 * already what the soft budget allows a single step. What the divergence does cost is the schedule's
 * identity: a reading under `--cores 4` describes a different schedule from one under the default.
 */
const budgetFrom = (cores: string | undefined): number => asCount(cores, 'cores') ?? box();

async function main(): Promise<void> {
  const started = Date.now();
  const results: Result[] = [];
  // One parse for every flag, which is what makes a typo an error: `process.argv.includes` accepted
  // anything and reported nothing, so `--lanez 3` ran a whole chain having ignored what it was told.
  //
  // **The chain takes no positionals, and refusing them catches npm's `--`.** `npm run chain --dry` does
  // not pass `--dry` through — npm keeps it — so that form runs the whole chain, which is what the guide
  // documented in two places. `npm run chain --dry --cores 10` is worse: npm keeps both flags and hands
  // this a bare `10`, and before this clause it ran a full chain over a stray argument in silence.
  const args = parseFlags(process.argv.slice(2), CHAIN_FLAGS);
  if (args.flags.has('help')) {
    console.log(chainHelp());
    return;
  }
  if (args.positionals.length > 0) {
    throw new Error(`The chain takes flags only, not ${args.positionals.join(' ')}`
      + ' — npm keeps a flag you did not put after `--`, so write `npm run chain -- --dry`');
  }
  const all = args.flags.has('all');
  // What the chain would do, without doing it. The answer is a pure function of the tree, so it is the way
  // to check the cache on a machine too loaded to time a run on — and the way to find out why a step you
  // expected to be cached is not. It reports each step against the tree as it stands, so the verdicts after
  // the first step that would run are what that step would produce nothing for: a plan, not a prediction.
  const dry = args.flags.has('dry');
  // The E2E suite is a harness for driving the app rather than a gate, so it runs when asked for
  const e2e = args.flags.has('e2e');
  // The native half is the longest step and rarely what an edit touches; leaving it out is said on the result
  const noNative = args.flags.has('no-native');
  // A step whose inputs moved while it ran verified nothing, which is always reported; this decides whether
  // the chain fails on it. Opt-in because the honest answer can be a long list — `api:check` rebuilding
  // `@apackdev/testing` mid-chain once left twenty passed steps stale, every one of them correctly named
  const strict = args.flags.has('strict');
  // Part of the chain in one job (`chain-only.ts`): the steps named, with their producers' outputs required
  // to be current here already, and for pool steps one shard of their specs
  // Refusals rather than failures, printed as the lock's is: a throw would read as the chain itself failing
  const refuse = (message: string): void => { console.error(`\n${message}`); process.exitCode = 1; };
  // Several jobs run as one when the runners are fewer than the jobs: `--job app,rest`
  const jobs = args.values.job?.split(',').map((name) => name.trim()).filter((name) => name !== '');
  const unknownJob = jobs?.find((name) => !(STRICT_JOBS as readonly string[]).includes(name));
  if (unknownJob !== undefined) return refuse(`--job takes ${STRICT_JOBS.join(', ')} or a comma list of them, not '${unknownJob}'`);
  if (jobs !== undefined && args.values.only !== undefined) return refuse('--job and --only both choose the steps; give one');
  let only = args.values.only?.split(',').map((name) => name.trim()).filter((name) => name !== '');
  let shard: Shard | undefined;
  try { shard = args.values.shard === undefined ? undefined : parseShard(args.values.shard); }
  catch (err) { return refuse((err as Error).message); }
  const shardArgs = shard === undefined ? [] : [shardArg(shard)];
  let cached = 0;

  // Derived from each step's `needs`, and validated first: an unknown dependency or a cycle fails here rather
  // than halfway through a six-minute run
  let steps = orderedSteps(chainSteps(e2e ? ['test:e2e'] : []));
  if (noNative) {
    const dependent = steps.find((step) => step.dependsOn.includes('test:native'));
    if (dependent !== undefined) return refuse(`--no-native would leave out what ${dependent.name} reads`);
    steps = steps.filter((step) => step.name !== 'test:native');
    console.log(dim('test:native not run: --no-native'));
  }
  const budget = budgetFrom(args.values.cores);
  if (jobs !== undefined) {
    const chosen = new Set(jobs.flatMap((name) => strictJobSteps(steps, name as StrictJob, TYPECHECK_LEGS.map((leg) => leg.name),
      (step) => steps.some((candidate) => candidate.name === step && needsApp(candidate)))));
    only = steps.map((step) => step.name).filter((name) => chosen.has(name));
  }
  if (shard !== undefined && (only === undefined || only.some((name) => poolForStep(name) === undefined))) {
    return refuse('--shard splits a pool\'s specs, so it needs --only or --job naming pool steps and nothing else');
  }

  /** Its verdict, asked at dispatch — see `dispatch` for why that timing is load-bearing */
  /**
   * Why a step would run. `asking` is how it reads the tree: the default reads per step, and a sweep reads once
   * for all of them.
   *
   * **Every caller shares one, and the derived graph is what makes that sound.** A reader of a step's output
   * is ordered after it by construction, so a sweep — which reads lazily — never holds bytes a later step
   * overwrites. That property was hand-maintained when `needs` was written beside the inputs implying it;
   * it is definitional now, which is what retired the per-step reads.
   *
   * Measured on an unchanged tree: 28 decisions cost 1715ms read per step and 189ms through one sweep, which
   * is the whole cost of a run where nothing runs.
   */
  const staleReason = (step: ChainStep, asking = { staleReason: unitStaleReason }): string | null =>
    step.neverCachedBecause !== undefined
      ? `never cached: ${step.neverCachedBecause}`
      : asking.staleReason(unitFor(step, budget), stampFor(step.name));

  if (only !== undefined) {
    // A never-cached producer is verified by its readers instead: `packages:ensure`'s are told the packages are
    // built (`PACKAGES_PREBUILT_ENV`) and refuse a stale one rather than rebuilding it
    const sweep = freshnessSweep();
    try {
      steps = selectOnly(steps, only, (producer) => {
        const step = steps.find((candidate) => candidate.name === producer)!;
        return step.neverCachedBecause !== undefined ? null : staleReason(step, sweep);
      });
    } catch (err) { return refuse((err as Error).message); }
  }

  if (dry) {
    // One question about every step, and nothing runs while it is asked, so one reading of the tree answers it all
    const sweep = freshnessSweep();
    /**
     * What moved, for the one step being asked about — the same diff the post-run report prints, minus the
     * stats, because `--dry` places nothing in time: there is no run to be inside or after.
     *
     * Asked only of a step that is stale for the ordinary reason, so a warm tree pays for nothing and a cold
     * one pays a hash per stale step over bytes this sweep has already read. This is the caller that makes the
     * no-digests case real: it reads stamps it did not write, and one from before those were recorded cannot
     * say which input moved.
     */
    const whatChanged = (step: ChainStep): string => {
      const { stamp: record, undiffable } = diffableStamp(stampRecord(stampFor(step.name)));
      // Its reader's own sentence, rather than a second copy of one. The copy that was here could not print
      // the wrong thing — this is asked only where `why === INPUTS_CHANGED` below, so the fingerprint is a
      // string and only the two record clauses are reachable — but it was a literal kept in step with
      // `diffableStamp`'s by nothing, and there were three of them in three files.
      if (record === undefined) return undiffable;
      return firstChange(sweep.changedInputs(unitFor(step, budget), record));
    };
    // What the run would admit on, which is the half of the plan the per-step lines cannot carry. Only the
    // steps above one core are listed: the rest are a count, because nineteen lines reading `1` is the table
    // `POOL_WIDTH` deliberately does not keep.
    const wide = steps.filter((step) => step.cores > 1);
    console.log(`\nadmitting on ${cores(budget)}, ${box()} cores on this machine:`);
    for (const step of wide) console.log(`${String(step.cores).padStart(7)} ${step.name}`);
    console.log(`${'1'.padStart(7)} each of the other ${steps.length - wide.length} steps\n`);
    /**
     * The steps this plan would actually run, which is what its critical path is over.
     *
     * Typed from `steps` rather than as `ChainStep`: `orderedSteps` is what resolves each step's edges, and
     * `criticalPath` needs them — the raw table has no `dependsOn` field, only the function that derives one.
     */
    const planned: (typeof steps)[number][] = [];
    for (const step of steps) {
      // `--all` runs everything, so a dry run given `--all` must say so rather than reporting the cache it
      // would ignore. A plan that does not answer for the flags it was given is worse than no plan.
      const why = staleReason(step, sweep);
      const willRun = all || why !== null;
      if (willRun) planned.push(step);
      // Naming what moved in place of the sentence, which was the same for every stale step and said less
      const moved = !all && why === INPUTS_CHANGED ? whatChanged(step) : '';
      const reason = all ? '--all' : (moved === '' ? (why ?? '') : moved);
      console.log(`${(willRun ? 'run' : 'cached').padStart(7)} ${marker(needsApp(step))} ${step.name.padEnd(STEP_NAME_WIDTH)} ${wrapAt(DRY_REASON_COLUMN, reason)}`.trimEnd());
    }
    // What bounds the plan, over what each step cost here recently — the question "which step is worth making
    // faster". A step that is not on this path runs inside the shadow of the ones that are, so its own
    // duration is not a saving. `criticalPathLine` has what that cost to learn.
    const costed = withRecordedSeconds(planned, readStepSeconds(REPO_ROOT));
    const plannedPath = criticalPathLine(costed.steps, 'recorded', costed.unread.length);
    if (plannedPath !== '') console.log(`\n${plannedPath}`);
    // What shortening any of them could buy, which a duration does not say: a step's saving is capped by
    // the second-longest route, so a long step on a dense graph can be worth nothing. `pathSavingsLine`
    // has the three proposals that cost.
    const plannedSavings = pathSavingsLine(costed.steps);
    if (plannedSavings !== '') console.log(`  ${plannedSavings}`);
    return;
  }

  /** The reason a step ran, kept for its line and for the failure report */
  const reasons = new Map<string, string>();
  /**
   * One reading of the tree for every dispatch decision, kept honest by forgetting what each step writes.
   *
   * `packages:ensure` is why this cannot simply be a snapshot: it is never cached, so it runs on every
   * invocation, and when it rebuilds anything its readers must compare against the new bytes rather than the
   * ones this sweep read before it started.
   */
  /**
   * One run per checkout from here on, because everything below writes this checkout's stamps — `pruneStamps`
   * first. Taken after the `--dry` return above, which reads and writes nothing and is documented as the thing
   * to run on a machine too loaded to time a run on, so it must not be blocked by a run in progress.
   *
   * Released on the way out by `exclusive-lock.ts`'s own `exit` and interrupt handlers, so there is no
   * `finally` here for a chain that throws or is Ctrl-C'd.
   */
  let lock: ExclusiveLock;
  try {
    lock = await holdChainLock({
      what: chainInvocation(),
      waitMs: args.flags.has('wait') ? CHAIN_WAIT_MS : 0,
      onWait: (holder) => console.log(`waiting for another chain run to finish:\n  ${holder}`),
    });
  } catch (err) {
    // Printed rather than rethrown: a throw reaches the top-level catch, which says "the chain itself
    // failed", and this is a refusal. Exit 1, because a caller reading 0 would take it for a chain that passed
    if (!(err instanceof ChainLockHeld)) throw err;
    console.error(`\n${err.message}`);
    process.exitCode = 1;
    return;
  }

  // After the lock, which is what makes one run the only writer of either store
  evidence = openRunEvidence({ startedAt: new Date(started), pid: process.pid });
  const dispatchSweep = freshnessSweep();
  pruneStamps();
  pruneRunEvidence();

  const outcome = await schedule({
    steps,
    budget,
    skip: (step) => {
      const why = staleReason(step, dispatchSweep);
      if (!all && step.neverCachedBecause === undefined && why === null) {
        cached++;
        // On its own line where it was skipped, and dimmed. The order these arrive in is information — it is
        // when the scheduler reached the step — so they are not collected and printed together at the end;
        // the weight is what separates them from the rows that did work, not the position.
        console.log(dim(`${'cached'.padStart(7)} ${marker(needsApp(step))} ${step.name}`));
        return true;
      }
      reasons.set(step.name, all ? '--all' : (why ?? ''));
      return false;
    },
    run: async (step) => {
      const result = await runAndStamp(step, all, budget, shardArgs);
      // A net rather than the mechanism: the graph already orders every reader of these paths after this
      // step, so nothing has read them yet. It costs a map scan and it is what a step reading something it
      // is *not* ordered after would need — see `freshnessSweep`'s note on what it cannot distinguish.
      dispatchSweep.forget(wrote(step));
      results.push(result);
      // TIMEOUT is its own verdict: a step that ran out of budget failed for a different reason than one
      // that returned non-zero, and which it was is the first thing you need to know.
      const verdict = result.code === 0 ? 'ok' : result.timedOut ? 'TIMEOUT' : 'FAIL';
      console.log(`${verdict.padStart(7)} ${marker(needsApp(step))} ${step.name.padEnd(STEP_NAME_WIDTH)} ${secs(result.ms).padStart(6)}  ${wrapAt(REASON_COLUMN, briefly(reasons.get(step.name) ?? '', declaredIn(step.name)))}`.trimEnd());
      // So whoever profiles a suite next has its slow tests without instrumenting it
      // In the step's own time column, so every time on the screen lines up and these read as its contents
      for (const slow of slowestTests(result.output)) {
        console.log(dim(`${' '.repeat(TIME_COLUMN)}${secs(slow.ms).padStart(6)}  ${oneLine(REASON_COLUMN, slow.name)}`));
      }
      // The tests that passed past their size budget: reported, never failed, since load inflates a duration
      // and never deflates one (`DEADLINE_FACTOR`). Not dimmed, being a finding rather than a profile.
      for (const over of overBudgetLines(result.output)) {
        console.log(`${' '.repeat(TIME_COLUMN)}${secs(over.ms).padStart(6)}  ${oneLine(REASON_COLUMN, `over its ${secs(over.budgetMs)} budget: ${over.test}`)}`);
      }
      // And the same for whole files, which is the unit a half is decided in. It reads what the run wrote
      // rather than its output: a step's output is buffered and printed only on failure, so until this
      // existed the pool's own ranking reached nobody running `npm run chain` or `npm run test:unit`.
      // Only for a step that *ran* — a cached step's records are older than the step.
      for (const line of poolLines(step.name, result.ms, budget)) {
        console.log(dim(`${' '.repeat(TIME_COLUMN)}${line}`));
      }
      return result.code === 0;
    },
  });

  // A step whose runner threw never produced a Result, so it is reported from the throw itself
  for (const { step, error } of outcome.threw) {
    const threw = steps.find((candidate) => candidate.name === step);
    console.log(`${'ERROR'.padStart(7)} ${marker(threw !== undefined && needsApp(threw))} ${step.padEnd(STEP_NAME_WIDTH)} ${' '.repeat(6)}  the chain could not run it`);
    console.log(`\n${'='.repeat(72)}\n${step}: the runner threw, which is a bug in the chain rather than a failing check\n${'='.repeat(72)}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }

  // Every step is asked about at this one moment, with nothing left running, so one reading of the tree answers
  // both halves: whether each step is stale, and which of its inputs moved. A fresh sweep, never the dry one.
  const sweep = freshnessSweep();

  // Read before this run's readings join the window, so a failure is compared with what the step usually costs
  const recorded = readStepSeconds(REPO_ROOT);
  const failed = outcome.failed === undefined ? undefined : results.find((r) => r.step === outcome.failed);
  if (failed) {
    const step = steps.find((s) => s.name === failed.step)!;
    const why = failed.timedOut
      ? timedOutBecause({ what: step.name, timeout: step.timeout, seconds: recorded.get(step.name), stalled: failed.stalled })
      : `${step.name} failed (exit ${failed.code})${howLong(recorded.get(step.name), failed.ms, budget)}`;
    console.log(`\n${'='.repeat(72)}\n${why}\n${'='.repeat(72)}\n${failed.output}`);
    const left = evidence?.keepFiles(step.name, keptOnFailure(step)) ?? [];
    if (left.length > 0) console.log(dim(`  kept what it left behind: ${left.join(', ')}`));
  }

  const skipped = cached ? ` (${cached} of ${steps.length} cached)` : '';
  // Measured by this run, so the floor is what it actually waited on
  // `measurementsFrom`, not the results: a killed step's elapsed time is its deadline, and the floor and the
  // duration window would take that for a cost
  const measuredMs = measurementsFrom(results);
  const ran = steps.filter((step) => measuredMs.has(step.name))
    .map((step) => ({ ...step, seconds: Math.round((measuredMs.get(step.name) ?? 0) / 1000) }));
  const measuredPath = criticalPathLine(ran, 'measured');
  const measuredSavings = pathSavingsLine(ran);
  const floor = measuredPath === ''
    ? ''
    : `\n${measuredPath}${measuredSavings === '' ? '' : `\n  ${measuredSavings}`}`;
  // `voided` is filled by the stale block below, which runs before this is printed. Kept as a function rather
  // than a const for that reason: the verdict is composed here and the facts it needs arrive after
  const verdictText = (): string => {
    if (failed) return `chain FAILED at ${failed.step}`;
    if (outcome.failed) return `chain FAILED at ${outcome.failed}`;
    // Not "at": nothing failed its own check. A step read a tree that changed under it, so what is wrong is
    // the result rather than the step, and the sentence has to say which
    if (strict && voided.length > 0) return `chain FAILED: ${voided.join(', ')} ran against a tree that moved`;
    return 'chain passed';
  };
  // Something writing into a step's inputs after it ran is why a "15 of 17 cached" chain still paid 34s
  // for a typecheck every time. Asked here, against the sweep taken above.
  /** Steps whose inputs moved *during* the run, so their pass describes a tree that no longer existed */
  const voided: string[] = [];
  const uncacheable = willNotCache(
    steps,
    new Set(results.filter((r) => r.code === 0).map((r) => r.step)),
    (step) => staleReason(step, sweep),
  );
  if (uncacheable.length > 0) {
    // What is known is that each of these stamped inputs it no longer matches; *why* is per file, on the
    // lines below, and is not always a write — it may be an edit since the run, or a declared path gained.
    // The consequence is stated as one rather than promised, since reverting the change takes it back.
    const one = uncacheable.length === 1;
    console.log(`\n${uncacheable.length} step${one ? '' : 's'} passed, then ${one ? 'its' : 'their'} inputs changed`
      + ` — ${one ? 'it' : 'they'} will not be cached next run`);
    // Sized to the names in this report rather than to the widest in the table: the block stands on its own
    // under a blank line, so it owes the rows above it no column, and a report without the longest-named step
    // in it should not be indented as though it had one
    const nameWidth = Math.max(...uncacheable.map(({ name }) => name.length));
    for (const { name, reason } of uncacheable) {
      const step = steps.find((s) => s.name === name)!;
      const unusual = reason === INPUTS_CHANGED ? undefined : reason;
      // Its own binding, because the verdict needs it too: `when` is the
      // only thing in the system that tells a change *during* the run from one after it, and `willNotCache`
      // cannot see it — it compares fingerprints, which say that something moved and never when
      const moved = whatMoved(step, steps, sweep, budget);
      for (const line of staleLines({ name, nameWidth, reason: unusual, ...moved })) console.log(line);
      if (movedWhileItRan(moved.files)) voided.push(name);
    }
    console.log(dim('  Declare what writes there in that step\'s `outputs`, or stop declaring the tree as an input.'));
    if (voided.length > 0) console.log(voidedLine(voided, strict));
  }

  // What each passing step cost joins this machine's window, which `--dry` and the next failure read. Not a
  // shard's: it ran part of a suite, and its time is not what the step costs
  if (shardArgs.length === 0) {
    const passed = new Set(results.filter((result) => result.code === 0).map((result) => result.step));
    recordStepDurations(REPO_ROOT, new Map([...measuredMs].filter(([step]) => passed.has(step))));
  }

  console.log(`\n${verdictText()} in ${secs(Date.now() - started)}${skipped}${noNative ? ' (test:native not run: --no-native)' : ''}${` on ${cores(budget)}`}${floor}`);
  // After the verdict, so it is the last thing on screen and a reader who scrolled past everything else
  // still has it. Only when there is some: a fully cached run ran nothing and made no directory.
  if (evidence !== undefined && evidence.kept() > 0) console.log(dim(evidenceLine(evidence.dir, evidence.kept())));
  // Not process.exit(): it drops whatever stdout has still to flush, and the failing step's captured output
  // printed just above is the one thing here worth reading. Measured: piped, process.exit() delivers 64KB
  // of a 500KB write, and @app/default-setup's suite output alone is 654KB.
  process.exitCode = outcome.failed || (strict && voided.length > 0) ? 1 : 0;
  // The handlers in `exclusive-lock.ts` would do this on the way out anyway; releasing here frees it for the
  // next run while this one is still printing, which on a piped run is the longest part of its exit
  lock.release();
}


// A throw here is a bug in the chain, not a failing check, and the two must not look alike
try {
  await main();
} catch (err) {
  console.error(`\nthe chain itself failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
}
