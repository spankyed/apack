import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { assertComparable, comparisonOrder, manifestSchema, trialSchema, type PerformanceManifest } from './report.ts';
import { createPerformanceRunStore, readPerformanceRun, type PerformanceInvocation } from './run.ts';

const modeSchema = manifestSchema.shape.mode;
export type PerformanceVariant = 'A' | 'B';
export interface PerformanceScheduleEntry { variant: PerformanceVariant; mode: PerformanceManifest['mode']; index: number; ordinal: number; warmup: boolean }

/** Five warmups per variant precede individually balanced ABBA measured actions. */
export function performanceSchedule(modeInput: unknown, measured: number, comparisonInput?: unknown): PerformanceScheduleEntry[] {
  const mode = modeSchema.parse(modeInput);
  const comparison = comparisonInput === undefined ? undefined : modeSchema.parse(comparisonInput);
  if (!Number.isSafeInteger(measured) || measured < 1 || measured > 100 || comparison === mode) throw Error('Invalid performance schedule');
  const modes = { A: mode, B: comparison };
  const variants: PerformanceVariant[] = comparison ? ['A', 'B'] : ['A'];
  const order = [...variants.flatMap(variant => Array<PerformanceVariant>(5).fill(variant)),
    ...(comparison ? comparisonOrder(measured) : Array<PerformanceVariant>(measured).fill('A'))];
  const indices = { A: 0, B: 0 };
  return order.map((variant, ordinal) => { const index = indices[variant]++; return { variant, ordinal, index, warmup: index < 5, mode: modes[variant]! }; });
}
const entrySchema = z.object({ variant: z.enum(['A', 'B']), mode: modeSchema, index: z.number().int().nonnegative(),
  ordinal: z.number().int().nonnegative(), warmup: z.boolean() });
const executionSchema = entrySchema.extend({ startedMs: z.number().finite().nonnegative(), endedMs: z.number().finite().nonnegative().optional(),
  outcome: trialSchema.shape.outcome.optional() });
const journalSchema = z.object({ format: z.literal(1), kind: z.enum(['single', 'mode-comparison']),
  measured: z.number().int().min(1).max(100), baseline: modeSchema, comparison: modeSchema.optional(),
  status: z.enum(['incomplete', 'failed', 'passed']), executions: z.array(executionSchema).max(210) });

/** Per-variant bounded stores plus observed serial execution order; raw payloads never enter this journal. */
export function createPerformanceScenarioRun(directory: string, manifestInput: unknown, measured: number, comparisonInput?: unknown) {
  const manifest = manifestSchema.parse(manifestInput);
  const schedule = performanceSchedule(manifest.mode, measured, comparisonInput);
  const comparison = comparisonInput === undefined ? undefined : modeSchema.parse(comparisonInput);
  if (manifest.runtime.performancePolicy !== (comparison ? 'alternating-modes-v1' : 'single-scenario-v1')) throw Error('Manifest does not declare the execution policy');
  const stores = new Map<PerformanceVariant, ReturnType<typeof createPerformanceRunStore>>();
  for (const variant of comparison ? ['A', 'B'] as const : ['A'] as const) {
    stores.set(variant, createPerformanceRunStore(comparison ? path.join(directory, variant) : directory,
      { ...manifest, mode: variant === 'A' ? manifest.mode : comparison! }, measured));
  }
  const executions: z.infer<typeof executionSchema>[] = [];
  let failure = false;
  let lifecycle: Partial<Record<PerformanceVariant, readonly PerformanceInvocation[]>> | undefined;
  function save(invocations?: Partial<Record<PerformanceVariant, readonly PerformanceInvocation[]>>) {
    if (invocations) lifecycle = invocations;
    for (const [variant, store] of stores) store.save(lifecycle?.[variant]);
    const failed = failure || executions.some(item => item.outcome && item.outcome !== 'passed')
      || Object.values(lifecycle ?? {}).some(items => items.some(item => item.exitCode !== 0));
    const complete = executions.length === schedule.length && executions.every(item => item.outcome === 'passed' && item.endedMs !== undefined);
    const value = journalSchema.parse({ format: 1, kind: comparison ? 'mode-comparison' : 'single', measured,
      baseline: manifest.mode, comparison, status: failed ? 'failed' : complete ? 'passed' : 'incomplete', executions });
    const temporary = path.join(directory, 'execution.json.tmp');
    writeFileSync(temporary, JSON.stringify(value, null, 2));
    renameSync(temporary, path.join(directory, 'execution.json'));
  }
  save();
  return {
    schedule,
    save,
    begin(entry: PerformanceScheduleEntry) {
      if (!isDeepStrictEqual(entry, schedule[executions.length]) || executions.at(-1)?.endedMs === undefined && executions.length > 0) throw Error('Overlapping or out-of-order performance execution');
      executions.push({ ...entry, startedMs: performance.now() }); save();
    },
    append(entry: PerformanceScheduleEntry, input: unknown) {
      const execution = executions.at(-1);
      if (!execution || execution.endedMs !== undefined || !isDeepStrictEqual(entry, schedule[execution.ordinal])) throw Error('No matching active execution');
      try {
        const trial = trialSchema.parse(input);
        if (trial.index !== entry.index || trial.warmup !== entry.warmup || Object.values(trial.processes).some(report => report.mode !== entry.mode)) throw Error('Trial differs from scheduled execution');
        stores.get(entry.variant)!.append(trial);
        execution.endedMs = performance.now(); execution.outcome = trial.outcome; save();
      } catch (error) { failure = true; save(); throw error; }
    },
  };
}

/** Admit an observed ABBA mode comparison; mode is the only allowed provenance difference. */
export function readPerformanceModeComparison(directory: string, measured = 20) {
  const file = path.join(directory, 'execution.json');
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('Invalid or oversized execution journal');
  const journal = journalSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (journal.kind !== 'mode-comparison' || journal.measured !== measured || journal.status !== 'passed' || !journal.comparison) throw Error('Incomplete mode comparison');
  const schedule = performanceSchedule(journal.baseline, measured, journal.comparison);
  if (journal.executions.length !== schedule.length) throw Error('Incomplete observed execution order');
  for (const [position, execution] of journal.executions.entries()) {
    if (!isDeepStrictEqual(entrySchema.parse(execution), schedule[position]) || execution.outcome !== 'passed' || execution.endedMs === undefined
      || execution.endedMs < execution.startedMs || position > 0 && execution.startedMs < journal.executions[position - 1]!.endedMs!) throw Error('Invalid or overlapping observed ABBA order');
  }
  const invocationFile = path.join(directory, 'invocation.json');
  const invocationStat = lstatSync(invocationFile);
  if (!invocationStat.isFile() || invocationStat.size > 16 * 1024) throw Error('Invalid invocation evidence');
  const invocation = z.object({ code: z.literal(0), timedOut: z.literal(false), aborted: z.literal(false) }).parse(JSON.parse(readFileSync(invocationFile, 'utf8')));
  if (invocation.code !== 0) throw Error('Unsuccessful qualification process');
  const baseline = readPerformanceRun(path.join(directory, 'A'), measured);
  const candidate = readPerformanceRun(path.join(directory, 'B'), measured);
  assertComparable(baseline.manifest, { ...candidate.manifest, mode: baseline.manifest.mode });
  if (baseline.manifest.runtime.performancePolicy !== 'alternating-modes-v1' || baseline.manifest.mode !== journal.baseline || candidate.manifest.mode !== journal.comparison || baseline.scenario !== candidate.scenario
    || !isDeepStrictEqual(baseline.manifest.source, candidate.manifest.source) || !isDeepStrictEqual(baseline.manifest.builds, candidate.manifest.builds)) throw Error('Overhead comparison requires identical source and builds');
  const medianDifferenceMs = candidate.summary.medianMs! - baseline.summary.medianMs!;
  const medianChangePercent = baseline.summary.medianMs === 0 ? null : medianDifferenceMs / baseline.summary.medianMs! * 100;
  return { scenario: baseline.scenario, baseline, candidate, medianDifferenceMs, medianChangePercent,
    budget: journal.baseline === 'disabled' && journal.comparison === 'lightweight'
      ? { medianPercent: 5, assessment: medianChangePercent === null ? 'unresolved' : medianChangePercent <= 5 ? 'within-budget' : 'over-budget' } : undefined,
    policy: 'Five warmups per mode, then individually balanced ABBA actions; no tail-percentile claim' };
}
