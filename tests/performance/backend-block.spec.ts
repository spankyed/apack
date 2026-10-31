import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@apackdev/testing';
import { chromeTrace } from '@apackdev/testing/performance';
import type { PerformanceWindow } from './window.ts';

// Deliberate manual counterfactual, never an ordinary CI latency threshold. The console executes this
// bounded CPU workload in the actual backend; its returned CPU charge must appear in that process's totals.
test('attributes an injected CPU block to the backend process', async ({ app, appPage, electronApp }) => {
  await app.waitForSurface('default-setup/database');
  await app.navigate('default-setup/database');
  const mainPid = await electronApp.evaluate(() => process.pid);
  const output = path.resolve('.apack/performance', `backend-block-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  await appPage.evaluate(() => (window as unknown as PerformanceWindow).__performance.start('lightweight'));
  try {
    await appPage.evaluate(() => {
      const win = window as unknown as PerformanceWindow;
      const action = win.__performance.begin('app.dispatch', { 'app.scenario': 'backend-block-counterfactual' })!;
      try {
        action.within(() => win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/database', events: [{
          type: 'QUERY.EXECUTE', code: `
            const baseline = process.cpuUsage();
            const deadline = Date.now() + 5000;
            let used;
            do { used = process.cpuUsage(baseline); }
            while (used.user + used.system < 200000 && Date.now() < deadline);
            return { marker: 'performance-backend-block', pid: process.pid, cpuMicros: used.user + used.system };
          `,
        }] }));
      } finally { action.end(); }
    });
    await expect.poll(() => appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/database').getSnapshot().context as unknown as { queryResult?: { marker?: string }; error?: string };
      return context.queryResult?.marker;
    })).toBe('performance-backend-block');
  } finally {
    const reply = await appPage.evaluate(() => {
      const win = window as unknown as PerformanceWindow;
      const context = win.applicationState.system.get('default-setup/database').getSnapshot().context as unknown as { queryResult?: { marker?: string; pid?: number; cpuMicros?: number } };
      return context.queryResult;
    });
    const reports = await appPage.evaluate(() => (window as unknown as PerformanceWindow).__performance.stop());
    const statistics = reports.backend?.processStatistics;
    writeFileSync(path.join(output, 'counterfactual.json'), JSON.stringify({ fixture: 'backend-cpu-block-v1', mainPid, reply, reports }, null, 2));
    writeFileSync(path.join(output, 'trace.json'), JSON.stringify(chromeTrace(Object.entries({ renderer: reports.renderer, backend: reports.backend })
      .filter(([, report]) => report).map(([process, report]) => ({ process, report })))));
    expect(reports.complete, `Evidence: ${output}`).toBe(true);
    expect(reply?.pid).not.toBe(mainPid);
    expect(reports.backend?.processId).toBe(reply?.pid);
    expect(reply?.cpuMicros).toBeGreaterThanOrEqual(200000);
    expect(statistics).toBeDefined();
    expect(statistics!.cpuUserMicros + statistics!.cpuSystemMicros).toBeGreaterThanOrEqual(reply!.cpuMicros!);
  }
});
