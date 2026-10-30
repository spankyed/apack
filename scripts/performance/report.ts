import { z } from 'zod';

const count = z.number().int().nonnegative();
const hrTime = z.tuple([count, count.max(999_999_999)]);
const scalar = z.union([z.string().max(128), z.number().finite(), z.boolean()]);
export const spanSchema = z.object({
  name: z.string().max(128), traceId: z.string().regex(/^[a-f0-9]{32}$/), spanId: z.string().regex(/^[a-f0-9]{16}$/),
  parentSpanId: z.string().regex(/^[a-f0-9]{16}$/).optional(), startTime: hrTime, duration: hrTime,
  status: count, attributes: z.record(z.string().max(128), scalar),
  links: z.array(z.object({ traceId: z.string(), spanId: z.string() })).max(32), droppedLinks: count,
});
export const processReportSchema = z.object({
  observations: z.array(z.string().max(16 * 1024 * 1024)).max(10_000), bytes: count.max(16 * 1024 * 1024), dropped: count, truncated: z.boolean(),
  rejected: count, droppedMetadata: count, mode: z.enum(['disabled', 'lightweight', 'detailed']),
  active: count, unfinished: count, droppedStarts: count, invalidCarriers: count, detachFailures: count,
  droppedEvents: count, contextFailures: count, rejectedStarts: count, invalidAttributes: count, complete: z.boolean(),
}).superRefine((report, ctx) => {
  const bytes = report.observations.reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  if (bytes !== report.bytes) ctx.addIssue({ code: 'custom', message: 'Encoded observation byte count differs' });
  if (report.complete && (report.truncated || report.dropped || report.rejected || report.droppedMetadata || report.active
    || report.unfinished || report.droppedStarts || report.invalidCarriers || report.detachFailures || report.droppedEvents || report.contextFailures || report.rejectedStarts || report.invalidAttributes)) {
    ctx.addIssue({ code: 'custom', message: 'Lossy recording cannot be complete' });
  }
  for (const encoded of report.observations) {
    try { spanSchema.parse(JSON.parse(encoded)); }
    catch { ctx.addIssue({ code: 'custom', message: 'Invalid encoded span' }); break; }
  }
});
export const manifestSchema = z.object({
  format: z.literal(1), source: z.object({ revision: z.string(), dirty: z.boolean(), diffSha256: z.string() }),
  builds: z.array(z.object({ path: z.string(), sha256: z.string() })).min(1),
  fixture: z.object({ generator: z.string(), seed: count, sha256: z.string() }),
  runtime: z.record(z.string(), z.string()), machine: z.object({ platform: z.string(), arch: z.string(), cpus: count, memoryBytes: count, identity: z.string() }),
  mode: z.enum(['disabled', 'lightweight', 'detailed']),
  cache: z.enum(['warm-process', 'fresh-process-warm-filesystem']), warmups: count,
  clock: z.literal('Local monotonic durations; cross-process epoch alignment is approximate'),
});
export const trialSchema = z.object({
  scenario: z.enum(['thread-open', 'streaming', 'search', 'populated-startup']), index: count, warmup: z.boolean(),
  outcome: z.enum(['passed', 'failed', 'incomplete', 'cancelled']), durationMs: z.number().finite().nonnegative().optional(),
  correct: z.boolean(), completion: z.enum(['view-ready', 'missing']),
  processes: z.record(z.string(), processReportSchema), failure: z.string().max(128).optional(),
}).superRefine((trial, ctx) => {
  if (trial.outcome === 'passed' && (!trial.correct || trial.completion !== 'view-ready' || trial.durationMs === undefined
    || Object.keys(trial.processes).length < 2 || Object.values(trial.processes).some(report => !report.complete))) {
    ctx.addIssue({ code: 'custom', message: 'Passing trial requires correct view readiness and complete process reports' });
  }
});
export type PerformanceTrial = z.infer<typeof trialSchema>;
export type PerformanceManifest = z.infer<typeof manifestSchema>;

/** A spread and sample count accompany every median; failed trials remain in the report. */
export function summarize(input: readonly PerformanceTrial[]) {
  const trials = input.map(trial => trialSchema.parse(trial));
  const measured = trials.filter(trial => !trial.warmup);
  const values = measured.filter(trial => trial.outcome === 'passed').map(trial => trial.durationMs!).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return { measured: measured.length, passed: values.length, unsuccessful: measured.length - values.length,
    medianMs: values.length === 0 ? null : values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2,
    minMs: values[0] ?? null, maxMs: values.at(-1) ?? null };
}

/** Twenty trials per revision by default, balanced within each four-run block. Warmups precede this order. */
export function comparisonOrder(perRevision = 20): Array<'A' | 'B'> {
  if (!Number.isSafeInteger(perRevision) || perRevision < 2 || perRevision % 2) throw new RangeError('Trials per revision must be a positive even integer');
  return Array.from({ length: perRevision / 2 }, () => ['A', 'B', 'B', 'A'] as const).flat();
}

/** Source/build identities describe each revision; execution conditions must match before comparing them. */
export function assertComparable(leftInput: unknown, rightInput: unknown) {
  const left = manifestSchema.parse(leftInput); const right = manifestSchema.parse(rightInput);
  if (left.source.dirty || right.source.dirty) throw new Error('Comparison requires clean source revisions');
  for (const field of ['fixture', 'runtime', 'machine', 'mode', 'cache', 'warmups'] as const) {
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
    if (canonical(left[field]) !== canonical(right[field])) throw new Error(`Incompatible comparison: ${field}`);
  }
}

/** Chrome Trace events, readable by Perfetto. Parent ids/links preserve causality without summing durations. */
export function chromeTrace(input: ReadonlyArray<{ process: string; report: unknown }>) {
  const traceEvents: object[] = [];
  input.forEach(({ process, report }, pid) => {
    traceEvents.push({ ph: 'M', name: 'process_name', pid, tid: 1, args: { name: process } });
    for (const encoded of processReportSchema.parse(report).observations) {
      const span = spanSchema.parse(JSON.parse(encoded));
      const micros = ([seconds, nanos]: [number, number]) => seconds * 1e6 + nanos / 1e3;
      traceEvents.push({ ph: 'X', cat: 'apack', name: span.name, pid, tid: 1,
        ts: micros(span.startTime), dur: micros(span.duration), args: {
          ...span.attributes, traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId, links: span.links,
        } });
    }
  });
  return { displayTimeUnit: 'ms', metadata: { clockAlignment: 'approximate', durations: 'local monotonic', causality: 'parentSpanId and links' }, traceEvents };
}
