import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, applicationLaunchStartedAt } from '@apackdev/testing';
import { createNodePerformanceController } from '@apackdev/host/diagnostics/node';
import type { RecordingMode } from '@apackdev/host/diagnostics';
import { chromeTrace, manifestSchema, performanceIdentity, attachRendererProcessIdentity, summarize, trialSchema } from '@apackdev/testing/performance';
import { searchFixture } from './fixture.ts';
import type { PerformanceWindow } from './window.ts';

const mode = (process.env.APACK_PERFORMANCE_MODE ?? 'lightweight') as RecordingMode;
if (!['disabled', 'lightweight', 'detailed'].includes(mode)) throw Error('Invalid recording mode');
let parent: ReturnType<typeof createNodePerformanceController>;
let action: NonNullable<ReturnType<typeof parent.begin>>;
const test = base.extend<{}, { startupRecording: void }>({
  // Playwright discovers fixture dependencies from this literal destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  startupRecording: [async ({}, use) => {
    if (!process.env.E2E_DATA_DIR || !process.env.APACK_PERFORMANCE_SEED_REPORT) throw Error('Use the owned startup controller');
    const previous = process.env.APACK_PERFORMANCE_STARTUP;
    parent = createNodePerformanceController(); parent.start(mode);
    await parent.ready();
    action = parent.begin('app.startup', { 'app.process': 'driver', 'app.scenario': 'populated-startup' })!;
    process.env.APACK_PERFORMANCE_STARTUP = JSON.stringify({ mode, carrier: action.carrier() });
    try { await use(); }
    finally {
      if (parent.snapshot()) {
        action.end('cancelled');
        const report = await parent.stop();
        const directory = process.env.APACK_PERFORMANCE_OUTPUT;
        if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'driver-failure.json'), JSON.stringify(report)); }
      }
      if (previous === undefined) delete process.env.APACK_PERFORMANCE_STARTUP;
      else process.env.APACK_PERFORMANCE_STARTUP = previous;
    }
  }, { scope: 'worker', auto: true }],
});

test('start a populated profile through admission to its initial usable thread view', async ({ appPage, electronApp }) => {
  const output = process.env.APACK_PERFORMANCE_OUTPUT!;
  if (!output) throw Error('Missing owned startup report directory');
  mkdirSync(output, { recursive: true });
  const index = Number(process.env.APACK_PERFORMANCE_INDEX);
  if (!Number.isSafeInteger(index) || index < 0) throw Error('Invalid trial index');
  const fixture = manifestSchema.shape.fixture.parse(JSON.parse(readFileSync(process.env.APACK_PERFORMANCE_SEED_REPORT!, 'utf8')));
  let correct = false;
  let failure: string | undefined;
  let durationMs: number | undefined;
  let phase = 'list-data';
  const work: Record<string, number> = { expectedThreads: fixture.distribution.threads! };
  try {
    await appPage.waitForFunction(expected => {
      const win = window as unknown as PerformanceWindow;
      const context = win.applicationState.system.get('default-setup/threads').getSnapshot().context as unknown as { threadIds: string[]; lists: { list: Array<{ id: string; topic: string }> } };
      const receipt = win.__performance.lastStartupView('default-setup/threads', 'list');
      return receipt?.ok && Array.from({ length: expected }, (_, index) => index).every(index =>
        context.threadIds.includes(`Thread-search-${index}`) && context.lists.list.some(row => row.id === `Thread-search-${index}` && row.topic === `Search fixture ${index}`));
    }, fixture.distribution.threads);
    phase = 'restored-chat';
    const expected = searchFixture().data.threads[11]!.messages.slice(-50).map(message => message.text);
    await appPage.waitForFunction(expected => {
      const win = window as unknown as PerformanceWindow;
      const context = win.applicationState.system.get('default-setup/threads').getSnapshot().context;
      const receipt = win.__performance.lastStartupView('default-setup/threads', 'chat');
      return receipt?.ok && receipt.entityId === 'Thread-search-11' && context.currentThread?.id === receipt.entityId
        && context.chatLimit === 50 && context.chatMessageIds.length === expected.length
        && context.chatMessageIds.every((id, index) => {
          const element = document.querySelector(`[data-message-id="${id}"]`);
          return context.messageContents[id]?.text === expected[index] && element?.getClientRects().length
            && element.textContent?.includes(expected[index]!.trimEnd());
        });
    }, expected);
    work.observedMessages = expected.length;
    phase = 'view-revision';
    const receipt = await appPage.evaluate(async () => {
      const recording = (window as unknown as PerformanceWindow).__performance;
      await recording.flushView();
      const receipt = recording.lastStartupView('default-setup/threads', 'chat');
      if (!receipt?.ok) throw Error('Missing initial thread view revision');
      recording.withinStartup(() => recording.begin('app.view.ready', {
        'app.commit': receipt.commit, 'app.generation': receipt.subscription ?? 'disabled', 'app.delivery': receipt.delivery ?? 0,
      })!.end());
      return receipt;
    });
    work.observedThreads = fixture.distribution.threads!;
    work.initialViewCommit = receipt.commit;
    durationMs = performance.now() - applicationLaunchStartedAt(electronApp);
    correct = true;
  } catch {
    failure = `missing-startup-${phase}`;
    const state = await appPage.evaluate(() => {
      const win = window as unknown as PerformanceWindow;
      const snapshot = win.applicationState.getSnapshot();
      const context = win.applicationState.system.get('default-setup/threads').getSnapshot().context;
      return { currentThread: context.currentThread?.id, chatLimit: context.chatLimit, messages: context.chatMessageIds.length,
        chatReceipt: win.__performance.lastStartupView('default-setup/threads', 'chat'), applicationState: snapshot.value, panelSizes: snapshot.context.panelSizes, targetView: snapshot.context.targetView,
        mainListRows: document.querySelectorAll('.thread-row').length,
        expectedTitleElements: document.querySelectorAll('[title="Search fixture 11"]').length };
    });
    writeFileSync(path.join(output, 'readiness-failure.json'), JSON.stringify(state, null, 2));
    await appPage.screenshot({ path: path.join(output, 'readiness-failure.png') });
  }
  action.end(correct ? 'ok' : 'error');
  const reports = await appPage.evaluate(() => (window as unknown as PerformanceWindow).__performance.stop());
  const driver = await parent.stop();
  if (reports.renderer) {
    await attachRendererProcessIdentity(electronApp, appPage, reports.renderer);
    reports.complete &&= reports.renderer.complete;
  }
  // Provenance hashing is outside launch-to-view readiness and every resource recording.
  const runtime = await electronApp.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, appNode: process.versions.node, appV8: process.versions.v8 }));
  const manifest = performanceIdentity({ fixture, mode, runtime: { ...runtime, performancePolicy: process.env.APACK_PERFORMANCE_EXECUTION_POLICY ?? 'single-scenario-v1' }, cache: 'fresh-process-warm-filesystem', warmups: 5 });
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const backend = reports.backend;
  if (correct && mode !== 'disabled' && !backend?.observations.some(value => JSON.parse(value).name === 'app.index.admission')) {
    correct = false; failure = 'missing-admission-observation';
  }
  const trial = trialSchema.parse({ scenario: 'populated-startup', index, warmup: index < 5, work,
    outcome: correct && reports.complete && driver.complete ? 'passed' : 'incomplete', correct,
    completion: correct ? 'view-ready' : 'missing', durationMs: correct ? durationMs : undefined, failure,
    processes: { driver, ...(reports.renderer && { renderer: reports.renderer }), ...(backend && { backend }) },
  });
  writeFileSync(path.join(output, 'results.json'), JSON.stringify({ format: 1, trials: [trial], summary: summarize([trial]) }, null, 2));
  writeFileSync(path.join(output, 'trace.json'), JSON.stringify(chromeTrace(Object.entries(trial.processes).map(([process, report]) => ({ process, report })))));
  expect(trial.outcome).toBe('passed');
});
