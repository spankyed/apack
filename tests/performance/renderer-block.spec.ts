import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@apackdev/testing';
import type { PerformanceWindow } from './window.ts';

// Manual counterfactual: a deliberately blocked renderer must appear in that renderer's observations.
test('observes an injected renderer block as a long task and renderer task time', async ({ appPage }) => {
  const output = path.resolve('.apack/performance', `renderer-block-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  const result = await appPage.evaluate(async () => {
    const recording = (window as unknown as PerformanceWindow).__performance;
    await recording.start('lightweight');
    const action = recording.begin('app.dispatch', { 'app.scenario': 'renderer-block-counterfactual' })!;
    const started = performance.now();
    try { action.within(() => { while (performance.now() - started < 200) { /* Deliberate bounded synchronous block. */ } }); }
    finally { action.end(); }
    const blockedMs = performance.now() - started;
    // Let the blocked task finish so the browser can publish its long-task entry.
    await new Promise(resolve => setTimeout(resolve, 0));
    return { blockedMs, reports: await recording.stop() };
  });
  writeFileSync(path.join(output, 'counterfactual.json'), JSON.stringify(result, null, 2));
  expect(result.reports.complete, `Evidence: ${output}`).toBe(true);
  const renderer = result.reports.renderer!;
  expect(renderer.rendererLongTasks).toMatchObject({ supported: true, failures: 0 });
  expect(renderer.rendererLongTasks!.count).toBeGreaterThanOrEqual(1);
  expect(renderer.rendererLongTasks!.maxMs).toBeGreaterThanOrEqual(200);
  const task = renderer.rendererStatistics!.metrics.find(metric => metric.name === 'TaskDuration')!;
  expect(task.after - task.before).toBeGreaterThanOrEqual(0.2);
});
