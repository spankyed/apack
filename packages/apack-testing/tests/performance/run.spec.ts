import { performanceManifest, performanceProcessReport } from './fixtures.ts';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { PerformanceManifest, PerformanceTrial } from '../../src/performance/report.ts';
import { createPerformanceRunStore, readPerformanceRun, PERFORMANCE_TRIAL_BYTES } from '../../src/performance/run.ts';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function directory() { const directory = mkdtempSync(path.join(tmpdir(), 'apack-run-store-')); directories.push(directory); return directory; }
const manifest = performanceManifest();
const report = performanceProcessReport('lightweight', 'backend');
const trial = (index: number): PerformanceTrial => ({ scenario: 'thread-open', index, warmup: index < 5, outcome: 'passed', durationMs: index + 1,
  correct: true, completion: 'view-ready', work: {}, processes: { renderer: performanceProcessReport('lightweight', 'renderer'), backend: performanceProcessReport('lightweight', 'backend') } });
function complete(mode: PerformanceManifest['mode'] = 'lightweight', change: (trial: PerformanceTrial) => void = () => {}, startup = false) {
  const output = directory(); const ownManifest = { ...manifest, mode };
  const store = createPerformanceRunStore(output, ownManifest, 1);
  for (let index = 0; index < 6; index++) {
    const value: PerformanceTrial = { ...trial(index), scenario: startup ? 'populated-startup' : 'thread-open', processes: {
      renderer: performanceProcessReport(mode, 'renderer'), backend: performanceProcessReport(mode, 'backend'),
      ...(startup && { driver: performanceProcessReport(mode, 'driver') }),
    } };
    change(value);
    if (!startup) store.append(value);
    else {
      const own = path.join(output, `trial-${index}`); mkdirSync(own);
      writeFileSync(path.join(own, 'manifest.json'), JSON.stringify(ownManifest));
      writeFileSync(path.join(own, 'trial.json'), JSON.stringify(value));
      store.adopt(`trial-${index}/trial.json`);
    }
  }
  if (startup) store.save([{ phase: 'seed', exitCode: 0, signal: null }, ...Array.from({ length: 6 }, (_, index) => ({ phase: 'populated-startup', index, exitCode: 0, signal: null }))]);
  return output;
}
it('writes immutable raw trials and admits a compact run with the same scalar summary', () => {
  const output = complete();
  const run = readPerformanceRun(output, 1);
  expect(run.summary).toEqual({ measured: 1, passed: 1, unsuccessful: 0, medianMs: 6, minMs: 6, maxMs: 6 });
  expect(run.samples).toHaveLength(6);
  expect(readFileSync(path.join(output, 'results.json'), 'utf8')).not.toContain('observations');
  expect(JSON.parse(readFileSync(path.join(output, 'trial-0.trace.json'), 'utf8')).traceEvents).toHaveLength(2);
});
it('refuses incomplete runs, reordered writes and missing process captures', () => {
  const output = directory(); const store = createPerformanceRunStore(output, manifest, 1);
  expect(() => store.append(trial(1))).toThrow(/order/);
  expect(() => store.append({ ...trial(0), processes: {} })).toThrow();
  store.append(trial(0));
  expect(() => readPerformanceRun(output, 1)).toThrow(/Incomplete/);
  expect(() => store.append(trial(0))).toThrow(/order/);
  const invalid = complete();
  const file = path.join(invalid, 'results.json'); const index = JSON.parse(readFileSync(file, 'utf8'));
  index.records[0].file = '../trial-0.json'; writeFileSync(file, JSON.stringify(index));
  expect(() => readPerformanceRun(invalid, 1)).toThrow();
});
it('retains failed trials and marks a viewer export failure without losing raw evidence', () => {
  const output = directory(); const store = createPerformanceRunStore(output, manifest, 1);
  writeFileSync(path.join(output, 'trial-0.trace.json'), 'occupied');
  expect(() => store.append(trial(0))).toThrow(); store.save();
  expect(JSON.parse(readFileSync(path.join(output, 'results.json'), 'utf8')).status).toBe('failed');
  expect(JSON.parse(readFileSync(path.join(output, 'trial-0.json'), 'utf8')).index).toBe(0);
  const failed = directory(); const failureStore = createPerformanceRunStore(failed, manifest, 1);
  failureStore.append({ ...trial(0), scenario: 'populated-startup', correct: false, outcome: 'incomplete', completion: 'missing', durationMs: undefined, failure: 'missing-view-ready' });
  expect(JSON.parse(readFileSync(path.join(failed, 'trial-0.json'), 'utf8')).failure).toBe('missing-view-ready');
  expect(() => readPerformanceRun(failed, 1)).toThrow(/Incomplete/);
});
it('rejects raw tampering, forged summaries, symbolic links and oversized files before parsing', () => {
  for (const fault of ['raw', 'summary', 'symlink', 'size']) {
    const output = complete(); const file = path.join(output, fault === 'summary' ? 'results.json' : 'trial-0.json');
    if (fault === 'raw') writeFileSync(file, '{}');
    if (fault === 'summary') { const index = JSON.parse(readFileSync(file, 'utf8')); index.summary.medianMs = 1; writeFileSync(file, JSON.stringify(index)); }
    if (fault === 'symlink') { rmSync(file); symlinkSync(path.join(output, 'trial-1.json'), file); }
    if (fault === 'size') truncateSync(file, PERFORMANCE_TRIAL_BYTES + 1);
    expect(() => readPerformanceRun(output, 1)).toThrow();
  }
});
it('requires a successful startup process exit as well as correct trials', () => {
  const output = complete('lightweight', undefined, true);
  expect(readPerformanceRun(output, 1).scenario).toBe('populated-startup');
  const file = path.join(output, 'results.json'); const index = JSON.parse(readFileSync(file, 'utf8'));
  index.invocations[1].exitCode = 1;
  writeFileSync(file, JSON.stringify(index));
  expect(() => readPerformanceRun(output, 1)).toThrow(/lifecycle/);
});

it('requires distinct actual process identities before admitting a complete run', () => {
  for (const id of [undefined, 101]) {
    const output = complete('lightweight', value => { value.processes.backend!.processId = id; });
    expect(() => readPerformanceRun(output, 1)).toThrow(/process identity/);
  }
});
it.each([
  ['lightweight', 'backend', 'processStatistics'], ['lightweight', 'renderer', 'rendererStatistics'],
  ['lightweight', 'renderer', 'rendererLongTasks'], ['detailed', 'backend', 'profiles'],
  ['detailed', 'renderer', 'profiles'], ['detailed', 'driver', 'profiles'],
] as const)('rejects %s runs without the promised %s %s capture', (mode, role, missing) => {
  const output = complete(mode, value => { if (value.index === 0) delete value.processes[role]![missing]; }, role === 'driver');
  expect(() => readPerformanceRun(output, 1)).toThrow(/capture/i);
});
it('admits each recording mode and detailed startup, while refusing captures forbidden by that mode', () => {
  for (const mode of ['disabled', 'lightweight', 'detailed'] as const) expect(readPerformanceRun(complete(mode), 1).summary.passed).toBe(1);
  expect(readPerformanceRun(complete('detailed', undefined, true), 1).summary.passed).toBe(1);
  for (const mode of ['disabled', 'lightweight'] as const) {
    const output = complete(mode, value => { value.processes.backend!.profiles = performanceProcessReport('detailed', 'backend').profiles; });
    expect(() => readPerformanceRun(output, 1)).toThrow(/capture/i);
  }
});
it('requires the declared core renderer metrics, not just an empty resource envelope', () => {
  const output = complete('lightweight', value => { value.processes.renderer!.rendererStatistics!.metrics = []; });
  expect(() => readPerformanceRun(output, 1)).toThrow(/renderer resource capture/);
});

it('refuses inconsistent run inputs through the actual store and admission path', () => {
  for (const patch of [{ warmup: false }, { scenario: 'search' },
    { processes: { unrelated: report, renderer: report } },
    { processes: { renderer: { ...report, mode: 'disabled' }, backend: report } },
    { outcome: 'cancelled' }]) {
    const output = directory(); const store = createPerformanceRunStore(output, manifest, 1);
    expect(() => {
      for (let index = 0; index < 6; index++) store.append({ ...trial(index), ...(index === 1 ? patch : {}) });
      readPerformanceRun(output, 1);
    }).toThrow();
  }
});
it('rejects adopted child provenance changes and retains exactly one raw startup record', () => {
  const output = directory(); const store = createPerformanceRunStore(output, manifest, 1);
  const own = path.join(output, 'trial-0'); mkdirSync(own);
  const startup = { ...trial(0), scenario: 'populated-startup', processes: { ...trial(0).processes, driver: performanceProcessReport('lightweight', 'driver') } };
  expect(() => store.append(startup)).toThrow(/adopt/);
  expect(JSON.parse(readFileSync(path.join(output, 'results.json'), 'utf8')).records).toEqual([]);
  expect(() => readFileSync(path.join(output, 'trial-0.json'))).toThrow();
  writeFileSync(path.join(own, 'trial.json'), JSON.stringify(startup));
  writeFileSync(path.join(own, 'manifest.json'), JSON.stringify({ ...manifest, fixture: { ...manifest.fixture, seed: 7 } }));
  expect(() => store.adopt('trial-0/trial.json')).toThrow(/manifests/);
  writeFileSync(path.join(own, 'manifest.json'), JSON.stringify(manifest));
  store.adopt('trial-0/trial.json');
  const index = JSON.parse(readFileSync(path.join(output, 'results.json'), 'utf8'));
  expect(index.records[0].file).toBe('trial-0/trial.json');
  expect(() => readFileSync(path.join(output, 'trial-0.json'))).toThrow();
  expect(() => store.adopt('../trial.json')).toThrow(/path/);
});
