import { describe, expect, it } from 'vitest';
import {
  asNumber, awaitQuiet, citation, conditions, coresBusy, cpuTimes, driftedDuring, groupBySignature, idleFrom, IDLE_FLOOR,
  latencyCaveat, pairedDelta, parseFlags, rateOf, refusesAsBusy, runOrder,
  signatureOf, summarise, upperBound, workCitation, workOf,
} from '../../../scripts/lib/measure.ts';

/**
 * What `npm run measure` decides, asserted without timing anything.
 *
 * The tool exists because five numbers in `goal-integration-pool` were wrong and three reached commit
 * messages — every one from a hand-rolled loop with no idle gate and no repetition. So the decisions it
 * makes are the subject here: when to refuse, what a series says, and how a number is quoted.
 */

const times = (idle: number, user: number) => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];

describe('how idle the machine is', () => {
  it('reads the fraction from two snapshots', () => {
    expect(idleFrom(cpuTimes(times(0, 0)), cpuTimes(times(750, 250)))).toBeCloseTo(0.75, 5);
  });

  it('sums across cores rather than reading one', () => {
    const two = [...times(300, 100), ...times(700, 900)];
    expect(cpuTimes(two)).toEqual({ idle: 1000, total: 2000 });
  });

  /**
   * The field list is the data's, not ours. A hardcoded set of CPU states is a restated population, and the
   * check that closed the previous session was blind to nine of twelve files for exactly that: it named
   * what to look for instead of reading it. A platform reporting a state we have not heard of must still
   * land in the total, or every idle fraction is quietly overstated.
   */
  it('counts a CPU state it has never heard of', () => {
    const exotic = [{ times: { user: 100, sys: 0, idle: 100, steal: 800 } }];
    expect(cpuTimes(exotic), 'steal is busy time and belongs in the total').toEqual({ idle: 100, total: 1000 });
  });

  /**
   * The bug this whole design is shaped around. A `top` parse returned 0% for a line it could not read, so
   * a gate waiting for the box to go quiet waited for ever and looked like patience. An unreadable sample
   * is a broken measurement, not a low one.
   */
  it('throws on a sample that did not advance, rather than reporting 0%', () => {
    const same = cpuTimes(times(500, 500));
    expect(() => idleFrom(same, same)).toThrow(/did not advance.*reading is broken, not low/s);
  });

  it('throws on counters that went backwards, which is the same kind of nonsense', () => {
    expect(() => idleFrom(cpuTimes(times(900, 100)), cpuTimes(times(100, 900)))).toThrow(/did not advance/);
  });
});

/**
 * The signal that separates "the change did nothing" from "the change never reached what you changed".
 *
 * Both of the measurements that made this necessary are here as cases, because a figure for a reader to
 * glance at is worth nothing if it cannot tell those two apart: the arm that looked flat was a pool still
 * running at most of the box, and the arm that worked ran at a fraction of it.
 */
describe('how much of the box a run used', () => {
  it('reads cores busy from two snapshots', () => {
    expect(coresBusy(cpuTimes(times(0, 0)), cpuTimes(times(340, 660)), 10)).toBeCloseTo(6.6, 5);
  });

  it('separates a knob that missed from one that landed', () => {
    const missed = coresBusy(cpuTimes(times(0, 0)), cpuTimes(times(340, 660)), 10);
    const landed = coresBusy(cpuTimes(times(0, 0)), cpuTimes(times(790, 210)), 10);
    expect(missed, 'a pool still at 6.6 cores is one the cap never reached').toBeGreaterThan(5);
    expect(landed, 'two workers of ten is what a real cap looks like').toBeLessThan(3);
  });

  it('is a fraction of the box, so the core count scales it', () => {
    const half = cpuTimes(times(500, 500));
    expect(coresBusy(cpuTimes(times(0, 0)), half, 10)).toBeCloseTo(5, 5);
    expect(coresBusy(cpuTimes(times(0, 0)), half, 2), 'the same utilisation on a smaller box is fewer cores')
      .toBeCloseTo(1, 5);
  });

  /** It is `idleFrom` underneath, so an unreadable window is loud here too rather than reported as idle */
  it('throws on a window whose counters did not advance', () => {
    const same = cpuTimes(times(500, 500));
    expect(() => coresBusy(same, same, 10)).toThrow(/did not advance/);
  });
});

describe('when a measurement is refused', () => {
  const busy = { idle: 0.2, floor: IDLE_FLOOR, force: false };

  it('refuses below the floor, which is what the tool is for', () => {
    expect(refusesAsBusy(busy)).toBe(true);
  });

  it('allows a quiet box', () => {
    expect(refusesAsBusy({ ...busy, idle: 0.95 })).toBe(false);
  });

  // An override, not an obstacle: a floor people cannot pass is a floor they stop running the tool over
  it('is suppressed by --force', () => {
    expect(refusesAsBusy({ ...busy, force: true })).toBe(false);
  });



  it('takes the floor it is given, so a deliberate lower bar is possible', () => {
    expect(refusesAsBusy({ ...busy, floor: 0.1 })).toBe(false);
  });

  // Reported, not fatal: the run produced numbers, and hiding the drift inside a clean median is how a
  // contended arm gets compared against a quiet one
  it('reports drift separately from refusing to start', () => {
    expect(driftedDuring([0.9, 0.9, 0.3], IDLE_FLOOR)).toBe(true);
    expect(driftedDuring([0.9, 0.85], IDLE_FLOOR)).toBe(false);
  });
});

/**
 * Waiting for the box instead of refusing it, which is what `spec-cost:update` does now.
 *
 * The load a recording hits is nearly always the caller's own — they reach for it having just run the chain
 * that proved the work. So the refusal's advice ("wait, then run it again") was the one thing the command
 * could do itself. What must not change is *which* reading gets recorded: still one above the floor, never
 * a reading taken while the box was busy.
 *
 * The clock and the reader are injected, so these drive it with no real load and no real time.
 */
describe('what a series says', () => {
  it('takes the middle of an odd series and the mean of the two middles of an even one', () => {
    expect(summarise([30, 10, 20])).toMatchObject({ median: 20, min: 10, max: 30, runs: 3 });
    expect(summarise([10, 20, 30, 40]).median).toBe(25);
  });

  it('refuses to summarise nothing rather than inventing a number', () => {
    expect(() => summarise([])).toThrow(/not a measurement/);
  });

  /**
   * Interleaved, never blocked. Running all of A then all of B lets a drifting box into the answer, which
   * is what turned a 49.1s→48.2s difference into a reported 71s→46.1s one.
   */
  it('alternates the arms so each pair shares its conditions', () => {
    expect(runOrder(3, true)).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
    expect(runOrder(3, false)).toEqual(['a', 'a', 'a']);
  });

  // The median of the pairs, not the difference of the medians — pairing is the whole reason for the order
  it('pairs the arms rather than comparing two medians', () => {
    expect(pairedDelta([100, 200, 300], [110, 260, 330])).toMatchObject({ ms: 30 });
    expect(pairedDelta([100, 100], [150, 150]).fraction).toBeCloseTo(0.5, 5);
  });

  it('refuses arms of different lengths, which cannot be paired', () => {
    expect(() => pairedDelta([1, 2], [1])).toThrow(/equal runs/);
  });
});

/**
 * What the box was doing, said once for both modes.
 *
 * There were two of these. The induced-load marking lived in the timing citation alone, so trials — the
 * mode `--busy` exists for — never said the load was induced, and the session's own headline result was
 * reported without it.
 */
describe('the conditions a run happened under', () => {
  const quiet = { idles: [0.92, 0.9], floor: IDLE_FLOOR, busy: 0, forced: false };

  it('is the worst idle of the series', () => {
    expect(conditions(quiet)).toBe('90% idle');
  });

  it('says when the floor was forced, and when the box moved under it', () => {
    expect(conditions({ ...quiet, forced: true })).toContain('forced');
    expect(conditions({ ...quiet, idles: [0.92, 0.2] })).toContain('drifted');
  });

  it('names induced load, in either mode, because only one of them used to', () => {
    expect(conditions({ ...quiet, busy: 12, idles: [0.2, 0.05] }))
      .toBe('under 12 induced busy cores, 5%-20% idle');
  });

  /**
   * Drift means the conditions changed *unexpectedly*, and `driftedDuring` cannot tell that from load we
   * asked for — so every `--busy` run used to end "conditions drifted mid-series". A warning that is
   * always on is one nobody reads; the idle range says the same thing without crying wolf.
   */
  it('does not call induced load a drift', () => {
    expect(conditions({ ...quiet, busy: 12, idles: [0.9, 0.01] })).not.toContain('drifted');
  });

  it('refuses to describe conditions it has no samples for', () => {
    expect(() => conditions({ ...quiet, idles: [] })).toThrow(/describe nothing/);
  });
});

describe('what a number is quoted as', () => {
  const base = {
    summary: summarise([45_000, 48_000, 49_000]), on: '2026-09-29',
    idles: [0.92], floor: IDLE_FLOOR, busy: 0, forced: false,
  };

  // A number without its conditions is an assertion; with them it is a citation, and the difference is
  // three of this repo's commit messages
  it('carries the spread, the conditions and the date', () => {
    expect(citation(base)).toBe('48.0s median of 3 (45.0s-49.0s), 92% idle, 2026-09-29');
  });

  it('drops the range when every run agreed', () => {
    expect(citation({ ...base, summary: summarise([1000]) })).toBe('1.0s median of 1, 92% idle, 2026-09-29');
  });
});

/**
 * What makes two failures the same failure, and what a run of trials licenses you to say.
 *
 * The birpc timeout these exist for had only ever been seen by accident, so its whole evidence base was one
 * failure in two runs. A rate needs trials; a *useful* rate needs the failures told apart.
 */
describe('counting failures rather than timing successes', () => {
  const birpc = (at: string, line: number) => ({
    code: 1,
    stderr: `Error: [vitest-worker]: Timeout calling "onTaskUpdate"\n at Object.onTimeoutError ${at}/rpc.js:${line}:10`,
  });
  const assertion = { code: 1, stderr: 'AssertionError: expected 1 to be 2\n at tests/a.spec.ts:12:3' };

  // The same failure on two machines, or two line numbers apart, is one failure
  it('groups a failure across the tokens that vary between runs', () => {
    expect(signatureOf(birpc('/Users/a/node_modules/vitest', 53)))
      .toBe(signatureOf(birpc('/Users/b/other/vitest', 991)));
  });

  it('keeps distinct failures distinct', () => {
    expect(signatureOf(birpc('/x', 1))).not.toBe(signatureOf(assertion));
  });

  /**
   * The exit code is part of it, and exactly — a command killed by a timeout and one that failed an
   * assertion can print the same tail, and calling those one failure hides the interesting half.
   */
  it('separates two failures that said the same thing and exited differently', () => {
    expect(signatureOf({ code: 1, stderr: 'boom' })).not.toBe(signatureOf({ code: 137, stderr: 'boom' }));
  });

  it('gives a pass no signature, because grouping successes says only that they succeeded', () => {
    expect(signatureOf({ code: 0, stderr: '' })).toBe('');
  });

  it('counts each group and keeps one example verbatim', () => {
    const groups = groupBySignature([
      { ms: 1, ...birpc('/a', 1) }, { ms: 1, ...birpc('/b', 2) }, { ms: 1, ...assertion },
      { ms: 1, code: 0, stderr: '' },
    ]);
    expect(groups.map((g) => g.count), 'commonest first').toEqual([2, 1]);
    // Normalised for grouping, verbatim for reading: the grouping is a convenience, the text is the evidence
    expect(groups[0]!.signature).toContain('rpc.js:N:N');
    expect(groups[0]!.exemplar).toContain('rpc.js:1:10');
  });

  it('reads a rate over the trials, passes included', () => {
    expect(rateOf([{ ms: 1, code: 1, stderr: '' }, { ms: 1, code: 0, stderr: '' }])).toBe(0.5);
  });

  /**
   * What clean runs actually license. Five bound the rate at 45% and twenty at 14% — arithmetic that
   * decided whether to lift the integration pool's worker cap, done by hand in a chat message. A tool that
   * leaves the reader to do it will have readers who quote "five clean runs" as proof.
   */
  it('bounds the rate rather than reporting zero for a clean run', () => {
    expect(upperBound(0, 5)).toBeCloseTo(0.451, 2);
    expect(upperBound(0, 20)).toBeCloseTo(0.139, 2);
    expect(upperBound(0, 5), 'never the observed rate, which is what makes it a bound').toBeGreaterThan(0);
  });

  it('widens with observed failures and never exceeds certainty', () => {
    expect(upperBound(3, 20)).toBeGreaterThan(3 / 20);
    expect(upperBound(5, 5)).toBeLessThanOrEqual(1);
  });

  it('refuses a bound over no trials', () => {
    expect(() => upperBound(0, 0)).toThrow(/not a bound/);
  });
});

/**
 * What the commands make of their arguments — the surface that had no case at all, and produced the one
 * kind of error this whole tool exists to refuse.
 *
 * `npm run measure -- "cmd" --busy` read the token after `--busy`, found nothing, and quietly ran with no
 * load, then printed a citation saying the box was 95% idle. Both commands had it, because one was written
 * from the other. The rules are `spec-cost`'s `parseArgs`, which is the only parser here that already got
 * this right.
 */
describe('the arguments both measure commands take', () => {
  const spec = { values: ['runs', 'busy'], booleans: ['force'] } as const;

  it('reads a value flag, a boolean and the command', () => {
    expect(parseFlags(['--runs', '3', '--force', 'npm test'], spec)).toMatchObject({
      values: { runs: '3' }, positionals: ['npm test'],
    });
    expect(parseFlags(['--force'], spec).flags.has('force')).toBe(true);
  });

  // The defect, exactly: a trailing flag whose value is the next argument that is not there
  it('refuses a flag with no value rather than falling back to a default', () => {
    expect(() => parseFlags(['npm test', '--busy'], spec)).toThrow(/`--busy` needs a value/);
  });

  // The same mistake one position earlier, where the "value" is the next flag
  it('refuses a value that is itself a flag', () => {
    expect(() => parseFlags(['--runs', '--force', 'npm test'], spec)).toThrow(/`--runs` needs a value/);
  });

  it('refuses a flag it does not know, including the `=` spelling of one it does', () => {
    expect(() => parseFlags(['--runz', '3'], spec)).toThrow(/No such flag: --runz/);
    expect(() => parseFlags(['--runs=3'], spec)).toThrow(/No such flag/);
  });

  it('keeps a flag out of the positionals, so the command is what is left', () => {
    expect(parseFlags(['--runs', '3', 'a', 'b'], spec).positionals).toEqual(['a', 'b']);
  });

  it('names the flag when its value is not a number, rather than printing usage at everything', () => {
    expect(() => asNumber('abc', 'runs')).toThrow(/`--runs` takes a number, not "abc"/);
    expect(asNumber(undefined, 'runs'), 'absent is not an error; the caller has a default').toBeUndefined();
    expect(asNumber('0', 'runs'), 'zero is a number, and the range is the caller\'s').toBe(0);
  });
});

/** What `/usr/bin/time -l` wrote on this Mac for a command that printed `boom` to stderr and exited 3 */
const TIME_L = [
  'boom',
  '        0.04 real         0.02 user         0.00 sys',
  '            46383104  maximum resident set size',
  '                   0  average shared memory size',
  '                   0  average unshared data size',
  '                   0  average unshared stack size',
  '                2904  page reclaims',
  '                 138  page faults',
  '                   0  swaps',
  '                   0  block input operations',
  '                   0  block output operations',
  '                   0  messages sent',
  '                   0  messages received',
  '                   0  signals received',
  '                   0  voluntary context switches',
  '                 120  involuntary context switches',
  '           245458214  instructions retired',
  '            96475374  cycles elapsed',
  '            12603776  peak memory footprint',
].join('\n');

describe('the work a run did, as its wrapper reports it', () => {
  it('reads instructions and CPU from the rusage block, and leaves the command its own output', () => {
    const { work, rest } = workOf(TIME_L);
    expect(work).toEqual({ instructions: 245_458_214, cpuMs: 20 });
    expect(rest).toBe('boom');
  });

  it('leaves a failure the signature it had without the wrapper, which trials mode groups by', () => {
    const bare = { code: 3, stderr: 'boom' };
    expect(signatureOf({ code: 3, stderr: workOf(TIME_L).rest })).toBe(signatureOf(bare));
  });

  it('reads no work from output with no report, and leaves it whole', () => {
    expect(workOf('just the command\nand more')).toEqual({ work: undefined, rest: 'just the command\nand more' });
  });

  it('reads CPU alone from a block whose instruction line is missing, which an older macOS writes', () => {
    const older = TIME_L.split('\n').filter((line) => !line.includes('instructions retired')).join('\n');
    expect(workOf(older).work).toEqual({ cpuMs: 20 });
  });

  it('reads perf stat on Linux, and nothing from a counter the machine lacks', () => {
    const counted = 'out\n19938301403,,instructions:u,1000000,100.00,,\n1132.41,msec,task-clock,1132410000,100.00,0.998,CPUs utilized';
    expect(workOf(counted)).toEqual({ work: { instructions: 19_938_301_403, cpuMs: 1132 }, rest: 'out' });
    const lacking = '<not supported>,,instructions:u,0,100.00,,\n1132.41,msec,task-clock,1132410000,100.00,,';
    expect(workOf(lacking).work).toEqual({ cpuMs: 1132 });
  });
});

describe('what a measurement of work is quoted as', () => {
  it('leads with instructions and their range, then CPU, and carries no idle reading because it needs none', () => {
    expect(workCitation({ instructions: summarise([19_938_301_403, 19_951_534_584]), cpu: summarise([1_130, 1_240]), on: '2026-11-07' }))
      .toBe('19.94G instructions median of 2 (19.94G-19.95G), 1.2s CPU, 2026-11-07');
  });

  it('labels a wall time taken below the floor, and leaves one taken above it alone', () => {
    expect(latencyCaveat([0.92, 0.4], 0.7)).toContain('not citable as a latency');
    expect(latencyCaveat([0.92, 0.85], 0.7)).toBe('');
  });
});

describe('a latency run waiting for a quiet box', () => {
  const clock = (readings: number[]) => {
    let at = 0;
    return { now: () => at, pause: async () => { at += 5_000; }, idle: () => readings.shift() ?? 0 };
  };

  it('starts at once on a quiet box', async () => {
    const { now, pause, idle } = clock([0.9]);
    await expect(awaitQuiet({ floor: 0.7, idle, now, pause })).resolves.toBe(0.9);
  });

  it('waits through a busy spell and answers the reading that met the floor, saying once that it waits', async () => {
    const { now, pause, idle } = clock([0.2, 0.3, 0.8]);
    const told: number[] = [];
    await expect(awaitQuiet({ floor: 0.7, idle, now, pause, onWait: (reading) => told.push(reading) })).resolves.toBe(0.8);
    expect(told).toEqual([0.2]);
  });

  it('refuses once its wait is spent, rather than waiting for ever or at once', async () => {
    const { now, pause, idle } = clock(Array.from({ length: 200 }, () => 0.1));
    await expect(awaitQuiet({ floor: 0.7, idle, now, pause, waitMs: 60_000 })).rejects.toThrow(/stayed below the 70% idle floor for 1 minutes/);
  });
});
