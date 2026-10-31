import { performanceProcessReport } from './fixtures.ts';
import type { PerformanceRecordingReport } from '@apackdev/host/diagnostics';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
import { expect, it } from 'vitest';
import { processReportSchema, summarize, streamingBacklog, trialSchema } from '../../src/performance/report.ts';
const processReport = { observations: [], bytes: 0, dropped: 0, truncated: false, rejected: 0, droppedMetadata: 0,
  mode: 'lightweight', active: 0, unfinished: 0, droppedStarts: 0, invalidCarriers: 0, detachFailures: 0, droppedEvents: 0, contextFailures: 0, rejectedStarts: 0, invalidAttributes: 0, complete: true };
const trial = { scenario: 'thread-open', index: 0, warmup: false, outcome: 'passed', durationMs: 10, correct: true, completion: 'view-ready', work: {}, processes: { renderer: performanceProcessReport('lightweight', 'renderer'), backend: performanceProcessReport('lightweight', 'backend') } };
it('refuses manufactured success without view readiness, a duration, or complete process reports', () => {
  for (const patch of [{ completion: 'missing' }, { durationMs: undefined }, { correct: false }]) {
    expect(trialSchema.safeParse({ ...trial, ...patch }).success).toBe(false);
  }
  for (const patch of [{ observations: ['bad span'] }, { unfinished: 1 }]) {
    expect(processReportSchema.safeParse({ ...processReport, ...patch }).success).toBe(false);
  }
});
it('keeps unsuccessful measurements visible and excludes warmup timings from summaries', () => {
  const trials = [trial, { ...trial, index: 1, durationMs: 20 }, { ...trial, index: 2, warmup: true, durationMs: 1000 },
    { ...trial, index: 3, outcome: 'incomplete', correct: false, completion: 'missing', durationMs: undefined }].map(value => trialSchema.parse(value));
  expect(summarize(trials)).toEqual({ measured: 3, passed: 2, unsuccessful: 1, medianMs: 15, minMs: 10, maxMs: 20 });
  expect(summarize([trials[3]!])).toEqual({ measured: 1, passed: 0, unsuccessful: 1, medianMs: null, minMs: null, maxMs: null });
});
it('requires visible intermediate streaming progress and plausible milestone timings', () => {
  const streaming = { ...trial, scenario: 'streaming', work: { visibleUpdates: 3 }, timings: { firstVisibleMs: 2, maxVisibleGapMs: 4 } };
  expect(trialSchema.safeParse(streaming).success).toBe(true);
  for (const patch of [{ timings: undefined }, { work: { visibleUpdates: 1 } }, { timings: { firstVisibleMs: 10, maxVisibleGapMs: 1 } }, { timings: { firstVisibleMs: 2, maxVisibleGapMs: 11 } }]) {
    expect(trialSchema.safeParse({ ...streaming, ...patch }).success).toBe(false);
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
  const parsed: PerformanceRecordingReport = processReportSchema.parse(report);
  expect(parsed.profiles).toEqual(report.profiles);
  expect(JSON.parse(parsed.profiles!.cpu!).nodes).toBeInstanceOf(Array);
  expect(JSON.parse(parsed.profiles!.allocation!).head).toBeDefined();
  expect(parsed.bytes + parsed.profiles!.bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(processReportSchema.safeParse({ ...report, profileFailures: 1 }).success).toBe(false);
  expect(processReportSchema.safeParse({ ...report, profiles: { ...report.profiles, bytes: 0 } }).success).toBe(false);
});
