import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@apackdev/testing';
import type { createPerformanceController, RecordingMode } from '@apackdev/host/diagnostics';
import type { ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';
import { performanceIdentity } from '../../scripts/performance/identity.ts';
import { chromeTrace, summarize, trialSchema, type PerformanceTrial } from '../../scripts/performance/report.ts';
import { threadFixture } from './fixture.ts';

type Controller = ReturnType<typeof createPerformanceController>;
interface PerformanceWindow {
  __sendToSystem(system: string, event: Record<string, unknown>): void;
  __performance: {
    start(mode: RecordingMode): Promise<void>;
    begin: Controller['begin']; flushView(): Promise<void>;
    onView(listener: (delivery: { request: ViewRequest; update: ViewUpdate; generation: number; delivery: number }) => void): () => void;
    stop(): Promise<{ renderer?: Awaited<ReturnType<Controller['stop']>>; backend?: Awaited<ReturnType<Controller['stop']>>; complete: boolean }>;
  };
  applicationState: {
    send(event: Record<string, unknown>): void;
    system: { get(ref: string): { getSnapshot(): { context: { currentThread?: { id: string }; chatMessageIds: string[]; chatLimit: number } } } };
  };
}

/** Own profile per worker/run; interactive trials deliberately share a warmed process and filesystem cache. */
test('open a populated thread through the real transport and render its bounded page', async ({ app, appPage, electronApp }) => {
  const mode = (process.env.APACK_PERFORMANCE_MODE ?? 'lightweight') as RecordingMode;
  if (!['disabled', 'lightweight', 'detailed'].includes(mode)) throw Error('Invalid APACK_PERFORMANCE_MODE');
  const measured = Number(process.env.APACK_PERFORMANCE_TRIALS ?? 20);
  if (!Number.isSafeInteger(measured) || measured < 1 || measured > 100) throw Error('Trials must be between 1 and 100');
  const warmups = 5;
  const fixture = threadFixture();
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-performance-fixture-'));
  const output = path.resolve('.apack/performance', `thread-open-${mode}-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  const trials: PerformanceTrial[] = [];
  const runtime = await electronApp.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, appNode: process.versions.node, appV8: process.versions.v8 }));
  const manifest = performanceIdentity({ fixture: fixture.identity, mode, warmups, cache: 'warm-process', runtime });
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const save = () => {
    writeFileSync(path.join(output, 'results.json'), JSON.stringify({ format: 1, trials, summary: summarize(trials) }, null, 2));
    writeFileSync(path.join(output, 'trace.json'), JSON.stringify(chromeTrace(trials.flatMap(trial => Object.entries(trial.processes)
      .map(([process, report]) => ({ process: `${process}/trial-${trial.index}`, report }))))));
  };
  try {
    writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify(fixture.data));
    await app.waitForSurface('default-setup/threads');
    await app.navigate('default-setup/threads');
    await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    // Preparation is outside every measured interval. The public import need not invoke a model.
    await appPage.waitForFunction(() => {
      const actor = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads');
      const context = actor.getSnapshot().context as unknown as { threadMap: Record<string, unknown> };
      return !!context.threadMap['Thread-performance-1'];
    });
    for (let index = 0; index < warmups + measured; index++) {
      const thread = index % 2;
      const result = await appPage.evaluate(async ({ mode, thread }) => {
        const win = window as unknown as PerformanceWindow;
        const recording = win.__performance;
        await recording.start(mode);
        const started = performance.now();
        const action = recording.begin('app.thread.open', { 'app.scenario': 'thread-open', 'app.fixture': 'populated-threads-v1' })!;
        const target = `Thread-performance-${thread}`;
        const expected = `Fixture thread ${thread} message 99.`;
        let completed = false;
        let durationMs: number | undefined;
        let lastDelivery: { subscription: string; delivery: number; commit: number } | undefined;
        let failure: string | undefined;
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
                const elements = Array.from(document.querySelectorAll('[data-message-id]'));
                const shown = context.chatMessageIds.length === 50 && context.chatMessageIds.every(id => elements.some(element => element.getAttribute('data-message-id') === id && element.textContent?.includes(`Fixture thread ${thread} message `)))
                  && elements.some(element => element.textContent?.includes(expected));
                if (context.currentThread?.id !== target || !shown) return;
                if (context.chatMessageIds.length !== 50 || context.chatLimit !== 50) throw Error('page-bound');
                const ready = action.within(() => recording.begin('app.view.ready', {
                  'app.generation': lastDelivery?.subscription ?? 'disabled', 'app.delivery': lastDelivery?.delivery ?? 0,
                  'app.commit': lastDelivery?.commit ?? 0, 'app.result_count': context.chatMessageIds.length,
                }));
                ready?.end();
                durationMs = performance.now() - started;
                completed = true;
                finished = true;
                close(); resolve();
              } catch { finished = true; close(); reject(Error('view-correctness')); }
              finally { checking = false; }
            };
            const detach = recording.onView(({ request, update }) => {
              const args = request.args as { threadId?: string } | undefined;
              if (request.ref !== 'default-setup/threads' || request.view !== 'chat' || args?.threadId !== target || !update.ok) return;
              const metadata = update.diagnostics;
              if (mode !== 'disabled' && (!metadata || metadata.carrier.traceparent?.split('-')[1] !== action.carrier().traceparent?.split('-')[1])) return;
              delivered = true;
              lastDelivery = metadata ? { subscription: metadata.subscription, delivery: metadata.delivery, commit: update.commit } : undefined;
              void check();
            });
            const observer = new MutationObserver(() => { void check(); });
            observer.observe(document.body, { subtree: true, childList: true, characterData: true });
            const timeout = setTimeout(() => { finished = true; close(); reject(Error('missing-view-ready')); }, 15_000);
            try { action.within(() => win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId: target }] })); }
            catch (error) { finished = true; close(); reject(error); }
          });
        } catch (error) { failure = error instanceof Error && error.message === 'view-correctness' ? 'view-correctness' : 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, lastDelivery };
      }, { mode, thread });
      trials.push(trialSchema.parse({ scenario: 'thread-open', index, warmup: index < warmups,
        outcome: result.completed && result.reports.complete ? 'passed' : 'incomplete',
        correct: result.completed, completion: result.completed ? 'view-ready' : 'missing', durationMs: result.durationMs,
        processes: { ...(result.reports.renderer && { renderer: result.reports.renderer }), ...(result.reports.backend && { backend: result.reports.backend }) }, failure: result.failure }));
      save();
      expect(trials.at(-1)!.outcome, `Preserved evidence: ${output}`).toBe('passed');
    }
  } finally { save(); rmSync(directory, { recursive: true, force: true }); }
});
