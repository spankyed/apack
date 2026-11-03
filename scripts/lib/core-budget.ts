// What of the machine each chain step takes, so one scheduler can admit them on cores.
//
// The chain has had a scheduler for steps since `chain-schedule.ts` and none for cores: `--lanes 3` meters
// a single-threaded `tsc` leg and a nine-worker vitest pool as one unit each. Measured 2026-10-02 on a
// 10-core box, that is 3 of 10 cores through the typecheck phase and 18 workers on 10 through the test
// phase — the same two-schedulers problem `chain-steps.ts` names over `TYPECHECK_STEPS`, which flattening
// the legs fixed for their *scheduling* and left standing for the pools' *sizing*.
//
// **Nothing here imposes a width; every entry describes one.** `test:integration` caps itself in its own
// config and the two unit pools take vitest's default. Those configs stay literal, which they have to:
// `check:specifiers` reads them as text and cannot read a computed value. So this table is a second record
// of a fact, and the kind that re-takes its answer — `core-budget.spec.ts` holds every entry to the config
// it describes, so a cap that moves fails there rather than drifting from here.
//
// A **share** of the box rather than a core count, so an entry means the same thing on any machine and a
// case about it is not about the box it ran on.

import * as os from 'node:os';

/**
 * This machine's usable cores.
 *
 * `availableParallelism` rather than `cpus().length`, which counts the host's where this reads a
 * container's quota. `scripts/test-unit.ts` already chooses it the same way.
 */
export const box = (): number => os.availableParallelism?.() ?? os.cpus().length;

/**
 * A pool that sets no cap, and so takes vitest's default of one less than the box.
 *
 * Declared as the default rather than as a share, because `(cpus - 1) / cpus` is not one number: 0.9 on
 * ten cores, 0.875 on eight. What such an entry claims is that its config sets *nothing*, and that is the
 * half a check can hold it to.
 */
export const UNCAPPED = Symbol('vitest default: one less than the box');

/**
 * What a step takes: a share of the box, a fixed number of cores, or vitest's uncapped default.
 *
 * **The distinction is load-bearing, not cosmetic.** A worker pool told to take half the cores takes half
 * of whatever box it finds, so its entry is a `share`. A bundler given a fixed amount of work uses about
 * the same number of cores wherever it runs — `build:runtime` is a measured 2.2 on ten — so a `share` would
 * have the chain believe it takes 4.4 on twenty and over-budget everything beside it. Writing both as a
 * bare number was the first version of this table, and it was wrong in that direction.
 */
export type PoolWidth = { readonly share: number } | { readonly cores: number } | typeof UNCAPPED;

const PACK_BUILD_WIDTH: PoolWidth = { cores: 2 };

/**
 * What each step's inner pool takes. A step with no entry takes one core.
 *
 * Absent is the common case and the right one: nineteen of the twenty-nine steps are one `tsc` or one
 * `node`, and `SIZE_MS`'s precedent (`unit-suites.ts`) is that a list whose every entry is the same value
 * is one nobody maintains. An entry is a claim about a pool, and something has to stand behind it.
 *
 * **`build:runtime` and `build:default-setup` are the two entries nothing declares**, so they are measured rather than
 * described, and that distinction is why they were left out until the admission policy became the default
 * — which was the condition, and it is met. Without them both weighed one core while vite and esbuild
 * fork, so the chain over-admitted beside the two steps on its critical path.
 *
 * What stands behind a measured entry, given this table has neither the hysteresis nor the busy-machine
 * refusal `spec-cost.json` carries: **an integer core count is its own band.** 1.6 and 2.2 both round to
 * two, so the jitter that hysteresis exists to absorb cannot move either one, and a scheduling weight
 * wrong by 0.4 of a core changes an admission only where it sits on the budget's boundary. A third such
 * entry needs the same argument made for it — the rounding has to do the work, not the measurement — and
 * `core-budget.spec.ts` can only hold the declared kind to its config, never this kind to anything.
 */
export const POOL_WIDTH: Readonly<Record<string, PoolWidth>> = {
  'test:unit:host': UNCAPPED,
  'test:unit:pack': UNCAPPED,
  'test:integration': { share: 0.5 },
  // Each native scenario spawns compilers and watchers of its own, so it takes no more than integration
  'test:native': { share: 0.5 },
  // Cold vue-tsc, 2026-10-18: 24.72s CPU / 14.66s wall and 24.95s / 14.65s.
  // One compiler uses about 1.7 cores; reserve two without widening its quick deadline.
  'typecheck:pack': { cores: 2 },
  // **Measured as CPU time over wall time, 2026-10-02, two runs each**: `build:default-setup` 21.5s of CPU in 13.6s
  // and 21.2s in 13.1s, so 1.6 cores; `build:runtime` 62.9s in 29.0s and 61.2s in 27.6s, so 2.2. Both round
  // to two.
  //
  // That instrument rather than sampling the machine, and the reason is worth keeping: idle sampling could
  // not separate the step from a box that would not go below 2.4 cores busy, and subtracting the baseline
  // gave `build:default-setup` 1.8 cores on one run and 2.7 on the next. A process's own CPU time does not care what
  // else is running. It does assume the work is awaited — a step that detaches a child would read low,
  // and neither of these does.
  'build:default-setup': PACK_BUILD_WIDTH,
  // Preparation builds the same shipped pack with fixture edits, then archives it serially.
  'test:external-pack:fork': PACK_BUILD_WIDTH,
  // Both producers run actual pack builds; authoring also repeats one for release preflight.
  'test:external-pack:contract': PACK_BUILD_WIDTH,
  'test:packaged-authoring:author': PACK_BUILD_WIDTH,
  // Each fixture pack's Playwright suite, one worker per three cores, each worker an Electron app of three
  // processes. **Measured as CPU time over wall time, 2026-10-23, two runs on a ten-core box**: 263.1s of CPU
  // in 82.4s and 265.4s in 82.8s, so 3.2 cores, which rounds to three
  'test:external-pack:app': { cores: 3 },
  // **`build:runtime` was re-measured on 2026-10-06, when it stopped running its four builds in series**:
  // 2.57, 2.57, 2.56, 2.49, 2.44 cores over five readings, median 2.56, against 2.2 when it was serial.
  //
  // **The rounding does not do the work here, and that has to be said rather than glossed.** The range
  // straddles the 2.5 boundary, so jitter alone moves this between 2 and 3 — which is the argument the
  // doc above demands of a measured entry, failing. Two things settle it anyway. The readings are
  // monotonic in wall time (16.68s → 2.57, 17.05s → 2.56, 17.46s → 2.49, 18.81s → 2.44): contention
  // inflates the wall without adding CPU, so it *depresses* this ratio and the quiet-box figure is the top
  // of the range. And on a boundary the tie goes **up**, because the two errors are not alike — a width
  // below the truth over-admits and starves the step beside it, which is the failure this table exists to
  // prevent and the one its own history records, where a width above the truth only leaves a core idle.
  'build:runtime': { cores: 3 },
  // Three independent extractions at once (`scripts/api-check.ts`), measured the same way: 25.6s of CPU in
  // 7.1s, so 3.6 cores; weighed as one, the budget would admit it as a single core while it took a third of
  // this box
  'api:check': { cores: 4 },
};

/**
 * What a step takes of `cores`, which defaults to this machine's.
 *
 * The parameter is what lets a case ask about a ten-core box from an eight-core one. These are the
 * scheduler's weights, and a weight that moves with the machine is one no case can pin.
 */
export function coresFor(step: string, cores: number = box()): number {
  const width = POOL_WIDTH[step];
  if (width === undefined) return 1;
  if (width === UNCAPPED) return Math.max(1, cores - 1);
  // Clamped, because a weight larger than the machine would make the budget soft for that step alone and
  // admit it beside anything — the one thing a declared width is there to prevent
  if ('cores' in width) return Math.max(1, Math.min(width.cores, cores));
  return Math.max(1, Math.round(width.share * cores));
}

/** A share as vitest writes it in `maxWorkers`, which is how a config and this table are compared */
export const asPercent = (share: number): string => `${Math.round(share * 100)}%`;

/** The share a step declares, or undefined where its width is not one — which is what a config can hold */
export const shareOf = (step: string): number | undefined => {
  const width = POOL_WIDTH[step];
  return width !== undefined && width !== UNCAPPED && 'share' in width ? width.share : undefined;
};
