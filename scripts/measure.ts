#!/usr/bin/env node
/**
 * Measures a command several times and prints numbers you can quote: the work it did, and how long it took.
 *
 *     npm run measure -- "<command>"                      # 5 runs
 *     npm run measure -- --runs 10 "<command>"
 *     npm run measure -- --against "<command B>" "<A>"    # interleaved A/B, paired difference
 *     npm run measure -- --trials 20 --busy 12 "<cmd>"    # how often it fails, under induced load
 *     npm run measure -- --latency "<command>"            # a question about time: waits for a quiet box
 *     npm run measure -- --idle 50 "<command>"            # lower the floor deliberately
 *     npm run measure -- --force "<command>"              # measure anyway; the citation records it
 *
 * **Work is counted, so it needs no quiet box.** Each run is wrapped (`/usr/bin/time -l` on macOS, `perf stat` on
 * Linux) and reports the instructions it retired and the CPU it spent, which load does not move (`Work`,
 * `scripts/lib/measure.ts`). Most questions here are about work, and those are answered on whatever the box is doing.
 *
 * **A latency waits for one.** Wall time is what load stretches: five numbers in `goal-integration-pool` were wrong
 * and three reached commit messages, every one a `date +%s` loop taken while something else used the CPU. So
 * `--latency` takes the machine lock other chains' expensive steps queue behind, then waits — bounded — for the box
 * to reach the idle floor. Without it a busy run's wall time is printed labelled, never refused, since its work
 * stands; and where nothing can be counted, wall time is all there is, so the run is a latency run.
 *
 * **An A/B comparison interleaves.** Running all of A then all of B lets a drifting machine into the
 * answer — measured, that turned a 49.1s→48.2s difference into a reported 71s→46.1s one.
 *
 * Exit 0 when it produced an answer, 1 otherwise — and in trials mode 1 when trials failed, since that is
 * the answer. `scripts/lib/measure.ts` holds every decision it makes, so a spec can watch those fail.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import {
  asNumber, awaitQuiet, citation, conditions, coresBusySince, cpuNow, groupBySignature, idleNow, IDLE_FLOOR,
  pairedDelta, parseFlags, QUIET_POLL_MS, rateOf, runOrder, startBurners, summarise, upperBound,
  workCitation, workOf, type Trial, type Work,
} from './lib/measure.ts';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { expensiveSteps } from './lib/machine-lock.ts';

const USAGE = 'usage: npm run measure -- [--runs N | --trials N] [--latency] [--idle PERCENT] [--busy N] [--force] '
  + '[--against "<command B>"] "<command>"';

/** A bound, because a run that can hang cannot fail. Wide enough that nothing here has come near it. */
const RUN_BUDGET_MS = 30 * 60_000;

/** What `perf stat` is asked to count on Linux, as `workOf` reads it */
const PERF_EVENTS = ['stat', '-x,', '-e', 'instructions:u,task-clock'];

/**
 * The command a run is wrapped in to count its work, or nothing where this machine can count none. Linux is asked
 * once rather than assumed: a VM without a performance-monitoring unit (the Linux test container's) has `perf` and
 * no instruction counter.
 */
function workWrapper(): readonly string[] | undefined {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/time')) return ['/usr/bin/time', '-l'];
  if (process.platform === 'linux') {
    const probe = spawnSync('perf', [...PERF_EVENTS, 'true'], { encoding: 'utf8' });
    if (probe.status === 0 && workOf(probe.stderr).work?.instructions !== undefined) return ['perf', ...PERF_EVENTS];
  }
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A latency run's gate: the machine lock, which other chains' expensive steps queue behind rather than land in, and
 * then a quiet box, waited for. Answers the idle reading that met the floor and how to give the lock back.
 */
async function holdQuietBox(floor: number): Promise<{ readonly idle: number; readonly release: () => void }> {
  const step = { name: 'measure', expensive: true } as const;
  const lock = expensiveSteps({
    what: `npm run measure --latency (pid ${process.pid})`,
    onWait: (holder) => console.log(`  waiting for another chain's expensive steps before timing:\n  ${holder}`),
  });
  while (!lock.admit(step)) await lock.pause();
  const release = () => lock.leave(step);
  try {
    const idle = await awaitQuiet({
      floor, idle: idleNow, pause: () => sleep(QUIET_POLL_MS),
      onWait: (reading) => console.log(`  waiting for the box to reach ${Math.round(floor * 100)}% idle (${Math.round(reading * 100)}% now)`),
    });
    return { idle, release };
  } catch (error) {
    release();
    throw error;
  }
}

/** One measured run: how long, how it exited, what it said, how much of the box it used, and the work it did */
type Run = Trial & { readonly cores: number; readonly work: Work | undefined };

async function main(): Promise<void> {
  const parsed = parseFlags(process.argv.slice(2), {
    values: ['runs', 'idle', 'against', 'trials', 'busy'],
    booleans: ['force', 'latency'],
  });
  const runs = asNumber(parsed.values.runs, 'runs') ?? 5;
  const trials = asNumber(parsed.values.trials, 'trials');
  const busy = asNumber(parsed.values.busy, 'busy') ?? 0;
  const percent = asNumber(parsed.values.idle, 'idle');
  const floor = percent === undefined ? IDLE_FLOOR : percent / 100;
  const against = parsed.values.against;
  // `--busy` deliberately does what the rest of this refuses, so it carries its own permission
  const force = parsed.flags.has('force') || busy > 0;

  if (parsed.positionals.length !== 1 || runs < 1 || busy < 0 || (trials !== undefined && trials < 1)) {
    throw new Error(USAGE);
  }
  // Two questions, and an A/B of failure *rates* is a third nobody has asked for yet
  if (trials !== undefined && against !== undefined) {
    throw new Error('--trials asks how often a command fails and --against compares two durations; pick one.');
  }
  const command = parsed.positionals[0]!;

  const wrapper = workWrapper();
  // A question about time, or one this machine can answer only in time
  const latency = parsed.flags.has('latency') || wrapper === undefined;
  if (wrapper === undefined && !parsed.flags.has('latency')) {
    console.log('  this machine counts no instructions here, so the wall time is the measurement: timing it as --latency');
  }

  const burners = new AbortController();
  startBurners(busy, burners.signal);
  let release: (() => void) | undefined;
  try {
    let started: number;
    if (latency && !force) ({ idle: started, release } = await holdQuietBox(floor));
    else started = idleNow();

    const idles: number[] = [started];
    const on = new Date().toISOString().slice(0, 10);
    const taken = (): Parameters<typeof conditions>[0] => ({ idles, floor, busy, forced: force });

    /**
     * One run, with a reading taken after it.
     *
     * **Between runs, never during.** A sample taken while the command runs measures the command, which
     * for anything worth timing is the whole box — a quiet machine reads 0% idle and says nothing about
     * whether anything *else* was competing.
     */
    const measure = async (target: string): Promise<Run> => {
      // The window is the spawn alone: `idleNow` below blocks for SAMPLE_MS of near-idle, and including it
      // would dilute the reading by that much of every run
      const before = cpuNow();
      const [file, ...prefix] = wrapper ?? ['sh'];
      const args = wrapper === undefined ? ['-c', target] : [...prefix, 'sh', '-c', target];
      const { code, output, ms, timedOut } = await boundedSpawn(file!, args, RUN_BUDGET_MS);
      const cores = coresBusySince(before);
      idles.push(idleNow());
      // The wrapper's report is cut from what a failure says, so a signature is the command's own
      const { work, rest } = workOf(output);
      return { ms, code, stderr: timedOut === true ? `${rest}\ntimed out` : rest, cores, work };
    };

    /** Timing mode throws on failure: a failed run has no duration worth reporting. */
    const time = async (target: string): Promise<Run> => {
      const run = await measure(target);
      if (run.code !== 0) throw new Error(`the command failed (exit ${run.code}): ${target}`);
      return run;
    };

    if (trials !== undefined) {
      const results: Trial[] = [];
      // Trials mode tolerates a failure, because the failure is the measurement
      for (let i = 0; i < trials; i += 1) results.push(await measure(command));
      const failures = results.filter((trial) => trial.code !== 0).length;
      console.log(`\n  ${command}`);
      console.log(`  ${failures} of ${results.length} failed (${Math.round(rateOf(results) * 100)}%, at most `
        + `${Math.round(upperBound(failures, results.length) * 100)}% at 95% confidence), `
        + `${conditions(taken())}, ${on}`);
      // One group per distinct failure, with the text verbatim: the grouping is a convenience and the
      // exemplar is the evidence. Whether these are one bug or three is the reader's call, not this tool's
      for (const group of groupBySignature(results)) {
        console.log(`\n  ${group.count}x  ${group.signature.slice(0, 140)}`);
        for (const line of group.exemplar.split('\n').slice(-6)) console.log(`      ${line}`);
      }
      process.exitCode = failures > 0 ? 1 : 0;
      return;
    }

    const done: Record<'a' | 'b', Run[]> = { a: [], b: [] };
    for (const arm of runOrder(runs, against !== undefined)) done[arm].push(await time(arm === 'a' ? command : against!));
    const ms = (arm: 'a' | 'b') => done[arm].map((run) => run.ms);
    // A work series exists only when every run reported it: a median over some of the runs is not this series'
    const counted = (arm: 'a' | 'b', field: keyof Work): number[] | undefined => {
      const series = done[arm].flatMap((run) => (run.work?.[field] === undefined ? [] : [run.work[field]!]));
      return series.length === runs ? series : undefined;
    };

    const lines = (arm: 'a' | 'b', indent: string): string => {
      const instructions = counted(arm, 'instructions');
      const cpu = counted(arm, 'cpuMs');
      const work = instructions === undefined && cpu === undefined ? []
        : [`${indent}work     ${workCitation({ instructions: instructions && summarise(instructions), cpu: cpu && summarise(cpu), on })}`];
      // The conditions are the series', not each arm's: both arms ran through the same window
      return [...work, `${indent}latency  ${citation({ ...taken(), summary: summarise(ms(arm)), on })}`].join('\n');
    };

    console.log('');
    if (against === undefined) {
      console.log(`  ${command}\n${lines('a', '  ')}`);
    } else {
      // Cores busy per arm, on `--against` only: it is the signal that says the treatment reached the thing
      // being changed, and a null wall-clock delta cannot be read without it. `coresBusy` has the case
      const busyText = (arm: 'a' | 'b'): string => `${summarise(done[arm].map((run) => run.cores)).median.toFixed(1)} cores busy`;
      console.log(`  A  ${command}\n${lines('a', '     ')}\n     ${busyText('a')}`);
      console.log(`  B  ${against}\n${lines('b', '     ')}\n     ${busyText('b')}`);
      // The paired difference, not the difference of the medians: pairing is why the arms interleave
      const signed = (fraction: number): string => `${fraction >= 0 ? '+' : ''}${Math.round(fraction * 1000) / 10}%`;
      const wall = pairedDelta(ms('a'), ms('b'));
      const [instructionsA, instructionsB] = [counted('a', 'instructions'), counted('b', 'instructions')];
      const workDelta = instructionsA && instructionsB ? `, instructions ${signed(pairedDelta(instructionsA, instructionsB).fraction)}` : '';
      console.log(`\n  B - A: ${wall.ms >= 0 ? '+' : ''}${(wall.ms / 1000).toFixed(1)}s (${signed(wall.fraction)} of A) wall${workDelta}, paired over ${runs}`);
    }
  } finally {
    // Whatever happened above, including a throw: the burners stop and the lock goes back before this returns
    burners.abort();
    release?.();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
