// The window keeps working across an API crash: main restarts the API, and the window's client establishes its bus
// subscription again, on the same port or on the one main reports the restarted API moved to.
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

/** The API process: the app's main process's child running the API server */
function apiPid(mainPid: number): number {
  for (const row of execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf-8' }).split('\n')) {
    const match = row.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (match && Number(match[2]) === mainPid && match[3].includes('server.js')) return Number(match[1]);
  }
  throw new Error(`No API process runs under the app's main process (${mainPid})`);
}

const shell = (page: Page) => page.evaluate(() => {
  const snapshot = (window as unknown as { applicationState: { getSnapshot(): { context: { busSubscribed: boolean }; matches(state: string): boolean } } })
    .applicationState.getSnapshot();
  return { busSubscribed: snapshot.context.busSubscribed, failed: snapshot.matches('error') };
});

test('subscribes to the bus again once the API it lost is restarted', async ({ appPage, electronApp }) => {
  const mainPid = electronApp.process().pid!;
  await expect.poll(async () => (await shell(appPage)).busSubscribed).toBe(true);

  const crashed = apiPid(mainPid);
  // Only the app under test's own API child: never a broad kill
  process.kill(crashed, 'SIGKILL');

  await expect.poll(async () => (await shell(appPage)).busSubscribed).toBe(false);
  await expect.poll(async () => (await shell(appPage)).busSubscribed).toBe(true);
  expect(apiPid(mainPid), 'main started a new API process').not.toBe(crashed);
  expect((await shell(appPage)).failed, 'the window never fell to the error page').toBe(false);
});
