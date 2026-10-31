import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@apackdev/testing';
import { searchFixture } from './fixture.ts';
import type { PerformanceWindow } from './window.ts';

// Controlled application counterfactual, not a latency sample. Transport callback generations have
// separate contract tests; this deliberately reaches the actor to prove its own stale-query guard.
test('a late old result cannot replace current search results, including after cancellation', async ({ app, appPage }) => {
  const fixture = searchFixture();
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-search-supersession-'));
  try {
    writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify(fixture.data));
    await app.waitForSurface('default-setup/threads');
    await app.navigate('default-setup/threads');
    await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    await appPage.waitForFunction(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context as unknown as { threadMap: Record<string, unknown> };
      return !!context.threadMap['Thread-search-11'];
    });
    const stale = await appPage.evaluate(async () => {
      const win = window as unknown as PerformanceWindow;
      const actor = win.applicationState.system.get('default-setup/threads');
      win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'SEARCH_MESSAGES', query: 'quartzalpha' }] });
      await new Promise<void>((resolve, reject) => {
        const started = performance.now();
        const poll = () => {
          const search = actor.getSnapshot().context.messageSearch;
          if (search.query === 'quartzalpha' && !search.searching && search.results.length === 20) return resolve();
          if (performance.now() - started > 10_000) return reject(Error('Missing old query result'));
          setTimeout(poll, 10);
        };
        poll();
      });
      return actor.getSnapshot().context.messageSearch.results;
    });
    const dispatch = (query: string) => appPage.evaluate(query => (window as unknown as PerformanceWindow).applicationState.send({
      type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'SEARCH_MESSAGES', query }],
    }), query);
    await dispatch('quartzbeta');
    await expect.poll(() => appPage.evaluate(() => {
      const search = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context.messageSearch;
      return search.query === 'quartzbeta' && !search.searching && search.results.length === 20 && search.results.every(row => row.threadId === 'Thread-search-1');
    })).toBe(true);
    for (const cancelled of [false, true]) {
      if (cancelled) await dispatch('');
      const search = await appPage.evaluate(async stale => {
        const win = window as unknown as PerformanceWindow;
        const actor = win.applicationState.system.get('default-setup/threads');
        actor.send({ type: 'SEARCH.READ', query: 'quartzalpha', results: stale });
        await win.__performance.flushView();
        return actor.getSnapshot().context.messageSearch;
      }, stale);
      expect(search.query).toBe(cancelled ? '' : 'quartzbeta');
      expect(search.searching).toBe(false);
      expect(search.results).toHaveLength(cancelled ? 0 : 20);
      expect(search.results.every(row => row.threadId === 'Thread-search-1')).toBe(true);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
