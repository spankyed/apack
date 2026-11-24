/**
 * What each spec file took in the run that just happened, as that run's own reporter recorded it.
 *
 * Three consumers: the pool prints its slowest files, a `@slow:` marker on a spec that is no longer slow
 * fails the step, and `spec:dry` prices a plan from the last run on this machine. All three are answered
 * from one run on one machine, which is the whole reason this can exist at all — `spec-cost.json` recorded
 * a millisecond per spec in git and compared it across runs and machines against a fixed edge, and the
 * quantity turned out not to be one number: a spec reads 2.8s in the fast pool and 0.64s in the integration
 * pool, so each half's reading demanded a move the other took back.
 *
 * **The asymmetry is what makes one of the three a gate.** Load inflates a duration — measured 1.27x
 * median, 2.03x p90, 3.29x max — so it can hide a stale marker and cannot invent one. A marked spec that
 * reads fast is therefore a fact about the spec, and is failed; an unmarked spec that reads slow may be a
 * fact about the machine, and is only ever reported. Swapping those two directions is the mistake that
 * cost the deleted subsystem its window, its band and its two idle floors.
 *
 * ## When to delete the gate, and what it is costing while it lives
 *
 * **The gate is the part of this with a condition on it**, and the outlier detector is now part of it —
 * `OUTLIER_GAP`, `WORTH_NAMING_MS` and `outlierIn` inform the same decision and so carry the same
 * condition. With `SLOW_QUANTILE`, `tailBar`, `SLOW_MARKER`, `slowReason`, `markedSpecs`,
 * `placementOf`, `UNCHECKED_NOTE` and `UNMARKED_NOTE` that is ~300 lines here and six of
 * `spec-durations.spec.ts`' seventeen describes — **about 550 of the 1,901** across this module, its
 * reporter and their specs, **and 115 more outside them**: `placementLines` and `markerReachLines` in
 * `unit-pool.ts` (62) with their four cases in its spec (53), which is where the reported half is now
 * printed. Re-counted 2026-10-06, twice in one day — it read "320 of 1,356", then "505 of 1,855", and a
 * pricing rule with a stale denominator prices nothing. Everything
 * else is the parse, the ranking, the totals, the cache, the window and `spec:dry`'s pricing, which are
 * read whether or not a marker is ever checked. So deleting the gate leaves the instrument intact.
 *
 * **What it guards is fourteen annotations, in one direction, and its failure mode is a stale comment.**
 * What it is *for* is the decision underneath: whether a spec should move between halves — and **that
 * decision is live** — specs have moved halves on this evidence. A marker that has quietly stopped being true is what makes the
 * next such reading untrustworthy, which is why the one direction load cannot fabricate is the one gated.
 *
 * **Eleven of the fourteen are in packages with a single vitest config**, where the move the remedy names
 * costs a new config and a root project entry rather than a rename — `hasSplit` (`spec-halves.ts`) holds
 * that fact and `markerReachLines` (`unit-pool.ts`) prints the count on a passing run. The three in
 * `@apackdev/cli` have both halves, so for those the decision is *available* and not merely nameable.
 *
 * So: **a year of silence is not the condition, because the wait was answered in the other direction.**
 * What would justify deleting the gate is a settled judgement that keeping these markers true is not worth
 * its weight — priced against the placement decisions it enables, of which there have been two, and
 * against the count in the paragraph above rather than any figure restated here. The mechanical halves are
 * cases: that the population has not collapsed to nothing, in `markedSpecs`' describe, and how much of it
 * could move, in `poolDurationLines`'.
 *
 * And price any addition against that figure before making one: answering each objection with another
 * mechanism is how a subsystem like this outgrows the decision it informs (root `CLAUDE.md`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_BY_HALF, HALVES, halfOfPath, specFiles, type Half } from './spec-halves.ts';
import type { ReportedRun } from './spec-durations-reporter.ts';
import { UNIT_SUITES, type UnitSuite } from './unit-suites.ts';

/**
 * Which quantile of a half counts as its slow tail.
 *
 * Dimensionless on purpose: a file and the bar it is measured against come out of the same run, so a run
 * that was slow throughout moves both and the comparison survives it. That is the property a millisecond
 * could not have, and it is why the gate needs no idle floor — correlated movement cancels.
 *
 * Measured 2026-10-05 over 414 files, the five specs marked then clear the fast half's p90 by 5.2x to 32.7x,
 * where a fixed 2,500ms left two of them 13% clear. **If this ever does fail on a spec that is still
 * genuinely slow, deepen the quantile** — the fix is never to record a reading and decide with it.
 */
export const SLOW_QUANTILE = 0.9;

/**
 * A duration in the unit it reads best in, which for a fast half's median of 16ms is not seconds.
 *
 * One formatter rather than one per caller: the pool's ranking and `spec:dry`'s total print the same
 * quantity, and `(ms / 1000).toFixed(1)` rendered most of a fast half as `0.0s`.
 */
export const asDuration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

/**
 * When a run measured something, on the clock of whoever is reading it.
 *
 * A record's `measuredAt` is UTC, which is right for a stored field and wrong for a printed one: slicing
 * the ISO string drops the `Z`, and the result reads as wall-clock time. Observed four hours out on the
 * box that wrote it, under the words "measured here" — and past 20:00 at UTC-4 it printed tomorrow's date.
 * The whole purpose of the value is how stale the answer is, which is a question about the reader's clock.
 */
export const asLocalTime = (iso: string): string => {
  const at = new Date(iso);
  // An unparseable stamp is handed back as it came: this is a label, and a reader seeing the raw field is
  // better served than one seeing `NaN-NaN-NaN`
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

/**
 * The marker a slow spec carries in its header, with its reason after the colon.
 *
 * Both comment spellings, because a header is written either way: a run of `//` lines, or a block whose
 * body lines open with `*`. Reading only the first ignored the marker on every spec that opens with a
 * block — 14 of 326 — and ignored it *silently*, so a contributor following the documented convention got
 * a marker nothing read and nothing reported. The trailing-delimiter branch is for a one-line block.
 */
const SLOW_MARKER = /^(?:\/\/|\*|\/\*+)\s*@slow:\s*(.+?)\s*(?:\*\/)?$/;

export interface FileDuration {
  /** The suite's directory under `packages/`, which is what a cache key and an input path need */
  readonly dir: string;
  /** The spec's path relative to its package, as the reporter prints it */
  readonly file: string;
  readonly half: Half;
  /** Tests and hooks, which is what the console prints and what a marker is judged on */
  readonly ms: number;
  /** Import, setup, environment and prepare — everything a file cost its worker beyond `ms` */
  readonly overheadMs: number;
}

/**
 * Every file the run reported, attributed to the suite that holds it.
 *
 * The reporter states the project, so attribution is a lookup rather than a recovery — a path alone is
 * ambiguous for `tests/source-layout.spec.ts`, which both `server` and `renderer` hold.
 *
 * Skipped modules are dropped here rather than in the reporter. A skipped file reports a duration of 0
 * rather than no duration, and counting those as readings would pull a half's quantile bar down with
 * files that never executed — `default-setup`'s `claude-code-permission-flow` is one today.
 *
 * Refuses a module it cannot attribute rather than dropping it: a silent drop is a file missing from the
 * ranking, from the gate's population and from the cache at once, with nothing saying so.
 */
export function durationsOf(run: ReportedRun, covered: readonly UnitSuite[]): FileDuration[] {
  const byWorkspace = new Map(covered.map((suite) => [suite.workspace, suite]));
  const rows: FileDuration[] = [];
  for (const module of run.modules) {
    if (module.skipped) continue;
    const suite = byWorkspace.get(module.project);
    if (suite === undefined) {
      throw new Error(`the run reported ${module.file} under the project '${module.project}', which is none of the ${covered.length} suite(s) this run covered (${covered.map((one) => one.workspace).join(', ')}) — a workspace name and its vitest project name have diverged, and reading past it would drop the file from the ranking, the gate and the cache at once`);
    }
    // Posix separators, because every other consumer names a spec the way a config glob and a git path do
    const file = module.file.split(path.sep).join('/');
    rows.push({ dir: suite.dir, file, half: halfOfPath(file), ms: module.ms, overheadMs: module.overheadMs });
  }
  return rows;
}

/** The nearest-rank quantile of a set of readings, which needs at least one */
export function quantileOf(values: readonly number[], q: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

/**
 * The bar a file has to clear to be in its half's slow tail, per half and never across both.
 *
 * The two halves are different populations rather than two ends of one: measured 2026-10-05, the fast
 * half's median is 16ms against the integration half's 4,870ms, and its p90 0.6s against 25.3s.
 *
 * **What that buys today is the ranking, not the gate.** Each pool measures one half, so nothing in this
 * repo yet calls this with both in hand; asked of all 413 files at once the bar is 1.7s rather than 25.3s,
 * because the fast half outnumbers the other fifteen to one, and all five markers clear it either way. So
 * the split is construction, and the edit that would make it load-bearing is a run covering both halves —
 * one vitest invocation over both configs, or an integration half that grows to a comparable size. What it
 * does change now is which files a combined ranking would name: the five slowest of all 413 are all
 * integration files, so a single ranking would never show a slow fast-half spec at all.
 */
export const tailBar = (rows: readonly FileDuration[], half: Half, q = SLOW_QUANTILE): number | undefined =>
  quantileOf(rows.filter((row) => row.half === half).map((row) => row.ms), q);

/**
 * The costliest files of a half: what each one took the run, tests and overhead together.
 *
 * **Two orderings, named apart, because one function quietly switching basis is how they came to disagree.**
 * `outlierIn` and `halfBound` judge a file by `costOf`, and for one commit the ranking printed beside them
 * was ordered by `ms` — so the detector could name a file that did not appear in the list above it, which
 * is reachable for anything whose cost is its setup rather than its tests. This is the ordering for
 * anything about a file's *weight*; `slowestFiles` below is the ordering for anything about its *tests*.
 *
 * Bounded rather than thresholded, for the same reason as `slowestFiles`.
 */
export const costliestFiles = (rows: readonly FileDuration[], half: Half, limit = 5): FileDuration[] =>
  rows.filter((row) => row.half === half).sort((a, b) => costOf(b) - costOf(a)).slice(0, limit);

/**
 * The slowest files of a half by test time, which is the figure the console prints.
 *
 * Kept on `ms` because its consumers are about tests: `placementOf` bounds which unmarked files it reports,
 * and a `@slow:` marker explains why a spec's *tests* take long — a different claim from a file being
 * expensive to load. `costliestFiles` is the one to reach for otherwise.
 *
 * Bounded rather than thresholded: a tenth of a half is above its own p90 by construction, which is ~38
 * files of the fast half and far too many to read. What this adds to what vitest already printed is the
 * ordering — vitest prints every file's time, in the order they finished.
 */
export const slowestFiles = (rows: readonly FileDuration[], half: Half, limit = 5): FileDuration[] =>
  rows.filter((row) => row.half === half).sort((a, b) => b.ms - a.ms).slice(0, limit);

/**
 * A half's whole weight, which is the number the ranking cannot give.
 *
 * The five slowest files answer "what is worst"; they never answer "is this half getting heavy", and the
 * two come apart exactly where it matters. Measured 2026-10-05, the top five hold 46% of `internal-repo-checks`'
 * fast half and 97% of `apack-sdk`'s, so in one of those the ranking describes the suite and in the other
 * it describes one file. And the shape a ranking structurally cannot see is many specs each creeping a
 * little: 349 of 388 fast-half files are under 500ms and total 24.1s.
 *
 * `overheadMs` is beside `ms` rather than folded into it because they are different claims: `ms` is the
 * figure the console prints and a `@slow:` marker is judged on, and the sum is what a run costs.
 */
export const halfTotal = (rows: readonly FileDuration[], half: Half): { ms: number; overheadMs: number; files: number } => {
  const held = rows.filter((row) => row.half === half);
  return {
    ms: held.reduce((sum, row) => sum + row.ms, 0),
    overheadMs: held.reduce((sum, row) => sum + row.overheadMs, 0),
    files: held.length,
  };
};

/**
 * Which of the two things that can bound a half's run actually does: its slowest file, or its total work
 * spread across the cores.
 *
 * `max(floor, work/cores)` — "the target any change to scheduling is measured against" (`measure-suites.ts`).
 * Computing it is the whole point of recording overhead, because the figure is worthless without it: measured
 * 2026-10-06 the host pool is 141.4s of tests and 139.6s of overhead, so `work/cores` is 28.1s with it and
 * 14.1s without, against a wall of 29.0s. With overhead the prediction lands within a second; without it,
 * it is out by two.
 *
 * **That error cost a file split for nothing.** `generate-entries.spec.ts` was 18.3s, read as the binding
 * floor against a `work/cores` of 8.7s computed from `ms` alone, and split into five on that basis — for
 * no wall-clock gain, because the honest figure was 28.1s and the half was work-bound the whole time
 * (`generate-entries/_support/pack.ts` records the null result). This line is what would have said so.
 *
 * **What the verdict does not license, learned by acting on it.** Both figures come from readings taken
 * *inside* the pool, so both carry the same contention — which makes comparing them sound and makes
 * neither of them the wall. "floor-bound" says the slowest file is the larger of the two numbers; it does
 * **not** say that splitting that file shortens the run. Measured 2026-10-06 on the integration half: its
 * floor was `facade-typing.integration.spec.ts` at 44.1s against a 30.2s `work/cores`, the file was split
 * on that verdict and came apart as intended — 42.1s to 19.6s and 18.3s, and the half's floor fell to
 * 23.8s — while the pool went **49.9s to 51.4s**, medians of 3. The wall sat above both figures before and
 * after, because the pool is contention-bound rather than packing-bound and a split adds a worker that
 * contends with the rest.
 *
 * So the figure is for deciding *which question to ask* — is there one file to look at, or a hundred — and
 * a before-and-after `npm run measure` is the only thing that answers whether a change to scheduling
 * worked. Reading it as a prediction is the same mistake in the other direction as the one above: that one
 * trusted a floor over an understated work figure, this one trusts the pair over a measurement.
 *
 * `cores` is a parameter rather than read here, so the answer is a function of its inputs and a spec can
 * ask it about a ten-core box from any box.
 */
export const halfBound = (rows: readonly FileDuration[], half: Half, cores: number): {
  floorMs: number; perCoreMs: number; binds: 'floor' | 'work' | 'unknown'; unmeasured: number;
} => {
  const held = rows.filter((row) => row.half === half);
  const total = halfTotal(rows, half);
  const floorMs = Math.max(0, ...held.map(costOf));
  const perCoreMs = cores > 0 ? (total.ms + total.overheadMs) / cores : 0;
  // A file that ran was imported, so an overhead of zero is a record written before the field existed
  // rather than a file that cost nothing to load. Both figures are still facts about what is recorded, so
  // they are returned — but no verdict is drawn from them, because the one it would reach is the wrong
  // one: a missing overhead understates the work and so makes the floor look binding when it is not.
  const unmeasured = held.filter((row) => row.overheadMs === 0).length;
  if (unmeasured > 0) return { floorMs, perCoreMs, binds: 'unknown', unmeasured };
  return { floorMs, perCoreMs, binds: floorMs > perCoreMs ? 'floor' : 'work', unmeasured: 0 };
};

/**
 * How far out of line a half's slowest files may be before the run says so, and the size below which it
 * does not care.
 *
 * **Dimensionless, which is what makes it survive load.** A file and the files it is compared against come
 * out of the same run, so a run that was slow throughout moves all of them — the argument `SLOW_QUANTILE`
 * makes, with a second and independent measurement behind it here: across the recorded window the
 * integration half's slowest file swings 28.8-34.0s, an 18% spread, while its ratio to the next moves
 * 1.37-1.41x, a 3% one. The absolute figure is six times noisier than the ratio of it.
 *
 * **Two, because a warning that fires on ordinary variance is one people learn to skip.** Measured over
 * every recorded run: the host pool's fast half sits at 1.00-1.11x since its biggest file was split and
 * sat at 3.39-4.09x before, the integration half at 1.20-1.62x, the pack pool at 1.06-1.90x. So 2x is
 * above every quiet reading and below every firing one, and the midpoint of 1.90x and 3.74x in the ratio's
 * own terms is 2.67x. If this ever fires on a half nobody should touch, widen it — the fix is not to start
 * recording a millisecond and deciding with it.
 *
 * **The size floor is what lets the ratio be that tight.** Without it the pack pool reports its 4.2s
 * slowest file at 1.90x, and splitting a 4.2s file is not work anyone should do. Ten seconds is where it
 * becomes work worth doing, and it is also what keeps 2x from tripping at ~4s: a half's slowest file has
 * to be both out of line *and* big enough to act on.
 *
 * **A report, never a gate.** The remedy is splitting a file, which is a judgement about what the cases
 * cover and not a mechanical fix; and `generate-entries.spec.ts` is the standing proof that acting on this
 * signal can buy nothing, since splitting it moved no wall clock. Failing a run for it would be failing on
 * a measurement, which the root `CLAUDE.md` rules out twice over.
 *
 * It carries the same deletion condition as the `@slow:` gate above, and for the same reason: it informs
 * the same decision, which has been made zero times.
 */
export const OUTLIER_GAP = 2;

/**
 * What a file cost the run: its tests and hooks plus everything around them.
 *
 * Every judgement about a file's *weight* is on this rather than on `ms`, because `ms` is about half of it
 * and which half depends on the pool. A spec with a thirty-second setup and no test time is invisible to a
 * comparison of `ms`, and that was true of this detector for one commit.
 *
 * `ms` keeps its own uses, which are different questions: it is the figure the console prints, so it is
 * what a `@slow:` marker is judged on and what the ranking shows. **That split is deliberate and worth
 * knowing**: a marker says why a spec's tests take long, which is not the same claim as a file being
 * expensive to run.
 */
export const costOf = (row: FileDuration): number => row.ms + row.overheadMs;

/**
 * Below this, a file is not worth naming to a person, whichever question found it.
 *
 * **Shared by the outlier detector and the unmarked-spec report, because "is this big enough to be worth
 * someone's afternoon" is one question asked twice.** Each applies it to the quantity its own claim is
 * about — `outlierIn` to `costOf`, since splitting a file is about what it costs the run, and the unmarked
 * report to `ms`, since a `@slow:` marker explains why a spec's *tests* take long (the split `costOf`'s
 * doc above sets out). One constant rather than two of the same value, which would be two copies of a
 * number nobody could keep equal.
 *
 * **What it is for, measured 2026-10-06.** Without it the unmarked report named three `default-setup`
 * specs at 469ms, 591ms and 1.4s — not because they are slow but because a half's p90 over 100 files is
 * ~450ms, so "the slowest five, above the bar" is five files by construction and never goes quiet. The
 * only way to silence that is to mark a 591ms spec as slow, which is annotating a file to satisfy an
 * instrument. With it, the host and pack halves are silent and the integration half names two files at
 * 17.1s and 16.0s, which are findings.
 *
 * It is a millisecond and so a fact about a machine, which is tolerable here for the reason the sample
 * section in the root guide gives: nothing is compared against it across runs or boxes, and being 2x out
 * changes which of a handful of files gets mentioned rather than any decision a run makes.
 */
export const WORTH_NAMING_MS = 10_000;

/** A half's slowest files, where they stand apart from the rest of their half */
export interface Outlier {
  /** The files above the gap — one, or the two or three that are large together */
  readonly above: readonly FileDuration[];
  /** The fastest of them against the next file down, which is what the ratio is of */
  readonly belowMs: number;
  readonly ratio: number;
}

/**
 * The widest step among a half's top three, where everything above it is big enough to be worth splitting.
 *
 * **Checked after the first, second and third file rather than only the first**, because a half whose two
 * slowest files are both large has a ratio of about one between them and would otherwise report nothing.
 * Synthetic: two 20s files over a 4s tail is silent on a floor-to-next test and 5.0x on this one. The cost
 * of the generalisation is three comparisons; a ceiling on the half's *total* would have caught the same
 * case and would have been a figure in seconds, tied to a machine and needing re-measurement.
 *
 * The guard is derived rather than declared: a half with nothing below the step has no ratio to take, the
 * same way `placeable` refuses a half whose quantile is its own maximum rather than naming a population
 * floor.
 */
export function outlierIn(
  rows: readonly FileDuration[],
  half: Half,
  { gap = OUTLIER_GAP, floorMs = WORTH_NAMING_MS } = {},
): Outlier | undefined {
  const held = rows.filter((row) => row.half === half).sort((a, b) => costOf(b) - costOf(a));
  let worst: Outlier | undefined;
  for (let k = 1; k <= 3 && k < held.length; k += 1) {
    const above = held.slice(0, k);
    // Every file above the step has to be worth acting on, not just the first
    if (above.some((row) => costOf(row) < floorMs)) continue;
    const belowMs = costOf(held[k]!);
    const ratio = belowMs > 0 ? costOf(above[k - 1]!) / belowMs : Infinity;
    if (ratio >= gap && (worst === undefined || ratio > worst.ratio)) worst = { above, belowMs, ratio };
  }
  return worst;
}

/**
 * What the last run measured for a set of suites, as rows rather than records.
 *
 * This is how a caller that did not perform the run reads it — the chain, which spawns a pool step and
 * sees only its buffered output. Rather than parse that output back (the thing this module stopped
 * doing), it reads what the run wrote: after a pool step that *ran*, the cache on disk is that run's.
 * A step the chain skipped must not be reported on, because then these records are older than the step,
 * and that is the caller's to know.
 */
export function cachedDurations(root: string, suites: readonly UnitSuite[], half: Half, since?: Date): FileDuration[] {
  return suites.flatMap((suite) => {
    const record = readDurations(root, suite.dir, half);
    if (record === undefined) return [];
    // A record older than the run being reported on describes a different run. The pool runs only the
    // projects whose inputs moved, so a step that ran and found none of them stale measured nothing — and
    // without this the caller printed that step's *previous* numbers as though they were its own.
    if (since !== undefined && new Date(record.measuredAt) < since) return [];
    return Object.entries(record.ms).map(([file, ms]) =>
      ({ dir: suite.dir, file, half: halfOfPath(file), ms, overheadMs: record.overheadMs[file] ?? 0 }));
  });
}

/**
 * The reason a spec says it is slow, from its header.
 *
 * The leading comment block only, so the marker is where a reader who opened the file because it was slow
 * will see it. A `@slow:` further down is not a header and is not read — which is deliberate, since the
 * one place it could otherwise appear is a test's own body, describing something else.
 *
 * **The header is whichever comment forms open the file**, a block and line comments in any order, since
 * that is what "the header" means to whoever is writing one. Stopping at the first line that was not a
 * `//` read a block-comment header as no header at all.
 */
export function slowReason(source: string): string | undefined {
  let inBlock = false;
  for (const line of source.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    const match = SLOW_MARKER.exec(text);
    if (match !== null) return match[1]!.trim();
    if (inBlock) {
      if (text.includes('*/')) inBlock = false;
      continue;
    }
    // A one-line block opens and closes on this line, so it leaves the header open for the next
    if (text.startsWith('/*')) {
      inBlock = !text.includes('*/');
      continue;
    }
    if (!text.startsWith('//')) return undefined;
  }
  return undefined;
}

/** How much of a file to read looking for its header, which is a comment block and a reason, never more */
const HEADER_BYTES = 2048;

/** Every spec in a package that carries the marker, by its path relative to that package */
export function markedSpecs(packageDir: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of specFiles(packageDir)) {
    const handle = fs.openSync(path.join(packageDir, file), 'r');
    try {
      const buffer = Buffer.alloc(HEADER_BYTES);
      const read = fs.readSync(handle, buffer, 0, HEADER_BYTES, 0);
      const reason = slowReason(buffer.subarray(0, read).toString('utf8'));
      if (reason !== undefined) found.set(file, reason);
    } finally {
      fs.closeSync(handle);
    }
  }
  return found;
}

/** Why a half's markers went unchecked — two shapes, and the message each one needs is different */
export type Unchecked = 'too few files' | 'a partial run';

/**
 * The message each `Unchecked` needs, beside the union that declares them.
 *
 * A `Record` keyed by the union rather than a ternary over it, so a third shape cannot be added without a
 * message — a ternary would hand the new member the second one's wording and compile.
 *
 * It lives beside the union because **two callers report this**: the pool's own output, and the line
 * `poolDurationLines` puts on a run that passed. Those two are the same sentence in different columns, and
 * the half of it worth having once is the reasoning rather than the glue.
 */
const UNCHECKED_NOTE: Readonly<Record<Unchecked, (facts: UncheckedFacts) => string>> = {
  'too few files': ({ files }) => `${files} file(s) is too few for a tail, so its p90 is its slowest`,
  'a partial run': ({ covered, all }) => `this run covered ${covered} of ${all} project(s), and a bar from`
    + ' part of a half cannot say a marked spec has left its tail',
};

/** What a reader needs to be told about an unchecked half; each shape reads one part of it */
export interface UncheckedFacts {
  readonly files: number;
  readonly covered: number;
  readonly all: number;
}

export const uncheckedNote = (why: Unchecked, facts: UncheckedFacts): string => UNCHECKED_NOTE[why](facts);

/**
 * What an unmarked file in a half's tail is worth, worded once.
 *
 * Said wherever the count is, because meeting the annotation without it leaves a reader no way to know it
 * is not a result they are obliged to clear. It is the one of the two directions a loaded run can
 * fabricate, which is the whole reason it is a report and the stale-marker list is a gate.
 */
export const UNMARKED_NOTE = 'reported, not failed, since load can push a file into a tail and never out of one';

export interface Placement {
  /**
   * Marked and no longer in its half's tail: the direction load cannot fabricate, so the one that fails.
   *
   * **Load cannot fabricate it; a partial run could, and that is why `whole` gates this list.** "Load only
   * inflates a duration" is true of the file's own time and says nothing about the bar, which is the run's
   * own p90 — so a marked spec sitting at a constant duration is below the bar or above it depending on
   * which projects ran beside it. Measured 2026-10-06 by holding one at 2,900ms and changing only its
   * neighbours: below a bar of 7,000ms in an 11-file run and 5,600ms in a 31-file run, stale both times,
   * having not moved. Unreachable on this repo's numbers — only four files are slower than the slowest
   * marked one and each sits in a project of 61 to 100 files, so two slow files can never be a tenth of a
   * run — but that is arithmetic about today's suite rather than anything the code holds, and splitting a
   * project or adding a few slow specs to a small one would break it. So the check asks for a whole half
   * instead, which is the only population that can answer what it asks.
   */
  readonly stale: { readonly dir: string; readonly file: string; readonly ms: number; readonly bar: number; readonly reason: string }[];
  /**
   * Among a half's slowest few and carrying no marker: reported only, never failed.
   *
   * Bounded by the ranking rather than by the bar, because a tenth of a half is above its own p90 by
   * construction — 39 files of this repo's fast half, which is a list nobody reads. And reported rather
   * than failed because load inflates a duration, so this is the one of the two directions a busy machine
   * can fabricate.
   */
  readonly unmarked: FileDuration[];
  /** Halves this run measured but checked no marker in, with how many files it had and why */
  readonly unplaceable: { readonly half: Half; readonly files: number; readonly why: Unchecked }[];
}

/**
 * Whether a half this run measured has a tail to place a file in at all.
 *
 * **A nearest-rank quantile of a small population is its maximum**, and then nothing is above the bar —
 * including the slowest file in it. So the question is not how many files a run needs but whether the one
 * it measured has anyone in its tail, which is the same question and is derived rather than picked: a
 * population floor would be a constant that happens to equal this, and would stop being equal to it the
 * day the quantile moved. Measured 2026-10-05, `internal-publish-checks` alone is 4 files whose p90 is the slowest
 * of them, and `renderer` alone is 8.
 *
 * It matters because a pool run is partial by design — it runs the projects whose inputs moved — so a run
 * of one small project is the ordinary case rather than a corner.
 */
const placeable = (rows: readonly FileDuration[], half: Half, bar: number): boolean =>
  rows.some((row) => row.half === half && row.ms > bar);

/**
 * What a run says about its own `@slow:` markers.
 *
 * Only over the files the run actually reported: a pool runs the projects whose inputs moved, so a marked
 * spec in a project that did not run is not evidence either way and is absent from every list rather than
 * counted as passing. A half the run did not measure at all is absent too, rather than unplaceable — the
 * host pool never measures the integration half, and saying so on every run would be noise about a
 * question nobody asked.
 */
export function placementOf(
  rows: readonly FileDuration[],
  marked: ReadonlyMap<string, Map<string, string>>,
  /**
   * `whole` says the run covered every project in the pool, and it has no default on purpose: it is what
   * decides whether the gate may fire, and a caller that forgot it would get the permissive answer.
   */
  { whole, q = SLOW_QUANTILE, limit = 5, worthNamingMs = WORTH_NAMING_MS }:
    { whole: boolean; q?: number; limit?: number; worthNamingMs?: number },
): Placement {
  const stale: Placement['stale'] = [];
  const unmarked: FileDuration[] = [];
  const unplaceable: Placement['unplaceable'] = [];
  const reasonOf = (row: FileDuration): string | undefined => marked.get(row.dir)?.get(row.file);
  for (const half of HALVES) {
    const bar = tailBar(rows, half, q);
    if (bar === undefined) continue;
    const files = rows.filter((row) => row.half === half).length;
    // Two reasons to check no marker, and they are not the same question: `placeable` asks whether this
    // half has a tail at all, `whole` whether the population is the one the marked file belongs to.
    if (!placeable(rows, half, bar)) unplaceable.push({ half, files, why: 'too few files' });
    else if (!whole) unplaceable.push({ half, files, why: 'a partial run' });
    else {
      for (const row of rows) {
        if (row.half !== half) continue;
        const reason = reasonOf(row);
        // **Strictly below the bar, and small in absolute terms.** Both guards exist because this list
        // fails a run and the remedy it prints is "drop the marker", which has to be true advice.
        //
        // `<` rather than `<=`: a nearest-rank quantile *is* one of the readings, so the file that defines
        // the bar equals it, and `<=` called that file stale for an arithmetic reason. Caught by the chain
        // 2026-10-06 — `facade-typing-published` at 23.5s against a 23.5s p90, the third of 28 files,
        // where `ceil(0.9 * 28)` lands on it. The report's own `> bar` stays strict: it only names a file,
        // where this stops a merge.
        //
        // And `worthNamingMs`, because "no longer in the slow tail" is not the same claim as "no longer
        // slow". A half whose every file is large has a large p90, and a 23.5s spec is slow by any
        // absolute reading of the word; telling someone to drop its marker is telling them to delete a
        // true comment because its neighbours grew.
        if (reason !== undefined && row.ms < bar && row.ms < worthNamingMs) {
          stale.push({ dir: row.dir, file: row.file, ms: row.ms, bar, reason });
        }
      }
    }
    // Outside that branch, because the ranking is a report rather than a gate and is worth having from any
    // run — the line the pool prints beside it says its membership is this run's. It costs nothing in the
    // `too few files` case either: `placeable` being false means nothing is above the bar, so this finds none.
    // Above its half's bar **and** big enough to be worth naming. The bar alone cannot carry this: a p90
    // over a hundred files is ~450ms, so the slowest five are above it by construction and the report
    // would name five files forever, whatever they cost. `WORTH_NAMING_MS` has the measurement.
    for (const row of slowestFiles(rows, half, limit)) {
      if (reasonOf(row) === undefined && row.ms > bar && row.ms >= worthNamingMs) unmarked.push(row);
    }
  }
  return { stale, unmarked, unplaceable };
}

/**
 * Where a run leaves what it measured, for `spec:dry` to price a plan from.
 *
 * Beside the package builds', the chain's and the pool's stamps, in the same cache directory, because what
 * it holds is the same kind of thing: a fact about this machine that no other machine's answer can stand
 * in for. It is not committed and has no `machine` field for the same reason — nothing can carry it off
 * this box, so nothing has to say which box it came from.
 */
export const durationCacheDir = (root: string): string => path.join(root, 'node_modules', '.cache', 'apack-spec-durations');

/**
 * Keyed by suite **and half**, because one suite's two halves are measured by different runs.
 *
 * One key for both would have the host pool's record of a suite clobber the integration pool's and back
 * again on every chain run — the same defect the pool's own stamps had until their key gained the half.
 */
const recordFor = (root: string, dir: string, half: Half): string => path.join(durationCacheDir(root), `${dir}.${half}.json`);

export interface DurationRecord {
  /** When the run that measured these finished, so a reader can say how old the answer is */
  readonly measuredAt: string;
  /** Tests and hooks per spec, by its path relative to the package */
  readonly ms: Readonly<Record<string, number>>;
  /**
   * Overhead per spec, by the same key — import, setup, environment and prepare.
   *
   * A second map rather than a field on each entry, so `ms` stays the flat map every reader indexes.
   */
  readonly overheadMs: Readonly<Record<string, number>>;
}

/**
 * How many of a suite's runs one record keeps.
 *
 * **The window is what makes a creep visible, and it is not the window this branch deleted.** That one
 * existed to *decide* — a median of readings chose which half a spec belonged in, and because the decision
 * was impossible the readings needed hysteresis, a band, a tie rule, a machine field and two idle floors to
 * be comparable at all. This one informs a column on five lines that are already printed. Nothing compares
 * it against an edge, so there is nothing for a threshold to be wrong about.
 *
 * Ten because the output is a trend and not a statistic: enough runs that a slow creep is visible, few
 * enough that the oldest reading still describes code someone would recognise. The cost is bounded — a
 * suite's 100 specs are ~2.5KB a run — and bounded is the point: the *file count* does not move, so
 * `pruneDurationCache` still answers for every name in the directory and a record for a suite long gone
 * is still a thing that gets removed rather than a thing that accumulates.
 */
export const KEPT_RUNS = 10;

/**
 * A window of runs on disk, newest first and at most `KEPT_RUNS` long, or `undefined` where none is recorded.
 *
 * Shared by every machine-local reading — the specs' durations here and the chain steps' in
 * `step-durations.ts`. `sound` validates one record; an unreadable file or a record it rejects reads as no
 * evidence, since the cache is uncommitted and the next run rebuilds it.
 */
export function readWindow<R>(file: string, sound: (value: unknown) => R | undefined): R[] | undefined {
  try {
    const { runs } = JSON.parse(fs.readFileSync(file, 'utf8')) as { runs?: unknown };
    if (!Array.isArray(runs)) return undefined;
    const kept = runs.map(sound).filter((run): run is R => run !== undefined);
    return kept.length === 0 ? undefined : kept;
  } catch {
    return undefined;
  }
}

/** `record` prepended to the window at `file`, the oldest dropped past `KEPT_RUNS` */
export function prependToWindow<R>(file: string, record: R, sound: (value: unknown) => R | undefined): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const runs = [record, ...readWindow(file, sound) ?? []].slice(0, KEPT_RUNS);
  fs.writeFileSync(file, `${JSON.stringify({ runs }, null, 2)}\n`);
}

/**
 * A spec record is sound on `measuredAt` and `ms`; a consumer of `overheadMs` sees zero where it is absent,
 * which is what "no figure" means here.
 */
const soundDurations = (value: unknown): DurationRecord | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { measuredAt, ms, overheadMs } = value as Partial<DurationRecord>;
  if (typeof measuredAt !== 'string' || typeof ms !== 'object' || ms === null) return undefined;
  return { measuredAt, ms, overheadMs: typeof overheadMs === 'object' && overheadMs !== null ? overheadMs : {} };
};

/** A suite half's window, or `undefined` where no run here has measured it */
export const readDurationRuns = (root: string, dir: string, half: Half): readonly DurationRecord[] | undefined =>
  readWindow(recordFor(root, dir, half), soundDurations);

/**
 * What the last run measured, or `undefined` where no run on this machine has measured it.
 *
 * `undefined` for a corrupt or half-written file too: both mean "no evidence about what this costs", which
 * a caller has to be able to say anyway for a fresh clone. Nothing here is load-bearing enough to refuse
 * over — the answer `spec:dry` gives without it is the listing, which is the answer it gives at all.
 */
export function readDurations(root: string, dir: string, half: Half): DurationRecord | undefined {
  return readDurationRuns(root, dir, half)?.[0];
}

/**
 * What the run measured, prepended to each covered suite and half's window.
 *
 * A read-merge rather than an overwrite, which is the one thing to be careful about: two pools never share
 * a (suite, half) key — that is what the key's half is for — so there is no run whose merge can lose
 * another's, and a corrupt or absent file starts a window of one rather than refusing.
 */
export function writeDurations(root: string, rows: readonly FileDuration[], measuredAt = new Date().toISOString()): void {
  const byRecord = Map.groupBy(rows, (row) => `${row.dir}\u0000${row.half}`);
  for (const [key, held] of byRecord) {
    const [dir, half] = key.split('\u0000') as [string, Half];
    const sorted = held.toSorted((a, b) => a.file.localeCompare(b.file));
    const ms = Object.fromEntries(sorted.map((row) => [row.file, row.ms]));
    const overheadMs = Object.fromEntries(sorted.map((row) => [row.file, row.overheadMs]));
    prependToWindow(recordFor(root, dir, half), { measuredAt, ms, overheadMs }, soundDurations);
  }
}

/**
 * How a spec's cost has moved across the window, for the five lines already being printed.
 *
 * The oldest reading the window holds against the newest, and **only** that: no threshold, no verdict, no
 * band. A threshold here would have to clear single-spec variance measured at up to 74% between two quiet
 * runs, and any number picked for that is the hysteresis this branch deleted 4,284 lines of. Bounding the
 * output to a list that is already bounded is what makes the question answerable without one.
 *
 * `undefined` for a window of one, where there is no trend to report yet.
 */
export function trendIn(runs: readonly DurationRecord[] | undefined, file: string): { was: number; runs: number } | undefined {
  if (runs === undefined || runs.length < 2) return undefined;
  const seen = runs.filter((run) => typeof run.ms[file] === 'number');
  if (seen.length < 2) return undefined;
  return { was: seen[seen.length - 1]!.ms[file]!, runs: seen.length };
}

/**
 * The same over a window this reads for itself, for a caller asking about one file.
 *
 * **A caller asking about many takes `trendIn` and reads the window once.** This re-reads and re-parses the
 * record on every call, which for a whole suite is one file read per spec in it — 100 reads of one JSON for
 * `@app/default-setup`. `pricedSpecs` did exactly that for a day.
 */
export const trendOf = (root: string, dir: string, half: Half, file: string): { was: number; runs: number } | undefined =>
  trendIn(readDurationRuns(root, dir, half), file);

/**
 * Every record a run could write, which is what says a file in there answers for nobody.
 *
 * The writer prunes, as the chain's stamps and the pool's do: a cache that only grows is one where a name
 * collision with a suite long gone is a silent pass.
 */
export function pruneDurationCache(root: string): void {
  const dir = durationCacheDir(root);
  if (!fs.existsSync(dir)) return;
  // The halves a suite *has*, read from its own configs, rather than every half there is. A package with
  // one config can hold no integration record, so a cross product admits names no run would ever write and
  // a prune that admits them never removes them. `livePoolStamps` derives its set from the pools for the
  // same reason, and this is the same question asked of the configs the pools are themselves derived from.
  const live = new Set(UNIT_SUITES.flatMap((suite) => HALVES
    .filter((half) => fs.existsSync(path.join(root, 'packages', suite.dir, CONFIG_BY_HALF[half])))
    .map((half) => `${suite.dir}.${half}.json`)));
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.json') && !live.has(file)) fs.rmSync(path.join(dir, file));
  }
}
