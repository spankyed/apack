#!/usr/bin/env node
/**
 * `npm run typecheck`: every cheap static check, run concurrently.
 *
 *   npm run typecheck              # all of it
 *   npm run typecheck -- --cores 1 # one at a time, for a measurement or a confusing failure
 *
 * WHY CONCURRENT
 *
 * Every leg is a single-threaded compiler, so run one at a time the command uses one core while the rest sit
 * idle. Measured 2026-09-27 on a 10-core machine: **29.3s one at a time, 10.8s all at once**.
 *
 * WHY EACH LEG'S COMMAND IS SPELLED OUT
 *
 * For whoever reads the table, and nothing more: no check reads the commands from here.
 *
 * **Where a template literal does bite is the root manifest, not this table.** `namedByScript`
 * (`lib/typecheck-legs.ts`) derives a leg's cache scope by reading the *root* `package.json` script text
 * for `-w`, `--workspace` and `tsc -p packages/x` — and it throws rather than defaulting when it cannot
 * resolve what it found, which is what keeps that one honest.
 */
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { CHAIN_STEPS } from './lib/chain-steps.ts';
import { schedule } from './lib/chain-schedule.ts';
import { box, coresFor } from './lib/core-budget.ts';
import { pruneDepFiles } from './lib/dep-files.ts';
import { asCount, parseFlags } from './lib/measure.ts';
import { TIMEOUT_MS, timedOutBecause, type TimeoutClass } from './lib/step-timeouts.ts';
import { RECORDED_FILE_CHECKS, CODEGEN, GENERATE_ENTRIES, type TypecheckCommand } from './lib/typecheck-jobs.ts';
import { ENSURE, LEG_TIMEOUT, TYPECHECK_LEGS } from './lib/typecheck-legs.ts';

/**
 * What of the machine the legs may take: all of it, because nothing else is running.
 *
 * Every leg is one `tsc`, so each weighs one core and a budget of ten runs ten of them — which is why
 * this shares the chain's scheduler and its one unit rather than counting legs of its own.
 *
 * **This command is not in the chain.** Each leg is its own chain step, so the chain's scheduler owns the
 * whole machine and this runs only when a person runs it directly, where there is nothing to share with.
 * A fraction of the cores here would be a guess about a scheduler it cannot observe.
 *
 * Measured 2026-09-27 on ten cores, run alone, the step is flat from four at a time up — 12.9s at 3,
 * 11.2s at 4, 10.6s at 6, 11.5s at 8, 11.2s at 16 — because one leg, `typecheck:renderer`, is most of the
 * floor. So the exact number above four buys nothing, and taking all of them costs nothing now that
 * nothing else wants any.
 *
 * `box()` rather than `os.cpus().length`, which counts the host's cores where this reads a container's
 * quota — `core-budget.ts` has the reasoning, and this was the last place in the repo getting it wrong.
 */
const budgetFrom = (cores: string | undefined, jobs: number): number =>
  asCount(cores, 'cores') ?? Math.min(jobs, Math.max(2, box()));

/** One thing this runner spawns: a leg, a prerequisite that writes, or a recorded file's check */
interface Job {
  readonly name: string;
  readonly command: string;
  readonly cwd?: string;
  readonly timeout: TimeoutClass;
  readonly cores: number;
  readonly dependsOn: readonly string[];
}

/** Borrow chain ownership, allowing a different derivation mode to declare its own deadline class. */
function borrowed({ name, command, cwd, timeout }: TypecheckCommand): Job {
  const step = CHAIN_STEPS.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`${name} is not a chain step, so there is no class or cost to borrow — `
    + 'either it was renamed or it belongs in TYPECHECK_LEGS');
  return { name, command, cwd, timeout: timeout ?? step.timeout, cores: coresFor(name),
    dependsOn: [ENSURE, CODEGEN] };
}

/**
 * Everything this command runs, in the order a failure is reported in.
 *
 * Two ordered prerequisites and then the rest at once. `cores` is `coresFor`, not one per job: the budget is
 * cores, and weighing a four-core `api:check` at one admits more work than the box has — the
 * two-schedulers-with-different-weights defect this file's header describes, which the legs were also paying.
 */
const JOBS: readonly Job[] = [
  ...TYPECHECK_LEGS.map((leg) => ({
    name: leg.name,
    command: leg.command,
    timeout: LEG_TIMEOUT,
    cores: coresFor(leg.name),
    dependsOn: leg.name === ENSURE ? [] : [ENSURE, CODEGEN],
  })),
  // Generation captures the compiler/dependency installation before compiling declarations; it is a
  // pack compilation prerequisite, rather than one of the single-tsc reader legs.
  { ...GENERATE_ENTRIES, timeout: 'suite',
    cores: 1, dependsOn: [ENSURE] },
  ...RECORDED_FILE_CHECKS.map(borrowed),
];

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

interface Outcome { readonly ms: number; readonly code: number; readonly output: string; readonly timedOut?: true; readonly stalled?: true }

const done = new Map<string, Outcome>();

// The compilers below write a dep file each, and nothing removes one when its tsconfig goes. Pruned here
// rather than anywhere else because this is what drives them, and before the legs run rather than after, so
// no leg can have a file taken mid-write (`pruneOrphanDepFiles`, scripts/lib/dep-files.ts).
const pruned = pruneDepFiles();
if (pruned.length > 0) console.log(`Removed ${pruned.length} dep file(s) no tsconfig declares: ${pruned.join(', ')}`);

const result = await schedule({
  // One ordering rule, stated once: everything else reads what `packages:ensure` builds. The chain derives
  // its own from `PACKAGE_BUILD_OUTPUTS`; this runner has one graph and no inputs to derive from, so it says
  // the rule once rather than an edge per leg.
  steps: JOBS,
  budget: budgetFrom(parseFlags(process.argv.slice(2), { values: ['cores'], booleans: [] }).values.cores, JOBS.length),
  skip: () => false,
  async run(leg) {
    const [command, ...args] = leg.command.split(' ');
    // The class is the job's own — `LEG_TIMEOUT` for a leg, and for a borrowed step the one its chain entry
    // declares, so a step that fans out keeps the rung sized for that rather than a leg's.
    const outcome = await boundedSpawn(command!, args, TIMEOUT_MS[leg.timeout].ms, { cwd: leg.cwd });
    done.set(leg.name, outcome);
    // One line as it finishes, so a ten-second command is not ten seconds of silence. Completion order, since
    // that is what progress *is*; the failures below are in declared order, which is what reading wants.
    process.stdout.write(`  ${outcome.code === 0 ? 'ok  ' : 'FAIL'} ${leg.name.padEnd(18)} ${secs(outcome.ms)}\n`);
    return outcome.code === 0;
  },
});

const failed = JOBS.filter((leg) => (done.get(leg.name)?.code ?? 0) !== 0);
for (const leg of failed) {
  const outcome = done.get(leg.name)!;
  // `LEG_TIMEOUT`, never the literal: this named `'quick'` while the kill above read `TIMEOUT_MS[LEG_TIMEOUT]`,
  // so changing the legs' class would have had the message report a deadline other than the one that fired
  const why = outcome.timedOut === true
    ? timedOutBecause({ what: leg.name, timeout: leg.timeout, stalled: outcome.stalled })
    : `${leg.name} failed (exit ${outcome.code})`;
  process.stderr.write(`\n${'─'.repeat(72)}\n${why}\n${'─'.repeat(72)}\n${outcome.output}\n`);
}

// A leg that threw is a bug in this runner rather than a failing check, so it is reported separately
for (const { step, error } of result.threw) {
  process.stderr.write(`\n${step}: the runner threw — ${error instanceof Error ? error.message : String(error)}\n`);
}

if (failed.length > 0 || result.threw.length > 0) {
  const names = failed.map((leg) => leg.name).join(', ');
  process.stderr.write(`\n❌ ${failed.length} of ${TYPECHECK_LEGS.length} failed: ${names}\n`);
  process.exitCode = 1;
} else if (result.skipped.length + result.started.length < TYPECHECK_LEGS.length) {
  // Dispatch stops after a failure, so this only reads as a scheduler bug
  process.stderr.write(`\n❌ only ${result.started.length} of ${TYPECHECK_LEGS.length} ran, and none failed\n`);
  process.exitCode = 1;
} else {
  console.log('✅ All type checks passed!');
}
