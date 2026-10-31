import { performanceManifest, performanceProcessReport } from './fixtures.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { performanceExecutionPolicy, waitForPerformanceTrial, finishPerformanceTrial } from '../../src/performance/gate.ts';
import { coordinatePerformanceRevisions } from '../../src/performance/revision.ts';
import { createPerformanceRevisionJournal, performanceRevisionSchedule, readPerformanceRevisionComparison } from '../../src/performance/comparison.ts';
import { createPerformanceRunStore } from '../../src/performance/run.ts';
const directories: string[] = [];
const timers: Array<ReturnType<typeof setInterval>> = [];
afterEach(() => { for (const timer of timers.splice(0)) clearInterval(timer); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function directory() { const result = mkdtempSync(path.join(tmpdir(), 'apack-revision-')); directories.push(result); return result; }
const entry = { variant: 'A' as const, mode: 'lightweight' as const, ordinal: 0, index: 0, warmup: true };
it('waits before work, validates permission, and acknowledges completion after the caller saves evidence', async () => {
  const own = directory(); vi.stubEnv('APACK_PERFORMANCE_GATE', JSON.stringify({ directory: own, deadline: Date.now() + 10_000, mode: 'lightweight', lastIndex: 6 }));
  expect(performanceExecutionPolicy()).toBe('paired-focused-revisions-v1');
  expect(() => performanceExecutionPolicy('detailed')).toThrow();
  const pending = waitForPerformanceTrial(entry);
  expect(existsSync(path.join(own, 'ready-0.json'))).toBe(true);
  await expect(finishPerformanceTrial(entry, 'passed')).rejects.toThrow();
  writeFileSync(path.join(own, 'permit-0.json'), JSON.stringify({ index: 0, mode: 'lightweight', lastIndex: 6 }));
  await pending; await finishPerformanceTrial(entry, 'passed');
  expect(JSON.parse(readFileSync(path.join(own, 'done-0.json'), 'utf8'))).toEqual({ index: 0, mode: 'lightweight', outcome: 'passed' });
});
it('refuses a stale coordinator and mismatched permission rather than silently running', async () => {
  for (const expired of [true, false]) {
    const own = directory(); vi.stubEnv('APACK_PERFORMANCE_GATE', JSON.stringify({ directory: own, deadline: Date.now() + (expired ? -1 : 10_000), mode: 'lightweight', lastIndex: 6 }));
    if (!expired) writeFileSync(path.join(own, 'permit-0.json'), JSON.stringify({ index: 1, mode: 'lightweight', lastIndex: 6 }));
    await expect(waitForPerformanceTrial(entry)).rejects.toThrow();
  }
  vi.stubEnv('APACK_PERFORMANCE_GATE', '');
  await waitForPerformanceTrial(entry); expect(performanceExecutionPolicy()).toBe('single-scenario-v1');
});
it('coordinates real file handshakes in ABBA order with two independently waiting workers', async () => {
  const output = directory(); const observed: string[] = [];
  for (const variant of ['A', 'B'] as const) {
    const own = path.join(output, 'coordination', variant); mkdirSync(own, { recursive: true }); let index = 0;
    const ready = () => writeFileSync(path.join(own, `ready-${index}.json`), JSON.stringify({ index, mode: 'lightweight', lastIndex: 6 })); ready();
    timers.push(setInterval(() => {
      if (index >= 7 || !existsSync(path.join(own, `permit-${index}.json`))) return;
      observed.push(variant); writeFileSync(path.join(own, `done-${index}.json`), JSON.stringify({ index, mode: 'lightweight', outcome: 'passed' }));
      if (++index < 7) ready();
    }, 1));
  }
  await coordinatePerformanceRevisions({ directory: output, mode: 'lightweight', measured: 2, deadline: Date.now() + 10_000, workers: () => ({}) });
  expect(observed).toEqual([...Array(5).fill('A'), ...Array(5).fill('B'), 'A', 'B', 'B', 'A']);
  expect(JSON.parse(readFileSync(path.join(output, 'execution.json'), 'utf8')).status).toBe('passed');
});
it('refuses an exited worker and a completion that predates its permission', async () => {
  for (const exited of [true, false]) {
    const output = directory(); const own = path.join(output, 'coordination/A'); mkdirSync(own, { recursive: true });
    if (!exited) { writeFileSync(path.join(own, 'ready-0.json'), JSON.stringify({ index: 0, mode: 'lightweight', lastIndex: 6 })); writeFileSync(path.join(own, 'done-0.json'), '{}'); }
    await expect(coordinatePerformanceRevisions({ directory: output, mode: 'lightweight', measured: 2, deadline: Date.now() + 10_000, workers: () => exited ? { A: { code: 0 } } : {} })).rejects.toThrow();
    expect(JSON.parse(readFileSync(path.join(output, 'execution.json'), 'utf8')).status).toBe('failed');
  }
});
const manifest = performanceManifest({ runtime: { performancePolicy: 'paired-focused-revisions-v1', node: 'one', electron: 'two' } });
it('admits differing clean revisions and rejects changed fixtures or failed process exits', () => {
  const output = directory(); const coordinator = createPerformanceRevisionJournal(output, 'lightweight', 2);
  const stores = { A: createPerformanceRunStore(path.join(output, 'A'), manifest, 2),
    B: createPerformanceRunStore(path.join(output, 'B'), { ...manifest, source: { ...manifest.source, revision: 'two' }, builds: [{ path: 'app', sha256: 'two' }], runtime: { electron: 'two', node: 'one', performancePolicy: 'paired-focused-revisions-v1' } }, 2) };
  for (const step of coordinator.schedule) {
    coordinator.begin(step); stores[step.variant].append({ scenario: 'search', index: step.index, warmup: step.warmup, outcome: 'passed', durationMs: 10, correct: true,
      completion: 'view-ready', work: {}, processes: { backend: performanceProcessReport('lightweight', 'backend'), renderer: performanceProcessReport('lightweight', 'renderer') } }); coordinator.end(step, 'passed');
  }
  for (const variant of ['A', 'B']) writeFileSync(path.join(output, variant, 'invocation.json'), JSON.stringify({ code: 0, timedOut: false, aborted: false }));
  expect(readPerformanceRevisionComparison(output, 2).medianChangePercent).toBe(0);
  writeFileSync(path.join(output, 'B/invocation.json'), JSON.stringify({ code: 1, timedOut: false, aborted: false }));
  expect(() => readPerformanceRevisionComparison(output, 2)).toThrow();
  writeFileSync(path.join(output, 'B/invocation.json'), JSON.stringify({ code: 0, timedOut: false, aborted: false }));
  const file = path.join(output, 'B/manifest.json'); const candidate = JSON.parse(readFileSync(file, 'utf8'));
  const mismatches = [
    { source: { ...candidate.source, dirty: true } },
    { native: { ...candidate.native, dirty: true } },
    { native: { ...candidate.native, checkoutRevision: 'other' } },
    { builds: [...candidate.builds, { path: 'vendor/elmdb/binding.node', sha256: 'changed' }] },
    { cache: 'fresh-process-warm-filesystem' },
    { fixture: { ...candidate.fixture, seed: 1 } },
  ];
  for (const patch of mismatches) {
    writeFileSync(file, JSON.stringify({ ...candidate, ...patch }));
    expect(() => readPerformanceRevisionComparison(output, 2)).toThrow();
  }
  // Equal native identities still cannot qualify if both workers used an unpinned checkout.
  for (const variant of ['A', 'B']) {
    const own = path.join(output, variant, 'manifest.json');
    const value = JSON.parse(readFileSync(own, 'utf8'));
    writeFileSync(own, JSON.stringify({ ...value, ...(variant === 'B' ? candidate : {}), native: { ...manifest.native, checkoutRevision: 'other' } }));
  }
  expect(() => readPerformanceRevisionComparison(output, 2)).toThrow(/pinned/);
  expect(performanceRevisionSchedule('lightweight', 20).filter(step => !step.warmup)).toHaveLength(40);
});

it('keeps the last worker alive until the coordinator releases both sources', async () => {
  const own = directory(); vi.stubEnv('APACK_PERFORMANCE_GATE', JSON.stringify({ directory: own, deadline: Date.now() + 10_000, mode: 'lightweight', lastIndex: 6 }));
  writeFileSync(path.join(own, 'permit-6.json'), JSON.stringify({ index: 6, mode: 'lightweight' }));
  let finished = false;
  const pending = finishPerformanceTrial({ ...entry, index: 6 }, 'passed').then(() => { finished = true; });
  expect(existsSync(path.join(own, 'done-6.json'))).toBe(true);
  expect(finished).toBe(false);
  writeFileSync(path.join(own, 'release.json'), JSON.stringify({ released: true }));
  await pending; expect(finished).toBe(true);
});

it('activates the permitted worker before its action so background throttling cannot bias a revision', async () => {
  const own = directory(); vi.stubEnv('APACK_PERFORMANCE_GATE', JSON.stringify({ directory: own, deadline: Date.now() + 10_000, mode: 'lightweight', lastIndex: 6 }));
  writeFileSync(path.join(own, 'permit-0.json'), JSON.stringify({ index: 0, mode: 'lightweight' }));
  const steps: string[] = [];
  const window = { show: () => steps.push('show'), focus: () => steps.push('focus'), webContents: { focus: () => steps.push('contents') } };
  const target = { application: { browserWindow: async () => ({ evaluate: async (fn: (window: unknown) => unknown) => fn(window), dispose: async () => { steps.push('dispose'); } }) },
    page: { waitForFunction: async () => { steps.push('focused'); } } } as unknown as NonNullable<Parameters<typeof waitForPerformanceTrial>[1]>;
  await waitForPerformanceTrial(entry, target);
  expect(steps).toEqual(['show', 'focus', 'contents', 'dispose', 'focused']);
});

it('refuses a successful early worker exit before releasing the final peer action', async () => {
  const output = directory();
  const workers: { A?: { code: number }; B?: { code: number } } = {};
  for (const variant of ['A', 'B'] as const) {
    const own = path.join(output, 'coordination', variant); mkdirSync(own, { recursive: true }); let index = 0;
    const ready = () => writeFileSync(path.join(own, `ready-${index}.json`), JSON.stringify({ index, mode: 'lightweight' })); ready();
    timers.push(setInterval(() => {
      if (index >= 7 || !existsSync(path.join(own, `permit-${index}.json`))) return;
      writeFileSync(path.join(own, `done-${index}.json`), JSON.stringify({ index, mode: 'lightweight', outcome: 'passed' }));
      if (variant === 'B' && index === 6) workers.B = { code: 0 };
      if (++index < 7) ready();
    }, 1));
  }
  await expect(coordinatePerformanceRevisions({ directory: output, mode: 'lightweight', measured: 2,
    deadline: Date.now() + 10_000, workers: () => workers })).rejects.toThrow(/exited before/);
  expect(existsSync(path.join(output, 'coordination/A/permit-6.json'))).toBe(false);
  expect(existsSync(path.join(output, 'coordination/A/release.json'))).toBe(false);
  expect(JSON.parse(readFileSync(path.join(output, 'execution.json'), 'utf8')).status).toBe('failed');
});
