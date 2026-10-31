import { z } from 'zod';

const count = z.number().int().nonnegative();
const hrTime = z.tuple([count, count.max(999_999_999)]);
const scalar = z.union([z.string().max(128), z.number().finite(), z.boolean()]);
const profilesSchema = z.object({
  sampling: z.object({ cpuIntervalMicros: z.literal(1000), allocationIntervalBytes: z.literal(512 * 1024), allocationStackDepth: z.literal(128), includeCollectedAllocations: z.literal(true) }),
  cpu: z.string().max(4 * 1024 * 1024).optional(), allocation: z.string().max(4 * 1024 * 1024).optional(),
  bytes: count.max(8 * 1024 * 1024), failures: count, failureStages: z.array(z.string().max(32)).max(8).optional(), encodedBytes: z.object({ cpu: count.optional(), allocation: count.optional() }).optional(), complete: z.boolean(),
  windowLimitMs: z.literal(30_000), durationMs: z.number().finite().nonnegative(), stoppedBy: z.enum(['owner', 'limit']),
}).superRefine((profiles, ctx) => {
  let bytes = 0;
  for (const [kind, encoded] of [['cpu', profiles.cpu], ['allocation', profiles.allocation]] as const) {
    if (encoded === undefined) continue;
    const size = Buffer.byteLength(encoded);
    bytes += size;
    try {
      const value = JSON.parse(encoded) as { nodes?: unknown; head?: unknown };
      if (size > 4 * 1024 * 1024 || !value || (kind === 'cpu' ? !Array.isArray(value.nodes) : !value.head || typeof value.head !== 'object')) throw Error('Invalid profile');
    } catch { ctx.addIssue({ code: 'custom', message: 'Invalid or oversized V8 profile' }); }
  }
  if (bytes !== profiles.bytes || profiles.complete && (profiles.failures || !profiles.cpu || !profiles.allocation)) {
    ctx.addIssue({ code: 'custom', message: 'Profile capture metadata is inconsistent' });
  }
});
export const spanSchema = z.object({
  name: z.string().max(128), traceId: z.string().regex(/^[a-f0-9]{32}$/), spanId: z.string().regex(/^[a-f0-9]{16}$/),
  parentSpanId: z.string().regex(/^[a-f0-9]{16}$/).optional(), startTime: hrTime, duration: hrTime,
  status: count.max(2), attributes: z.record(z.string().max(128), scalar),
  links: z.array(z.object({ traceId: z.string(), spanId: z.string() })).max(32), droppedLinks: count,
});
export const processReportSchema = z.object({
  processId: count.positive().optional(),
  profiles: profilesSchema.optional(), profileFailures: count.optional(),
  rendererResourceFailures: count.optional(), rendererListenerFailures: count.optional(),
  rendererStatistics: z.object({ source: z.literal('chromium-cdp'), pid: count,
    metrics: z.array(z.object({ name: z.string().max(64), unit: z.enum(['seconds', 'bytes', 'count']), before: z.number().finite().nonnegative(), after: z.number().finite().nonnegative() })).max(16),
    unavailable: z.array(z.string().max(64)).max(16), failures: count }).optional(),
  rendererLongTasks: z.object({ supported: z.boolean(), count, totalMs: z.number().finite().nonnegative(), maxMs: z.number().finite().nonnegative(), failures: count }).optional(),
  processStatistics: z.object({
    samplingFailures: count,
    durationMs: z.number().finite().nonnegative(), cpuUserMicros: count, cpuSystemMicros: count,
    rssStartBytes: count, rssEndBytes: count, rssSampledMaxBytes: count,
    heapStartBytes: count, heapEndBytes: count, heapSampledMaxBytes: count,
    gcCount: count, gcDurationMs: z.number().finite().nonnegative(),
    eventLoopUtilization: z.number().finite().min(0).max(1),
    eventLoopHistogramMaxMs: z.number().finite().nonnegative(), eventLoopLateTickMaxMs: z.number().finite().nonnegative(),
  }).optional(),
  processStatisticsFailures: count.optional(),
  observations: z.array(z.string().max(16 * 1024 * 1024)).max(10_000), bytes: count.max(16 * 1024 * 1024), dropped: count, truncated: z.boolean(),
  rejected: count, droppedMetadata: count, mode: z.enum(['disabled', 'lightweight', 'detailed']),
  active: count, unfinished: count, droppedStarts: count, invalidCarriers: count, detachFailures: count,
  droppedEvents: count, contextFailures: count, rejectedStarts: count, invalidAttributes: count, complete: z.boolean(),
}).superRefine((report, ctx) => {
  if (report.processId !== undefined && report.rendererStatistics && report.processId !== report.rendererStatistics.pid) ctx.addIssue({ code: 'custom', message: 'Renderer identity differs from observed process' });
  const bytes = report.observations.reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  if (bytes !== report.bytes) ctx.addIssue({ code: 'custom', message: 'Encoded observation byte count differs' });
  if (report.bytes + (report.profiles?.bytes ?? 0) > 16 * 1024 * 1024) ctx.addIssue({ code: 'custom', message: 'Combined recording budget exceeded' });
  if (report.complete && (report.truncated || report.dropped || report.rejected || report.droppedMetadata || report.active
    || report.unfinished || report.droppedStarts || report.invalidCarriers || report.detachFailures || report.droppedEvents || report.contextFailures || report.rejectedStarts || report.invalidAttributes
    || report.processStatisticsFailures || report.processStatistics?.samplingFailures || report.rendererResourceFailures || report.rendererListenerFailures || report.rendererStatistics?.failures || report.rendererLongTasks?.failures || report.profileFailures || report.profiles && !report.profiles.complete)) {
    ctx.addIssue({ code: 'custom', message: 'Lossy recording cannot be complete' });
  }
  for (const encoded of report.observations) {
    try { spanSchema.parse(JSON.parse(encoded)); }
    catch { ctx.addIssue({ code: 'custom', message: 'Invalid encoded span' }); break; }
  }
});
export const manifestSchema = z.object({
  format: z.literal(1), source: z.object({ revision: z.string(), dirty: z.boolean(), excludedUntracked: z.array(z.string()), diffSha256: z.string() }),
  builds: z.array(z.object({ path: z.string(), sha256: z.string() })).min(1),
  fixture: z.object({ generator: z.string(), seed: count, sha256: z.string(), distribution: z.record(z.string(), count) }),
  native: z.object({ pin: z.string(), checkoutRevision: z.string(), dirty: z.boolean(), excludedUntracked: z.array(z.string()) }),
  runtime: z.record(z.string(), z.string()), machine: z.object({ platform: z.string(), arch: z.string(), cpus: count, memoryBytes: count, identity: z.string() }),
  mode: z.enum(['disabled', 'lightweight', 'detailed']),
  cache: z.enum(['warm-process', 'fresh-process-warm-filesystem']), warmups: count,
  clock: z.literal('Local monotonic durations; cross-process epoch alignment is approximate'),
});
export const trialSchema = z.object({
  scenario: z.enum(['thread-open', 'streaming', 'search', 'populated-startup']), index: count, warmup: z.boolean(),
  outcome: z.enum(['passed', 'failed', 'incomplete', 'cancelled']), durationMs: z.number().finite().nonnegative().optional(),
  correct: z.boolean(), completion: z.enum(['view-ready', 'missing']),
  work: z.record(z.string().max(64), count),
  timings: z.object({ firstVisibleMs: z.number().finite().nonnegative(), maxVisibleGapMs: z.number().finite().nonnegative() }).optional(),
  backlog: z.object({
    unit: z.literal('UTF-16 code units'), boundary: z.literal('producer enqueue to database-backed view receipt'),
    clock: z.literal('approximate process epoch alignment; not database commit latency'),
    produced: z.array(z.object({ epochMs: count, chars: count })).min(1).max(64),
    received: z.array(z.object({ epochMs: count, chars: count })).min(1).max(64),
    maxPendingChars: count, clockOrderMismatches: count,
  }).optional(),
  processes: z.record(z.string(), processReportSchema), failure: z.string().max(128).optional(),
}).superRefine((trial, ctx) => {
  if (trial.scenario === 'streaming' && trial.outcome === 'passed' && (!trial.timings || trial.timings.firstVisibleMs >= (trial.durationMs ?? 0)
    || trial.timings.maxVisibleGapMs > (trial.durationMs ?? 0) || (trial.work.visibleUpdates ?? 0) < 2)) {
    ctx.addIssue({ code: 'custom', message: 'Streaming requires intermediate progress and bounded milestone timings' });
  }
  if (trial.outcome === 'passed' && (!trial.correct || trial.completion !== 'view-ready' || trial.durationMs === undefined
    || Object.keys(trial.processes).length < 2 || Object.values(trial.processes).some(report => !report.complete))) {
    ctx.addIssue({ code: 'custom', message: 'Passing trial requires correct view readiness and complete process reports' });
  }
});
export type PerformanceTrial = z.infer<typeof trialSchema>;
export type PerformanceManifest = z.infer<typeof manifestSchema>;

/** Pipeline backlog at view receipt, with raw clocks retained rather than claiming exact cross-process lag. */
export function streamingBacklog(producedInput: unknown, receivedInput: unknown, expectedChars: number) {
  const progress = z.array(z.object({ epochMs: count, chars: count })).min(1).max(64);
  const produced = progress.parse(producedInput);
  const received = progress.parse(receivedInput);
  for (const points of [produced, received]) {
    if (points.at(-1)!.chars !== expectedChars || points.some((point, index) => point.chars > expectedChars
      || index > 0 && (point.epochMs < points[index - 1]!.epochMs || point.chars <= points[index - 1]!.chars))) throw Error('Incomplete or unordered streaming progress');
  }
  let maxPendingChars = 0;
  let clockOrderMismatches = 0;
  let productionIndex = 0;
  for (const point of received) {
    while (productionIndex < produced.length && produced[productionIndex]!.epochMs <= point.epochMs) productionIndex++;
    const emitted = produced[productionIndex - 1]?.chars ?? 0;
    if (emitted < point.chars) clockOrderMismatches++;
    maxPendingChars = Math.max(maxPendingChars, emitted - point.chars);
  }
  return { unit: 'UTF-16 code units' as const, boundary: 'producer enqueue to database-backed view receipt' as const,
    clock: 'approximate process epoch alignment; not database commit latency' as const,
    produced, received, maxPendingChars, clockOrderMismatches };
}

/** Validate a complete run before comparison; partial/failing reports remain useful diagnostic evidence. */
export function validatePerformanceRun(manifestInput: unknown, trialsInput: unknown, measured: number) {
  const manifest = manifestSchema.parse(manifestInput);
  if (!Number.isSafeInteger(measured) || measured < 1 || measured > 100 || manifest.warmups > 100) throw Error('Invalid run size');
  const trials = z.array(trialSchema).max(200).parse(trialsInput);
  if (trials.length !== manifest.warmups + measured) throw Error('Incomplete trial count');
  const scenario = trials[0]!.scenario;
  for (const [index, trial] of trials.entries()) {
    if (trial.index !== index || trial.warmup !== (index < manifest.warmups)) throw Error('Invalid trial order or warmup classification');
    if (trial.scenario !== scenario) throw Error('Mixed scenarios');
    if (trial.outcome !== 'passed') throw Error('Unsuccessful trial');
    const required = scenario === 'populated-startup' ? ['driver', 'renderer', 'backend'] : ['renderer', 'backend'];
    if (required.some(process => !trial.processes[process])) throw Error('Missing required process');
    const ids = required.map(role => trial.processes[role]!.processId);
    if (ids.some(id => id === undefined) || new Set(ids).size !== ids.length) throw Error('Missing or duplicate process identity');
    if (Object.values(trial.processes).some(process => process.mode !== manifest.mode)) throw Error('Mixed recording modes');
  }
  return { manifest, trials, summary: summarize(trials) };
}

/** A spread and sample count accompany every median; failed trials remain in the report. */
export function summarize(input: readonly Pick<PerformanceTrial, 'warmup' | 'outcome' | 'durationMs'>[]) {
  const timing = z.object({ warmup: z.boolean(), outcome: z.enum(['passed', 'failed', 'incomplete', 'cancelled']), durationMs: z.number().finite().nonnegative().optional() });
  const trials = input.map(trial => timing.parse(trial));
  if (trials.some(trial => trial.outcome === 'passed' && trial.durationMs === undefined)) throw Error('Passing timing requires a duration');
  const measured = trials.filter(trial => !trial.warmup);
  const values = measured.filter(trial => trial.outcome === 'passed').map(trial => trial.durationMs!).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return { measured: measured.length, passed: values.length, unsuccessful: measured.length - values.length,
    medianMs: values.length === 0 ? null : values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2,
    minMs: values.length ? values[0]! : null, maxMs: values.at(-1) ?? null };
}

/** Twenty trials per revision by default, balanced within each four-run block. Warmups precede this order. */
export function comparisonOrder(perRevision = 20): Array<'A' | 'B'> {
  if (!Number.isSafeInteger(perRevision) || perRevision < 2 || perRevision % 2) throw new RangeError('Trials per revision must be a positive even integer');
  return Array.from({ length: perRevision / 2 }, () => ['A', 'B', 'B', 'A'] as const).flat();
}

/** Source/build identities describe each revision; execution conditions must match before comparing them. */
export function assertComparable(leftInput: unknown, rightInput: unknown) {
  const left = manifestSchema.parse(leftInput); const right = manifestSchema.parse(rightInput);
  if (left.source.dirty || right.source.dirty || left.native.dirty || right.native.dirty) throw new Error('Comparison requires clean source revisions');
  if ([left, right].some(manifest => manifest.native.checkoutRevision !== manifest.native.pin)) throw new Error('Comparison requires the pinned native checkout');
  for (const field of ['fixture', 'native', 'runtime', 'machine', 'mode', 'cache', 'warmups'] as const) {
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
    if (canonical(left[field]) !== canonical(right[field])) throw new Error(`Incompatible comparison: ${field}`);
  }
  const nativeOutputs = (manifest: PerformanceManifest) => manifest.builds.filter(build => build.path.startsWith('vendor/elmdb/')).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(nativeOutputs(left)) !== JSON.stringify(nativeOutputs(right))) throw new Error('Incompatible comparison: native outputs');
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
