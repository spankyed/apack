import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createPerformanceRunStore, readPerformanceRun, PERFORMANCE_TRIAL_BYTES } from '../../src/performance/run.ts';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function directory() { const directory = mkdtempSync(path.join(tmpdir(), 'apack-run-store-')); directories.push(directory); return directory; }
const manifest = { format: 1, source: { revision: 'one', dirty: false, excludedUntracked: [], diffSha256: 'clean' },
  builds: [{ path: 'app', sha256: 'one' }], fixture: { generator: 'test', seed: 0, sha256: 'fixture', distribution: {} },
  native: { pin: 'native', checkoutRevision: 'native', dirty: false, excludedUntracked: [] }, mode: 'lightweight', cache: 'warm-process', warmups: 5,
  runtime: {}, machine: { platform: 'linux', arch: 'arm64', cpus: 2, memoryBytes: 1024, identity: 'machine' },
  clock: 'Local monotonic durations; cross-process epoch alignment is approximate' };
const report = { observations: [], bytes: 0, dropped: 0, truncated: false, rejected: 0, droppedMetadata: 0,
  mode: 'lightweight', active: 0, unfinished: 0, droppedStarts: 0, invalidCarriers: 0, detachFailures: 0, droppedEvents: 0,
  contextFailures: 0, rejectedStarts: 0, invalidAttributes: 0, complete: true };
const trial = (index: number) => ({ scenario: 'thread-open', index, warmup: index < 5, outcome: 'passed', durationMs: index + 1,
  correct: true, completion: 'view-ready', work: {}, processes: { renderer: { ...report, processId: 101 }, backend: { ...report, processId: 102 } } });
function complete() { const output = directory(); const store = createPerformanceRunStore(output, manifest, 1); for (let index = 0; index < 6; index++) store.append(trial(index)); return output; }
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
  failureStore.append({ ...trial(0), correct: false, outcome: 'incomplete', completion: 'missing', durationMs: undefined, failure: 'missing-view-ready' });
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
it('requires startup invocation ownership, phase order and successful exit as well as correct trials', () => {
  const output = directory(); const store = createPerformanceRunStore(output, manifest, 1);
  for (let index = 0; index < 6; index++) {
    const ownTrial = { ...trial(index), scenario: 'populated-startup', processes: { ...trial(index).processes, driver: { ...report, processId: 103 } } };
    store.append(ownTrial);
    const own = path.join(output, `trial-${index}`); mkdirSync(own);
    writeFileSync(path.join(own, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(path.join(own, 'results.json'), JSON.stringify({ trials: [ownTrial] }));
  }
  const invocations = [{ phase: 'seed', exitCode: 0, signal: null }, ...Array.from({ length: 6 }, (_, index) => ({ phase: 'populated-startup', index, exitCode: 0, signal: null }))];
  store.save(invocations); expect(readPerformanceRun(output, 1).scenario).toBe('populated-startup');
  store.save(invocations.map(item => ({ ...item, exitCode: 1 })));
  expect(() => readPerformanceRun(output, 1)).toThrow(/Incomplete/);
});

it('requires distinct actual process identities before admitting a complete run', () => {
  for (const missing of [true, false]) {
    const output = directory(); const store = createPerformanceRunStore(output, manifest, 1);
    for (let index = 0; index < 6; index++) store.append({ ...trial(index), processes: {
      renderer: { ...report, processId: 101 }, backend: { ...report, ...(missing ? {} : { processId: 101 }) },
    } });
    expect(() => readPerformanceRun(output, 1)).toThrow(/process identity/);
  }
});
