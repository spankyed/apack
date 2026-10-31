import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PerformanceManifest, PerformanceTrial } from '@apackdev/testing/performance';
import { createWarmScenario } from '../../../tests/performance/scenario.ts';

vi.mock('@apackdev/testing/performance', async original => ({
  ...await original<typeof import('@apackdev/testing/performance')>(),
  performanceIdentity: vi.fn(options => ({ ...manifest, ...options })),
  attachRendererProcessIdentity: vi.fn(async () => {}),
}));
const manifest: PerformanceManifest = {
  format: 1, source: { revision: 'test', dirty: false, excludedUntracked: [], diffSha256: 'clean' },
  builds: [{ path: 'app', sha256: 'test' }], fixture: { generator: 'test', seed: 0, sha256: 'fixture', distribution: {} },
  native: { pin: 'test', checkoutRevision: 'test', dirty: false, excludedUntracked: [] },
  mode: 'disabled', cache: 'warm-process', warmups: 5, runtime: {},
  machine: { platform: 'test', arch: 'test', cpus: 2, memoryBytes: 1024, identity: 'test' },
  clock: 'Local monotonic durations; cross-process epoch alignment is approximate',
};
const report: PerformanceTrial['processes'][string] = {
  observations: [], bytes: 0, dropped: 0, truncated: false, rejected: 0, droppedMetadata: 0,
  mode: 'disabled', active: 0, unfinished: 0, droppedStarts: 0, invalidCarriers: 0, detachFailures: 0,
  droppedEvents: 0, contextFailures: 0, rejectedStarts: 0, invalidAttributes: 0, complete: true,
};
const outputs: string[] = [];
const runs: Array<Awaited<ReturnType<typeof createWarmScenario>>> = [];
beforeEach(() => {
  vi.stubEnv('APACK_PERFORMANCE_MODE', 'disabled');
  vi.stubEnv('APACK_PERFORMANCE_TRIALS', '1');
  vi.stubEnv('APACK_PERFORMANCE_COMPARE_MODE', undefined);
  vi.stubEnv('APACK_PERFORMANCE_GATE', undefined);
  const output = mkdtempSync(path.join(tmpdir(), 'apack-scenario-'));
  outputs.push(output); vi.stubEnv('APACK_PERFORMANCE_RUN_OUTPUT', output);
});
afterEach(() => {
  for (const run of runs.splice(0)) run.close();
  for (const output of outputs.splice(0)) rmSync(output, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.clearAllMocks();
});
async function scenario() {
  const target = {
    electronApp: { evaluate: vi.fn(async () => ({ electron: 'one' })) },
    appPage: { evaluate: vi.fn(async () => {}), waitForFunction: vi.fn(async () => {}) },
    app: { waitForSurface: vi.fn(async () => {}), navigate: vi.fn(async () => {}) },
  };
  const fixture = { identity: manifest.fixture, data: { threads: [] } };
  const run = await createWarmScenario('thread-open', () => fixture, target as unknown as Parameters<typeof createWarmScenario>[2]);
  runs.push(run);
  return run;
}
function result() {
  return { completed: true, durationMs: 10, work: {}, reports: { complete: true, renderer: { ...report, processId: 101 }, backend: { ...report, processId: 102 } } };
}
it('retains successful evidence after cleaning its owned fixture directory', async () => {
  const run = await scenario();
  const entry = run.schedule[0]!;
  await run.begin(entry); await run.append(entry, result());
  expect(JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'))).toMatchObject({ outcome: 'passed', correct: true, durationMs: 10, warmup: true });
  run.close();
  expect(existsSync(run.directory)).toBe(false);
  expect(existsSync(path.join(run.output, 'trial-0.json'))).toBe(true);
});
it('retains a work-bound refusal as a failed trial despite correct visible completion', async () => {
  const run = await scenario(); const entry = run.schedule[0]!;
  await run.begin(entry);
  await expect(run.append(entry, result(), { failure: 'app-read-work-bound', work: { windowAppResponseBytes: 100 } })).rejects.toThrow();
  expect(JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'))).toMatchObject({ outcome: 'failed', correct: false, completion: 'view-ready', failure: 'app-read-work-bound', work: { windowAppResponseBytes: 100 } });
});
it('retains missing completion without manufacturing a successful duration', async () => {
  const run = await scenario(); const entry = run.schedule[0]!;
  await run.begin(entry);
  await expect(run.append(entry, { ...result(), completed: false, durationMs: undefined, failure: 'missing-view-ready' })).rejects.toThrow();
  const trial = JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'));
  expect(trial).toMatchObject({ outcome: 'incomplete', correct: false, completion: 'missing' });
  expect(trial.durationMs).toBeUndefined();
});

it('admits an expected counterfactual assertion without relabelling its retained failure', async () => {
  const run = await scenario(); const entry = run.schedule[0]!;
  await run.begin(entry);
  await run.append(entry, { ...result(), completed: false, durationMs: undefined, failure: 'missing-view-ready', work: { observedMessages: 50 } }, { expectedFailure: 'missing-view-ready' });
  expect(JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'))).toMatchObject({ outcome: 'incomplete', correct: false, completion: 'missing' });
  expect(JSON.parse(readFileSync(path.join(run.output, 'execution.json'), 'utf8')).status).toBe('failed');
});
