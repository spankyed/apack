import type { PerformanceRecordingReport } from '@apackdev/host/diagnostics';
import type { z } from 'zod';
import { expect, it } from 'vitest';
import { assertComparable, comparisonOrder, manifestSchema, processReportSchema, summarize, trialSchema } from '../../src/performance/report.ts';
const processReport = { observations: [], bytes: 0, dropped: 0, truncated: false, rejected: 0, droppedMetadata: 0,
  mode: 'lightweight', active: 0, unfinished: 0, droppedStarts: 0, invalidCarriers: 0, detachFailures: 0, droppedEvents: 0, contextFailures: 0, rejectedStarts: 0, invalidAttributes: 0, complete: true };
const trial = { scenario: 'thread-open', index: 0, warmup: false, outcome: 'passed', durationMs: 10, correct: true, completion: 'view-ready', work: {}, processes: { renderer: processReport, backend: processReport } };
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
