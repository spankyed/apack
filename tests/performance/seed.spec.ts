import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@apackdev/testing';
import { performanceIdentity, manifestSchema } from '@apackdev/testing/performance';
import { searchFixture } from './fixture.ts';
import { performanceStorageFormat } from './storage-identity.ts';
import type { PerformanceWindow } from './window.ts';

// Preparation only. The controller owns E2E_DATA_DIR and waits for this process to close before copying it.
test('prepare a populated startup profile outside measurement', async ({ app, appPage, electronApp }) => {
  if (!process.env.E2E_DATA_DIR || !process.env.APACK_PERFORMANCE_SEED_REPORT) throw Error('Use the owned startup controller');
  const fixture = searchFixture();
  const directory = mkdtempSync(path.join(tmpdir(), 'apack-startup-import-'));
  try {
    writeFileSync(path.join(directory, 'exported-threads.json'), JSON.stringify(fixture.data));
    await app.waitForSurface('default-setup/threads');
    await app.navigate('default-setup/threads');
    // The shared fixture dismisses the onboarding overlay, but does not persist completion.
    // Finish the real flow before cloning the profile before preparing the chat that each measured boot restores.
    await appPage.getByText("Let's go", { exact: true }).click();
    await expect.poll(() => appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
      return Object.entries(context.messageContents).find(([, message]) => message.text?.includes('No existing sessions found.'))?.[0];
    })).toBeTruthy();
    await appPage.evaluate(() => {
      const win = window as unknown as PerformanceWindow;
      const context = win.applicationState.system.get('default-setup/threads').getSnapshot().context;
      const messageId = Object.entries(context.messageContents).find(([, message]) => message.text?.includes('No existing sessions found.'))?.[0];
      if (!messageId) throw Error('Missing onboarding project prompt');
      win.applicationState.send({ type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'RESPOND_TO_BLOCK_INTERACTION', messageId, response: 'skip' }] });
    });
    await expect.poll(() => appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
      return Object.values(context.messageContents).some(message => message.text?.startsWith("You're all setup!"));
    })).toBe(true);
    await appPage.evaluate(directory => (window as unknown as PerformanceWindow).__sendToSystem('default-setup/threads', { type: 'IMPORT_THREADS', directory }), directory);
    await expect.poll(() => appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context as unknown as { threadMap: Record<string, unknown> };
      return Object.keys(context.threadMap).filter(id => id.startsWith('Thread-search-')).length;
    })).toBe(fixture.data.threads.length);
    await appPage.evaluate(() => (window as unknown as PerformanceWindow).applicationState.send({
      type: 'SEND_TO_SURFACE', surface: 'default-setup/threads', events: [{ type: 'OPEN_THREAD_CHAT', threadId: 'Thread-search-11' }],
    }));
    await expect.poll(() => appPage.evaluate(() => {
      const context = (window as unknown as PerformanceWindow).applicationState.system.get('default-setup/threads').getSnapshot().context;
      return context.currentThread?.id === 'Thread-search-11' && context.chatMessageIds.length === 50;
    })).toBe(true);
    writeFileSync(process.env.APACK_PERFORMANCE_SEED_REPORT, JSON.stringify(fixture.identity, null, 2));
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const storageFormat = performanceStorageFormat(userData, process.env.APACK_STORAGE_FORMAT ?? 'elmdb/1');
    const runtime = await electronApp.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, appNode: process.versions.node, appV8: process.versions.v8 }));
    const manifest = performanceIdentity({ fixture: fixture.identity, mode: manifestSchema.shape.mode.parse(process.env.APACK_PERFORMANCE_MODE ?? 'lightweight'),
      cache: 'fresh-process-warm-filesystem', warmups: 5, runtime: { ...runtime, storageFormat, performancePolicy: process.env.APACK_PERFORMANCE_EXECUTION_POLICY ?? 'single-scenario-v1' } });
    writeFileSync(`${process.env.APACK_PERFORMANCE_SEED_REPORT}.manifest.json`, JSON.stringify(manifest, null, 2));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
