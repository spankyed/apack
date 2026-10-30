import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createPerformanceScenarioRun, performanceSchedule, readPerformanceModeComparison } from '../../src/performance/comparison.ts';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function directory() { const result = mkdtempSync(path.join(tmpdir(), 'apack-comparison-')); directories.push(result); return result; }
const manifest = { format: 1, source: { revision: 'one', dirty: false, excludedUntracked: [], diffSha256: 'clean' },
  builds: [{ path: 'app', sha256: 'one' }], fixture: { generator: 'test', seed: 0, sha256: 'fixture', distribution: {} },
  native: { pin: 'native', checkoutRevision: 'native', dirty: false, excludedUntracked: [] }, mode: 'disabled', cache: 'warm-process', warmups: 5,
  runtime: { performancePolicy: 'alternating-modes-v1' }, machine: { platform: 'linux', arch: 'arm64', cpus: 2, memoryBytes: 1024, identity: 'machine' },
  clock: 'Local monotonic durations; cross-process epoch alignment is approximate' };
const report = { observations: [], bytes: 0, dropped: 0, truncated: false, rejected: 0, droppedMetadata: 0,
  mode: 'disabled', active: 0, unfinished: 0, droppedStarts: 0, invalidCarriers: 0, detachFailures: 0, droppedEvents: 0,
  contextFailures: 0, rejectedStarts: 0, invalidAttributes: 0, complete: true };
function complete(candidateMs = 104) {
  const output = directory(); const run = createPerformanceScenarioRun(output, manifest, 2, 'lightweight');
  for (const entry of run.schedule) {
    run.begin(entry);
    const process = { ...report, mode: entry.mode };
    run.append(entry, { scenario: 'thread-open', index: entry.index, warmup: entry.warmup, outcome: 'passed', correct: true,
      completion: 'view-ready', durationMs: entry.variant === 'A' ? 100 : candidateMs, work: {}, processes: { renderer: process, backend: process } });
  }
  writeFileSync(path.join(output, 'invocation.json'), JSON.stringify({ code: 0, timedOut: false, aborted: false }));
  return output;
}
it('executes five warmups per mode then exactly twenty measured ABBA actions per mode', () => {
  const schedule = performanceSchedule('disabled', 20, 'lightweight');
  expect(schedule).toHaveLength(50);
  expect(schedule.slice(0, 10).map(entry => entry.variant)).toEqual([...Array(5).fill('A'), ...Array(5).fill('B')]);
  expect(schedule.slice(10, 18).map(entry => entry.variant)).toEqual(['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A']);
  for (const variant of ['A', 'B']) expect(schedule.filter(entry => entry.variant === variant && !entry.warmup)).toHaveLength(20);
  expect(performanceSchedule('lightweight', 1)).toHaveLength(6);
  for (const args of [['disabled', 3, 'lightweight'], ['disabled', 20, 'disabled'], ['invalid', 20], ['disabled', 101]]) {
    expect(() => performanceSchedule(args[0], args[1] as number, args[2])).toThrow();
  }
});
it('admits observed order, immutable samples and same-source overhead with a declared budget', () => {
  const comparison = readPerformanceModeComparison(complete(), 2);
  expect(comparison.baseline.summary).toMatchObject({ measured: 2, passed: 2, medianMs: 100 });
  expect(comparison.candidate.summary).toMatchObject({ measured: 2, passed: 2, medianMs: 104 });
  expect(comparison).toMatchObject({ medianDifferenceMs: 4, medianChangePercent: 4, budget: { medianPercent: 5, assessment: 'within-budget' } });
  expect(readPerformanceModeComparison(complete(110), 2).budget?.assessment).toBe('over-budget');
});
it('refuses overlapping, reordered and mismatched producer executions', () => {
  const run = createPerformanceScenarioRun(directory(), manifest, 2, 'lightweight');
  expect(() => run.begin(run.schedule[1]!)).toThrow();
  run.begin(run.schedule[0]!);
  expect(() => run.begin(run.schedule[1]!)).toThrow();
  expect(() => run.append(run.schedule[1]!, {})).toThrow();
});
it('rejects fabricated ordering, intervals, source/build identity and missing execution evidence', () => {
  for (const fault of ['order', 'interval', 'build', 'source', 'missing', 'exit']) {
    const output = complete();
    const file = path.join(output, fault === 'exit' ? 'invocation.json' : ['build', 'source'].includes(fault) ? 'B/manifest.json' : 'execution.json');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (fault === 'exit') value.code = 1;
    if (fault === 'order') value.executions[10].variant = 'B';
    if (fault === 'interval') value.executions[11].startedMs = 0;
    if (fault === 'build') value.builds[0].sha256 = 'other';
    if (fault === 'source') value.source.revision = 'other';
    if (fault === 'missing') value.executions.pop();
    writeFileSync(file, JSON.stringify(value));
    expect(() => readPerformanceModeComparison(output, 2)).toThrow();
  }
});
it('retains a failed raw trial and refuses comparison even if its execution finished', () => {
  const output = directory(); const run = createPerformanceScenarioRun(output, manifest, 2, 'lightweight'); const entry = run.schedule[0]!;
  run.begin(entry); run.append(entry, { scenario: 'thread-open', index: 0, warmup: true, outcome: 'incomplete', correct: false,
    completion: 'missing', work: {}, processes: { renderer: report, backend: report }, failure: 'missing-view-ready' });
  expect(JSON.parse(readFileSync(path.join(output, 'execution.json'), 'utf8')).status).toBe('failed');
  expect(JSON.parse(readFileSync(path.join(output, 'A/trial-0.json'), 'utf8')).failure).toBe('missing-view-ready');
  expect(() => readPerformanceModeComparison(output, 2)).toThrow();
});
it('retains independent successful startup lifecycle and per-launch manifests for both modes', () => {
  const output = directory(); const run = createPerformanceScenarioRun(output, { ...manifest, cache: 'fresh-process-warm-filesystem' }, 2, 'lightweight');
  const invocations = { A: [{ phase: 'seed', exitCode: 0, signal: null, index: undefined as number | undefined }], B: [{ phase: 'seed', exitCode: 0, signal: null, index: undefined as number | undefined }] };
  run.save(invocations);
  for (const entry of run.schedule) {
    run.begin(entry); const process = { ...report, mode: entry.mode };
    const trial = { scenario: 'populated-startup', index: entry.index, warmup: entry.warmup, outcome: 'passed', correct: true,
      completion: 'view-ready', durationMs: 100, work: {}, processes: { driver: process, renderer: process, backend: process } };
    const own = path.join(output, entry.variant, `trial-${entry.index}`); mkdirSync(own);
    writeFileSync(path.join(own, 'manifest.json'), readFileSync(path.join(output, entry.variant, 'manifest.json')));
    writeFileSync(path.join(own, 'results.json'), JSON.stringify({ trials: [trial] }));
    invocations[entry.variant].push({ phase: 'populated-startup', exitCode: 0, signal: null, index: entry.index }); run.append(entry, trial);
  }
  writeFileSync(path.join(output, 'invocation.json'), JSON.stringify({ code: 0, timedOut: false, aborted: false }));
  expect(readPerformanceModeComparison(output, 2).scenario).toBe('populated-startup');
});
