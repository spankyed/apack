import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { performanceManifest, performanceProcessReport } from '../../apack-testing/tests/performance/fixtures.ts';
import { createWarmScenario } from '../../../tests/performance/scenario.ts';

vi.mock('@apackdev/testing/performance', async original => ({
  ...await original<typeof import('@apackdev/testing/performance')>(),
  performanceIdentity: vi.fn(options => performanceManifest(options)),
  attachRendererProcessIdentity: vi.fn(async () => {}),
}));
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
  const fixture = { identity: performanceManifest().fixture, data: { threads: [] } };
  const run = await createWarmScenario('thread-open', () => fixture, target as unknown as Parameters<typeof createWarmScenario>[2]);
  runs.push(run);
  return { run, target, fixture };
}
function result() {
  return { completed: true, durationMs: 10, work: {}, reports: { complete: true, renderer: performanceProcessReport('disabled', 'renderer'), backend: performanceProcessReport('disabled', 'backend') } };
}
it('owns import preparation and saves a successful raw trial before cleaning its fixture directory', async () => {
  const { run, target, fixture } = await scenario();
  await run.importThreads('last-thread');
  expect(JSON.parse(readFileSync(path.join(run.directory, 'exported-threads.json'), 'utf8'))).toEqual(fixture.data);
  expect(target.appPage.waitForFunction).toHaveBeenCalledWith(expect.any(Function), 'last-thread');
  const entry = run.schedule[0]!;
  await run.begin(entry); await run.append(entry, result());
  expect(JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'))).toMatchObject({ outcome: 'passed', correct: true, durationMs: 10, warmup: true });
  run.close();
  expect(existsSync(run.directory)).toBe(false);
  expect(existsSync(path.join(run.output, 'trial-0.json'))).toBe(true);
});
it('retains a work-bound refusal as a failed trial despite correct visible completion', async () => {
  const { run } = await scenario(); const entry = run.schedule[0]!;
  await run.begin(entry);
  await expect(run.append(entry, result(), { failure: 'app-read-work-bound', work: { windowAppResponseBytes: 100 } })).rejects.toThrow();
  expect(JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'))).toMatchObject({ outcome: 'failed', correct: false, completion: 'view-ready', failure: 'app-read-work-bound', work: { windowAppResponseBytes: 100 } });
});
it('retains missing completion without manufacturing a successful duration', async () => {
  const { run } = await scenario(); const entry = run.schedule[0]!;
  await run.begin(entry);
  await expect(run.append(entry, { ...result(), completed: false, durationMs: undefined, failure: 'missing-view-ready' })).rejects.toThrow();
  const trial = JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'));
  expect(trial).toMatchObject({ outcome: 'incomplete', correct: false, completion: 'missing' });
  expect(trial.durationMs).toBeUndefined();
});

it('admits an expected counterfactual assertion without relabelling its retained failure', async () => {
  const { run } = await scenario(); const entry = run.schedule[0]!;
  await run.begin(entry);
  await run.append(entry, { ...result(), completed: false, durationMs: undefined, failure: 'missing-view-ready', work: { observedMessages: 50 } }, { expectedFailure: 'missing-view-ready' });
  expect(JSON.parse(readFileSync(path.join(run.output, 'trial-0.json'), 'utf8'))).toMatchObject({ outcome: 'incomplete', correct: false, completion: 'missing' });
  expect(JSON.parse(readFileSync(path.join(run.output, 'execution.json'), 'utf8')).status).toBe('failed');
});
