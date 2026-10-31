import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@apackdev/testing';
import type { RecordingMode } from '@apackdev/host/diagnostics';
import { performanceIdentity, attachRendererProcessIdentity, createPerformanceScenarioRun, performanceSchedule, performanceExecutionPolicy, waitForPerformanceTrial, finishPerformanceTrial, trialSchema } from '@apackdev/testing/performance';
import { searchFixture } from './fixture.ts';
import type { PerformanceWindow } from './window.ts';

/** Own profile per worker/run; interactive trials deliberately share a warmed process and filesystem cache. */
test('search a populated corpus and apply only the current query results', async ({ app, appPage, electronApp }) => {
  const mode = (process.env.APACK_PERFORMANCE_MODE ?? 'lightweight') as RecordingMode;
  if (!['disabled', 'lightweight', 'detailed'].includes(mode)) throw Error('Invalid APACK_PERFORMANCE_MODE');
  const measured = Number(process.env.APACK_PERFORMANCE_TRIALS ?? 20);
  if (!Number.isSafeInteger(measured) || measured < 1 || measured > 100) throw Error('Trials must be between 1 and 100');
  const warmups = 5;
  const comparison = process.env.APACK_PERFORMANCE_COMPARE_MODE;
  const schedule = performanceSchedule(mode, measured, comparison);
  const fixture = searchFixture();
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-performance-fixture-'));
  const output = process.env.APACK_PERFORMANCE_RUN_OUTPUT ? path.resolve(process.env.APACK_PERFORMANCE_RUN_OUTPUT) : path.resolve('.apack/performance', `search-${mode}${comparison ? `-vs-${comparison}` : ''}-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  const runtime = await electronApp.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, appNode: process.versions.node, appV8: process.versions.v8 }));
  const manifest = performanceIdentity({ fixture: fixture.identity, mode, warmups, cache: 'warm-process', runtime: { ...runtime, performancePolicy: performanceExecutionPolicy(comparison) } });
  const journal = createPerformanceScenarioRun(output, manifest, measured, comparison);
  const save = () => journal.save();
  try {
    writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify(fixture.data));
    await app.waitForSurface('default-setup/threads');
    await app.navigate('default-setup/threads');
    await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    // Preparation is outside every measured interval. The public import need not invoke a model.
    await appPage.waitForFunction(() => {
      const actor = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads');
      const context = actor.getSnapshot().context as unknown as { threadMap: Record<string, unknown> };
      return !!context.threadMap['Thread-search-11'];
    });
    await appPage.evaluate(() => (window as unknown as PerformanceWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId: 'Thread-search-0' }] }));
    await appPage.locator('[data-message-id]').first().waitFor({ state: 'visible' });
    await appPage.keyboard.press(process.platform === 'darwin' ? 'Meta+e' : 'Control+e');
    await expect(appPage.getByTestId('message-search')).toBeVisible();
    for (const entry of schedule) {
      const { index, mode } = entry;
      await waitForPerformanceTrial(entry, { application: electronApp, page: appPage });
      journal.begin(entry);
      const thread = entry.ordinal % 2;
      const result = await appPage.evaluate(async ({ mode, thread, expectedTimestamps }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        await recording.start(mode);
        const started = performance.now();
        const action = recording.begin('app.search', { 'app.scenario': 'search', 'app.fixture': 'message-search-v1' })!;
        const target = `Thread-search-${thread}`;
        const query = ['quartzalpha', 'quartzbeta'][thread]!;
        const replaced = ['quartzbeta', 'quartzalpha'][thread]!;
        let completed = false;
        let durationMs: number | undefined;
        let lastDelivery: { subscription: string; delivery: number; commit: number } | undefined;
        let failure: string | undefined;
        const work: Record<string, number> = {};
        try {
          await new Promise<void>((resolve, reject) => {
            let checking = false;
            let delivered = false;
            let finished = false;
            const close = () => { clearTimeout(timeout); observer.disconnect(); detach(); };
            const check = async () => {
              if (checking || finished || !delivered) return;
              checking = true;
              try {
                await recording.flushView();
                if (finished) return;
                const context = win.applicationState.system.get('default-setup/threads').getSnapshot().context;
                const search = context.messageSearch;
                if (search.query !== query || search.searching) return;
                work.observedResults = search.results.length;
                work.expectedResults = expectedTimestamps.length;
                if (search.results.length > 20) throw Error('result-bound');
                const timestamps = new Set(search.results.map(result => result.timestamp));
                const shown = Array.from(document.querySelectorAll('[data-testid="message-search-result"]'));
                const correctRows = search.results.length === expectedTimestamps.length
                  && new Set(search.results.map(result => result.messageId)).size === expectedTimestamps.length
                  && timestamps.size === expectedTimestamps.length
                  && expectedTimestamps.every(timestamp => timestamps.has(timestamp))
                  && search.results.every(result => result.threadId === target);
                if (!correctRows) throw Error('result-correctness');
                if (shown.length !== expectedTimestamps.length || shown.some(element => element.getClientRects().length === 0)) return;
                if (shown.some(element => !element.textContent?.includes(query) || !element.textContent.includes(`Search fixture ${thread}`))) throw Error('result-correctness');
                const ready = action.within(() => recording.begin('app.view.ready', {
                  'app.generation': lastDelivery?.subscription ?? 'disabled', 'app.delivery': lastDelivery?.delivery ?? 0,
                  'app.commit': lastDelivery?.commit ?? 0, 'app.result_count': search.results.length,
                }));
                ready?.end();
                durationMs = performance.now() - started;
                completed = true;
                finished = true;
                close(); resolve();
              } catch (error) { finished = true; close(); reject(Error(error instanceof Error && ['result-bound', 'result-correctness'].includes(error.message) ? error.message : 'view-correctness')); }
              finally { checking = false; }
            };
            const detach = recording.onView(({ request, update }) => {
              const args = request.args as { query?: string } | undefined;
              if (request.ref !== 'default-setup/threads' || request.view !== 'messageSearch' || args?.query !== query || !update.ok) return;
              const metadata = update.diagnostics;
              if (mode !== 'disabled' && (!metadata || metadata.carrier.traceparent?.split('-')[1] !== action.carrier().traceparent?.split('-')[1])) return;
              delivered = true;
              lastDelivery = metadata ? { subscription: metadata.subscription, delivery: metadata.delivery, commit: update.commit } : undefined;
              void check();
            });
            const observer = new MutationObserver(() => { void check(); });
            observer.observe(document.body, { subtree: true, childList: true, characterData: true });
            const timeout = setTimeout(() => { finished = true; close(); reject(Error('missing-view-ready')); }, 15_000);
            try { action.within(() => win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'SEARCH_MESSAGES', query: replaced }, { type: 'SEARCH_MESSAGES', query }] })); }
            catch (error) { finished = true; close(); reject(error); }
          });
        } catch (error) { failure = error instanceof Error && ['view-correctness', 'result-bound', 'result-correctness'].includes(error.message) ? error.message : 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, lastDelivery, work };
      }, { mode, thread, expectedTimestamps: fixture.data.threads[thread]!.messages.slice(0, 20).map(message => message.timestamp) });
      if (result.reports.renderer) {
        await attachRendererProcessIdentity(electronApp, appPage, result.reports.renderer);
        result.reports.complete &&= result.reports.renderer.complete;
      }
      const trial = trialSchema.parse({ scenario: 'search', index, warmup: index < warmups,
        work: result.work, outcome: result.completed && result.reports.complete ? 'passed' : result.failure && result.failure !== 'missing-view-ready' ? 'failed' : 'incomplete',
        correct: result.completed, completion: result.completed ? 'view-ready' : 'missing', durationMs: result.durationMs,
        processes: { ...(result.reports.renderer && { renderer: result.reports.renderer }), ...(result.reports.backend && { backend: result.reports.backend }) }, failure: result.failure });
      journal.append(entry, trial);
      expect(trial.outcome, `Preserved evidence: ${output}`).toBe('passed');
      await finishPerformanceTrial(entry, trial.outcome);
    }
  } finally { save(); rmSync(directory, { recursive: true, force: true }); }
});
