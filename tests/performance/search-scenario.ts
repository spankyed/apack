import { expect } from '@apackdev/testing';
import { searchFixture } from './fixture.ts';
import { createWarmScenario } from './scenario.ts';
import type { PerformanceWindow } from './window.ts';

/** Own profile per worker/run; interactive trials deliberately share a warmed process and filesystem cache. */
export async function searchScenario({ app, appPage, electronApp }: Parameters<typeof createWarmScenario>[2], refuseResources = false) {
  const run = await createWarmScenario('search', searchFixture, { app, appPage, electronApp });
  const { fixture, schedule } = run;
  try {
    await run.importThreads('Thread-search-11');
    await appPage.evaluate(() => (window as unknown as PerformanceWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId: 'Thread-search-0' }] }));
    await appPage.locator('[data-message-id]').first().waitFor({ state: 'visible' });
    await appPage.keyboard.press(process.platform === 'darwin' ? 'Meta+e' : 'Control+e');
    await expect(appPage.getByTestId('message-search')).toBeVisible();
    if (refuseResources) await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('performance:renderer:start');
      ipcMain.handle('performance:renderer:start', () => { throw Error('Injected renderer resource refusal'); });
    });
    for (const entry of schedule) {
      const { mode } = entry;
      await run.begin(entry);
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
          await win.__waitForPerformanceView({
            check: () => {
              const context = win.applicationState.system.get('default-setup/threads').getSnapshot().context;
              const search = context.messageSearch;
              if (search.query !== query || search.searching) return false;
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
              if (shown.length !== expectedTimestamps.length || shown.some(element => element.getClientRects().length === 0)) return false;
              if (shown.some(element => !element.textContent?.includes(query) || !element.textContent.includes(`Search fixture ${thread}`))) throw Error('result-correctness');
              const ready = action.within(() => recording.begin('app.view.ready', {
                'app.generation': lastDelivery?.subscription ?? 'disabled', 'app.delivery': lastDelivery?.delivery ?? 0,
                'app.commit': lastDelivery?.commit ?? 0, 'app.result_count': search.results.length,
              }));
              ready?.end();
              durationMs = performance.now() - started;
              completed = true;
              return true;
            },
            accept: ({ request, update }) => {
              const args = request.args as { query?: string } | undefined;
              if (request.ref !== 'default-setup/threads' || request.view !== 'messageSearch' || args?.query !== query || !update.ok) return false;
              const metadata = update.diagnostics;
              if (mode !== 'disabled' && (!metadata || metadata.carrier.traceparent?.split('-')[1] !== action.carrier().traceparent?.split('-')[1])) return false;
              lastDelivery = metadata ? { subscription: metadata.subscription, delivery: metadata.delivery, commit: update.commit } : undefined;
              return true;
            },
            dispatch: () => { action.within(() => win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'SEARCH_MESSAGES', query: replaced }, { type: 'SEARCH_MESSAGES', query }] })); },
            errors: ['result-bound', 'result-correctness'],
          });
        } catch (error) { failure = error instanceof Error && ['view-correctness', 'result-bound', 'result-correctness'].includes(error.message) ? error.message : 'missing-view-ready'; }
        finally { action.end(completed ? 'ok' : 'error'); }
        const reports = await recording.stop();
        return { completed, durationMs, reports, failure, lastDelivery, work };
      }, { mode, thread, expectedTimestamps: fixture.data.threads[thread]!.messages.slice(0, 20).map(message => message.timestamp) });
      await run.append(entry, result, { expectedFailure: refuseResources && mode !== 'disabled' ? 'renderer-resource-start' : undefined });
    }
  } finally { run.close(); }
}
