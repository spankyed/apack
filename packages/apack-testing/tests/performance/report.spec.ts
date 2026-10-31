import { performanceProcessReport } from './fixtures.ts';
import type { PerformanceRecordingReport } from '@apackdev/host/diagnostics';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
import type { z } from 'zod';
import { expect, it } from 'vitest';
import { assertComparable, comparisonOrder, manifestSchema, processReportSchema, summarize, streamingBacklog, trialSchema, validatePerformanceRun } from '../../src/performance/report.ts';
const processReport = { observations: [], bytes: 0, dropped: 0, truncated: false, rejected: 0, droppedMetadata: 0,
  mode: 'lightweight', active: 0, unfinished: 0, droppedStarts: 0, invalidCarriers: 0, detachFailures: 0, droppedEvents: 0, contextFailures: 0, rejectedStarts: 0, invalidAttributes: 0, complete: true };
const trial = { scenario: 'thread-open', index: 0, warmup: false, outcome: 'passed', durationMs: 10, correct: true, completion: 'view-ready', work: {}, processes: { renderer: performanceProcessReport('lightweight', 'renderer'), backend: performanceProcessReport('lightweight', 'backend') } };
it('refuses manufactured success without view readiness, a duration, or complete process reports', () => {
  for (const patch of [{ completion: 'missing' }, { durationMs: undefined }, { correct: false }, { processes: {} }, { processes: { renderer: { ...processReport, unfinished: 1 } } }]) {
    expect(trialSchema.safeParse({ ...trial, ...patch }).success).toBe(false);
  }
  expect(processReportSchema.safeParse({ ...processReport, observations: ['bad span'] }).success).toBe(false);
});
it('keeps unsuccessful measurements visible and excludes warmup timings from summaries', () => {
  const trials = [trial, { ...trial, index: 1, durationMs: 20 }, { ...trial, index: 2, warmup: true, durationMs: 1000 },
    { ...trial, index: 3, outcome: 'incomplete', correct: false, completion: 'missing', durationMs: undefined }].map(value => trialSchema.parse(value));
  expect(summarize(trials)).toEqual({ measured: 3, passed: 2, unsuccessful: 1, medianMs: 15, minMs: 10, maxMs: 20 });
  expect(summarize([trials[3]!])).toEqual({ measured: 1, passed: 0, unsuccessful: 1, medianMs: null, minMs: null, maxMs: null });
});
it('balances revision order in each block rather than measuring all baselines first', () => {
  const order = comparisonOrder();
  expect(order).toHaveLength(40);
  expect(order.filter(value => value === 'A')).toHaveLength(20);
  expect(order.slice(0, 8)).toEqual(['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A']);
  expect(() => comparisonOrder(3)).toThrow();
});
it('refuses pooled results with dirty sources or different fixture and execution conditions', () => {
  const manifest = manifestSchema.parse({ format: 1, source: { revision: 'one', dirty: false, excludedUntracked: [], diffSha256: 'clean' }, builds: [{ path: 'app', sha256: 'one' }],
    fixture: { generator: 'test', seed: 0, sha256: 'fixture', distribution: {} }, native: { pin: 'native', checkoutRevision: 'native', dirty: false, excludedUntracked: [] }, mode: 'lightweight', cache: 'warm-process', warmups: 5,
    runtime: { node: 'one', electron: 'two' }, machine: { platform: 'linux', arch: 'arm64', cpus: 2, memoryBytes: 1024, identity: 'machine' },
    clock: 'Local monotonic durations; cross-process epoch alignment is approximate' });
  const revision = { ...manifest, source: { ...manifest.source, revision: 'two' }, builds: [{ path: 'app', sha256: 'two' }], runtime: { electron: 'two', node: 'one' } };
  expect(() => assertComparable(manifest, revision)).not.toThrow();
  expect(() => assertComparable({ ...manifest, native: { ...manifest.native, checkoutRevision: 'other' } }, { ...revision, native: { ...revision.native, checkoutRevision: 'other' } })).toThrow(/pinned/);
  expect(() => assertComparable(manifest, { ...revision, source: { ...revision.source, dirty: true } })).toThrow(/clean/);
  expect(() => assertComparable(manifest, { ...revision, builds: [...revision.builds, { path: 'vendor/elmdb/binding.node', sha256: 'changed' }] })).toThrow(/native outputs/);
  expect(() => assertComparable(manifest, { ...revision, native: { ...revision.native, dirty: true } })).toThrow(/clean/);
  expect(() => assertComparable(manifest, { ...revision, cache: 'fresh-process-warm-filesystem' })).toThrow(/cache/);
  expect(() => assertComparable(manifest, { ...revision, fixture: { ...revision.fixture, seed: 1 } })).toThrow(/fixture/);
});

it('keeps report validation aligned with every required host capture field', () => {
  const compatible: z.infer<typeof processReportSchema> extends PerformanceRecordingReport ? true : never = true;
  expect(compatible).toBe(true);
});

it('requires visible intermediate streaming progress and plausible milestone timings', () => {
  const streaming = { ...trial, scenario: 'streaming', work: { visibleUpdates: 3 }, timings: { firstVisibleMs: 2, maxVisibleGapMs: 4 } };
  expect(trialSchema.safeParse(streaming).success).toBe(true);
  for (const patch of [{ timings: undefined }, { work: { visibleUpdates: 1 } }, { timings: { firstVisibleMs: 10, maxVisibleGapMs: 1 } }, { timings: { firstVisibleMs: 2, maxVisibleGapMs: 11 } }]) {
    expect(trialSchema.safeParse({ ...streaming, ...patch }).success).toBe(false);
  }
});

it('rejects incomplete and internally inconsistent whole runs before comparison', () => {
  const manifest = { format: 1, source: { revision: 'one', dirty: false, excludedUntracked: [], diffSha256: 'clean' },
    builds: [{ path: 'app', sha256: 'one' }], fixture: { generator: 'test', seed: 0, sha256: 'fixture', distribution: {} },
    native: { pin: 'native', checkoutRevision: 'native', dirty: false, excludedUntracked: [] }, mode: 'lightweight', cache: 'warm-process', warmups: 1,
    runtime: {}, machine: { platform: 'linux', arch: 'arm64', cpus: 2, memoryBytes: 1024, identity: 'machine' },
    clock: 'Local monotonic durations; cross-process epoch alignment is approximate' };
  const trials = [{ ...trial, warmup: true }, { ...trial, index: 1 }];
  expect(validatePerformanceRun(manifest, trials, 1).summary.passed).toBe(1);
  for (const changed of [trials.slice(1), [trials[0], trials[0]], [trials[0], { ...trials[1], warmup: true }],
    [trials[0], { ...trials[1], scenario: 'search' }],
    [trials[0], { ...trials[1], processes: { renderer: processReport, unrelated: processReport } }],
    [trials[0], { ...trials[1], processes: { renderer: { ...processReport, mode: 'disabled' }, backend: processReport } }],
    [trials[0], { ...trials[1], outcome: 'cancelled' }]]) {
    expect(() => validatePerformanceRun(manifest, changed, 1)).toThrow();
  }
});

it('preserves process statistics across the portable schema and rejects concealed sample loss', async () => {
  const controller = createNodePerformanceController();
  controller.start('lightweight');
  const report = await controller.stop();
  const parsed = processReportSchema.parse(report);
  expect(parsed.processStatistics).toEqual(report.processStatistics);
  expect(parsed.processStatistics).toBeDefined();
  expect(processReportSchema.safeParse({ ...report, processStatisticsFailures: 1 }).success).toBe(false);
});

it('retains bounded raw streaming backlog, detects clock uncertainty and refuses incomplete progress', () => {
  const produced = [{ epochMs: 1, chars: 10 }, { epochMs: 2, chars: 20 }, { epochMs: 3, chars: 30 }];
  const received = [{ epochMs: 2, chars: 10 }, { epochMs: 4, chars: 30 }];
  expect(streamingBacklog(produced, received, 30)).toMatchObject({ maxPendingChars: 10, clockOrderMismatches: 0, produced, received });
  expect(streamingBacklog(produced, [{ epochMs: 0, chars: 10 }, { epochMs: 4, chars: 30 }], 30).clockOrderMismatches).toBe(1);
  expect(() => streamingBacklog(produced, received.slice(0, 1), 30)).toThrow(/Incomplete/);
  expect(() => streamingBacklog(produced, [received[1], received[0]], 30)).toThrow();
  expect(() => streamingBacklog(Array(65).fill(produced[0]), received, 30)).toThrow();
});

it('retains real V8 profiles across report admission and rejects hidden profile failure', async () => {
  const controller = createNodePerformanceController();
  controller.start('detailed');
  await controller.ready();
  const report = await controller.stop();
  expect(report.complete).toBe(true);
  expect(processReportSchema.parse(report).profiles).toEqual(report.profiles);
  expect(processReportSchema.safeParse({ ...report, profileFailures: 1 }).success).toBe(false);
  expect(processReportSchema.safeParse({ ...report, profiles: { ...report.profiles, bytes: 0 } }).success).toBe(false);
});

it('requires promised captures in whole-run admission, including the startup driver', () => {
  const manifest = { format: 1, source: { revision: 'one', dirty: false, excludedUntracked: [], diffSha256: 'clean' },
    builds: [{ path: 'app', sha256: 'one' }], fixture: { generator: 'test', seed: 0, sha256: 'fixture', distribution: {} },
    native: { pin: 'native', checkoutRevision: 'native', dirty: false, excludedUntracked: [] }, mode: 'detailed',
    cache: 'fresh-process-warm-filesystem', warmups: 0, runtime: {},
    machine: { platform: 'linux', arch: 'arm64', cpus: 2, memoryBytes: 1024, identity: 'machine' },
    clock: 'Local monotonic durations; cross-process epoch alignment is approximate' };
  const processes = { renderer: performanceProcessReport('detailed', 'renderer'), backend: performanceProcessReport('detailed', 'backend'), driver: performanceProcessReport('detailed', 'driver') };
  const startup = { ...trial, scenario: 'populated-startup', processes };
  expect(validatePerformanceRun(manifest, [startup], 1).summary.passed).toBe(1);
  delete processes.driver.profiles;
  expect(() => validatePerformanceRun(manifest, [startup], 1)).toThrow(/capture/i);
});
