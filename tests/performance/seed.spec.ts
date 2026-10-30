import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@apackdev/testing';
import { searchFixture } from './fixture.ts';
import type { PerformanceWindow } from './window.ts';

// Preparation only. The controller owns E2E_DATA_DIR and waits for this process to close before copying it.
test('prepare a populated startup profile outside measurement', async ({ app, appPage }) => {
  if (!process.env.E2E_DATA_DIR || !process.env.APACK_PERFORMANCE_SEED_REPORT) throw Error('Use the owned startup controller');
  const fixture = searchFixture();
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-startup-import-'));
  try {
    writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify(fixture.data));
    await app.waitForSurface('default-setup/threads');
    await app.navigate('default-setup/threads');
    await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    await expect.poll(() => appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context as unknown as { threadMap: Record<string, unknown> };
      return Object.keys(context.threadMap).filter(id => id.startsWith('Thread-search-')).length;
    })).toBe(fixture.data.threads.length);
    writeFileSync(process.env.APACK_PERFORMANCE_SEED_REPORT, JSON.stringify(fixture.identity, null, 2));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
