import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { test, expect } from '@apackdev/testing';
import { performanceIdentity } from '@apackdev/testing/performance';
import { searchFixture } from './fixture.ts';
import type { PerformanceWindow } from './window.ts';

// Explicit diagnostic queries outside action timing: explain executes the native ids terminal.
// It does not explain projection/codec work, and visited counts may include index entries.
test('retains payload-free native stage evidence for the scenario query shapes', async ({ app, appPage, electronApp }) => {
  const fixture = searchFixture();
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-query-plans-'));
  const output = path.resolve('.apack/performance', `query-plans-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  try {
    writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify(fixture.data));
    await app.waitForSurface('default-setup/threads');
    await app.navigate('default-setup/threads');
    await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    await appPage.waitForFunction(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context as unknown as { threadMap: Record<string, unknown> };
      return !!context.threadMap['Thread-search-11'];
    });
    await app.waitForSurface('default-setup/database');
    await app.navigate('default-setup/database');
    await appPage.evaluate(() => (window as unknown as PerformanceWindow).applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/database', events: [{
      type: 'QUERY.EXECUTE', code: `
        const probes = [
          ['thread-page', query.ids('Thread-search-11').out(EARS.RelKind.CONTAINS, EARS.Entity.Message).reverse().limit(54)],
          ['search', query(EARS.Entity.Message).search('quartzalpha', { prefix: true, recency: { field: 'timestamp', halfLife: 604800000 } }).limit(20)],
        ];
        return { marker: 'application-performance-query-plans', plans: probes.map(([name, query]) => {
          const explanation = query.explain();
          return { name, returned: explanation.ids.length, visited: explanation.visited, ms: explanation.ms, stages: explanation.stages };
        }) };
      `,
    }] }));
    await expect.poll(() => appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/database').getSnapshot().context as unknown as { queryResult?: { marker?: string } };
      return context.queryResult?.marker;
    })).toBe('application-performance-query-plans');
    const result = await appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/database').getSnapshot().context as unknown as { queryResult?: unknown };
      return context.queryResult;
    });
    const count = z.number().int().nonnegative();
    const stage = z.object({ stage: z.string().max(128), index: z.string().max(128).optional(), visited: count, kept: count, ms: z.number().finite().nonnegative() }).strict();
    const evidence = z.object({ marker: z.literal('application-performance-query-plans'), plans: z.array(z.object({ name: z.enum(['thread-page', 'search']),
      returned: count, visited: count, ms: z.number().finite().nonnegative(), stages: z.array(stage).min(1).max(64) }).strict()).length(2) }).strict().parse(result);
    const runtime = await electronApp.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, appNode: process.versions.node, appV8: process.versions.v8 }));
    const manifest = performanceIdentity({ fixture: fixture.identity, mode: 'disabled', cache: 'warm-process', warmups: 0, runtime });
    writeFileSync(path.join(output, 'plans.json'), JSON.stringify({ manifest, evidence,
      scope: 'Explicit native ids-terminal probes outside measured actions; not projection/codec timings',
      visitedUnit: 'native stage-defined counters; not exhaustive physical work or unique rows' }, null, 2));
    expect(evidence.plans.map(plan => [plan.name, plan.returned])).toEqual([['thread-page', 54], ['search', 20]]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
