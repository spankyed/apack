import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, type AppDriver } from '@apackdev/testing';
import {
  attachRendererProcessIdentity, createPerformanceScenarioRun, finishPerformanceTrial,
  manifestSchema, performanceExecutionPolicy, performanceIdentity, performanceSchedule,
  trialSchema, waitForPerformanceTrial, type PerformanceManifest, type PerformanceScheduleEntry,
  type PerformanceTrial,
} from '@apackdev/testing/performance';
import type { PerformanceWindow } from './window.ts';
import { installViewCompletion } from './view-completion.ts';

type ScenarioResult = {
  completed: boolean;
  durationMs?: number;
  failure?: string;
  work: PerformanceTrial['work'];
  timings?: PerformanceTrial['timings'];
  reports: Awaited<ReturnType<PerformanceWindow['__performance']['stop']>>;
};

/** Warm scenarios own their fixture directory, provenance, journal and process acknowledgments. */
export async function createWarmScenario<F extends { identity: PerformanceManifest['fixture']; data: unknown }>(
  scenario: 'thread-open' | 'search' | 'streaming',
  makeFixture: (trials: number) => F,
  target: { app: AppDriver; appPage: Page; electronApp: ElectronApplication },
) {
  const mode = manifestSchema.shape.mode.parse(process.env.APACK_PERFORMANCE_MODE ?? 'lightweight');
  const measured = Number(process.env.APACK_PERFORMANCE_TRIALS ?? 20);
  const comparison = process.env.APACK_PERFORMANCE_COMPARE_MODE;
  const schedule = performanceSchedule(mode, measured, comparison);
  const fixture = makeFixture(schedule.length);
  const output = process.env.APACK_PERFORMANCE_RUN_OUTPUT ? path.resolve(process.env.APACK_PERFORMANCE_RUN_OUTPUT)
    : path.resolve('.apack/performance', `${scenario}-${mode}${comparison ? `-vs-${comparison}` : ''}-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  const { app, appPage, electronApp } = target;
  await appPage.evaluate(installViewCompletion);
  const runtime = await electronApp.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, appNode: process.versions.node, appV8: process.versions.v8 }));
  const manifest = performanceIdentity({ fixture: fixture.identity, mode, warmups: 5, cache: 'warm-process',
    runtime: { ...runtime, interactiveWindow: 'focused-v1', performancePolicy: performanceExecutionPolicy(comparison),
      ...(scenario === 'thread-open' && { threadReadiness: 'full-bodies-and-user-truncation-v1' }) } });
  const journal = createPerformanceScenarioRun(output, manifest, measured, comparison);
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-performance-fixture-'));
  return {
    fixture, directory, output, schedule,
    async importThreads(lastId: string) {
      writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify(fixture.data));
      await app.waitForSurface('default-setup/threads');
      await app.navigate('default-setup/threads');
      await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
      await appPage.waitForFunction(lastId => {
        const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context as unknown as { threadMap: Record<string, unknown> };
        return !!context.threadMap[lastId];
      }, lastId);
    },
    async begin(entry: PerformanceScheduleEntry) {
      await waitForPerformanceTrial(entry, { application: electronApp, page: appPage });
      journal.begin(entry);
    },
    async append(entry: PerformanceScheduleEntry, result: ScenarioResult, extra: { work?: PerformanceTrial['work']; failure?: string; backlog?: PerformanceTrial['backlog']; expectedFailure?: 'app-read-work-bound' | 'missing-view-ready' | 'renderer-resource-start' } = {}) {
      const { reports } = result;
      if (reports.renderer) {
        await attachRendererProcessIdentity(electronApp, appPage, reports.renderer);
        reports.complete &&= reports.renderer.complete;
      }
      const rejected = extra.failure !== undefined;
      const trial = trialSchema.parse({ scenario, index: entry.index, warmup: entry.warmup,
        work: extra.work ?? result.work, timings: result.timings, backlog: extra.backlog,
        outcome: rejected ? 'failed' : result.completed && reports.complete ? 'passed'
          : result.failure && result.failure !== 'missing-view-ready' ? 'failed' : 'incomplete',
        correct: result.completed && !rejected, completion: result.completed ? 'view-ready' : 'missing',
        durationMs: result.durationMs, failure: extra.failure ?? result.failure,
        processes: { ...(reports.renderer && { renderer: reports.renderer }), ...(reports.backend && { backend: reports.backend }) },
      });
      journal.append(entry, trial);
      if (extra.expectedFailure && extra.expectedFailure !== 'renderer-resource-start') {
        expect(Object.keys(trial.processes)).toHaveLength(2);
        expect(Object.values(trial.processes).every(report => report.complete)).toBe(true);
      }
      switch (extra.expectedFailure) {
        case 'app-read-work-bound':
          expect(trial).toMatchObject({ outcome: 'failed', correct: false, failure: 'app-read-work-bound' });
          expect(trial.work.windowAppResponseBytes).toBeGreaterThan(trial.work.maxAppResponseBytes!);
          break;
        case 'missing-view-ready':
          expect(trial).toMatchObject({ outcome: 'incomplete', correct: false, completion: 'missing', failure: 'missing-view-ready' });
          expect(trial.durationMs).toBeUndefined();
          expect(trial.work.observedMessages).toBe(50);
          break;
        case 'renderer-resource-start':
          expect(trial).toMatchObject({ outcome: 'incomplete', correct: true, completion: 'view-ready',
            processes: { renderer: { rendererResourceFailures: 1 }, backend: { complete: true } } });
          break;
        default: expect(trial.outcome, `Preserved evidence: ${output}`).toBe('passed');
      }
      await finishPerformanceTrial(entry, trial.outcome);
    },
    close() {
      try { journal.save(); }
      finally { rmSync(directory, { recursive: true, force: true }); }
    },
  };
}
