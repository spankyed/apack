// How long a step may run before its process group is killed, by the kind of work it is.
//
// **A deadline is a declared class, never a multiple of a measurement.** A class carries no machine: it
// states the kind of work and is chosen for the slowest plausible box, so a smaller machine runs the same
// deadlines without a flake that reads as a code failure. A wedge found at ten minutes rather than at 84
// seconds is the same wedge found.
//
// **A deadline is a ceiling, and the hang detector is `IDLE_MS`.** A busy machine stretches every step, and a
// ceiling sized near a step's cost kills it for the load: on 2026-10-31 a cold `chain --no-native` ran this
// 10-core Mac at a mean load of 24 (54 at peak), and `typecheck:renderer`, 16s on the idle machine, ran past 60s twice. `boundedSpawn` ends a run whose process tree goes
// `IDLE_MS` without CPU or output, which catches a wedge sooner than any ceiling and never fires on a slow
// one. What reaches a ceiling is a tree that keeps spending CPU — a loop that spins.
//
// **Declared by kind, and never derived by thresholding a cost.** That re-couples the killer to a
// measurement. `sizeOf` (`scripts/lib/test-timeouts.ts`) is the same rule for tests: it reads the config
// filename, the half and suite membership — never a duration — and refuses a file it cannot classify.

/**
 * Which common rung a step's *kind of work* puts it on, as something a check can run:
 *
 * - `quick` — one compiler, one linter, one codegen pass.
 * - `suite` — a test suite or a bundle: it fans out across workers or processes. A step that *builds* is a
 *   bundle and not one compiler.
 * - `scenario` — runs an install: `npm install`, a packed tarball, mostly serial and mostly waiting.
 * - `acceptance` — the complete compiler/runtime integration pool, with repeated cold builds, watchers,
 *   archive verification and lifecycle combinations across all its projects.
 *
 * The facts come in rather than being read here, so this module stays underneath `chain-steps.ts`.
 * `chain-graph.spec.ts` gathers them — `installs` from a scan of the step's script text, `fansOut` from
 * whether it declares a `POOL_WIDTH` entry (never what `coresFor` returns, which varies with the machine),
 * `builds` from whether it declares `outputs` — and holds the reviewed exceptions.
 *
 * It is a check and not the declaration: `ChainStep.timeout` stays written down, because deriving a kill
 * deadline from what a step costs would let a cost change silently move when it is killed.
 */
export const rungForKind = (work: { installs: boolean; fansOut: boolean; builds: boolean }): TimeoutClass =>
  work.installs ? 'scenario' : (work.fansOut || work.builds) ? 'suite' : 'quick';

/** How long a process tree may go without CPU or output before `boundedSpawn` ends it as stalled */
export const IDLE_MS = 120_000;

/**
 * `APACK_WATCHDOG=off` turns the watchdog off for a run and everything it starts, which inherit the variable,
 * leaving each command's ceiling as its only bound. `on`, or unset, keeps it. Any other value is refused
 * rather than read as either, since a misspelt `off` that ran the watchdog would look like it had no effect.
 */
export function watchdogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.APACK_WATCHDOG;
  if (value === undefined || value === 'on') return true;
  if (value === 'off') return false;
  throw new Error(`APACK_WATCHDOG is ${JSON.stringify(value)}: set it to off to disable the watchdog, or on (the default)`);
}

/** Each class's deadline, in milliseconds — what `boundedSpawn` is given */
export const TIMEOUT_MS = {
  quick: { ms: 300_000 },
  suite: { ms: 600_000 },
  scenario: { ms: 900_000 },
  acceptance: { ms: 7_200_000 },
} as const satisfies Record<string, { readonly ms: number }>;

export type TimeoutClass = keyof typeof TIMEOUT_MS;

/** Every class, for a check that wants to know none is unused */
export const TIMEOUT_CLASSES = Object.keys(TIMEOUT_MS) as readonly TimeoutClass[];

/**
 * A class named as a string — from a command line, where no type checked it.
 *
 * Refused rather than defaulted, for `sizeOf`'s reason: a budget is a ceiling, so a confident wrong answer
 * is the permissive one. The typed path (`TIMEOUT_MS[step.timeout].ms`) needs none of this.
 */
export function timeoutMsFor(className: string): number {
  const rung = (TIMEOUT_MS as Readonly<Record<string, { readonly ms: number } | undefined>>)[className];
  if (rung === undefined) {
    throw new Error(`No such timeout class: ${className} — one of ${TIMEOUT_CLASSES.join(', ')}`);
  }
  return rung.ms;
}

/** A class as a span, for a message that names what was spent rather than a number nobody chose */
export const timeoutText = (className: TimeoutClass): string =>
  `${TIMEOUT_MS[className].ms / 1000}s (${className})`;

/**
 * Report the enforced bound and the step's recorded cost here, without diagnosing the cause from elapsed time.
 * `seconds` is the median from `step-durations.ts`, absent where this machine has no reading.
 */
export function timedOutBecause({ what, timeout, seconds, stalled }: { what: string; timeout: TimeoutClass; seconds?: number; stalled?: boolean }): string {
  if (stalled) {
    return `${what} stalled: its process tree used no CPU and wrote no output for ${IDLE_MS / 1000}s, so its process group`
      + ' was killed before its budget. Inspect the run output for what it was waiting on.';
  }
  const recorded = seconds !== undefined && seconds > 0
    ? ` It usually takes ${seconds}s here.`
    : ' This machine has no recorded cost for it.';
  return `${what} timed out: it exceeded its ${timeoutText(timeout)} budget and its process group was killed.`
    + recorded + ' A timeout alone does not distinguish slow progress from stalled work. Inspect the run output before retrying or changing its budget.';
}
