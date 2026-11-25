// The window keeps working across an API crash: main restarts the API, and the window's client establishes its bus
// subscription again, on the same port or on the one main reports the restarted API moved to.
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

const API_SERVICE_NAME = 'apack API Server';

/** The API process: the app's Electron `UtilityProcess` running the API server. */
async function apiPid(electronApp: ElectronApplication): Promise<number> {
  const pid = await electronApp.evaluate(({ app }, serviceName) => {
    const metric = app.getAppMetrics().find(
      (m) => m.type === 'Utility' && (m.name === serviceName || m.serviceName === serviceName),
    );
    return metric?.pid;
  }, API_SERVICE_NAME);
  if (pid === undefined) {
    throw new Error(`No API UtilityProcess named "${API_SERVICE_NAME}" runs under the app`);
  }
  return pid;
}

const shell = (page: Page) => page.evaluate(() => {
  const snapshot = (window as unknown as { applicationState: { getSnapshot(): { context: { busSubscribed: boolean }; matches(state: string): boolean } } })
    .applicationState.getSnapshot();
  return { busSubscribed: snapshot.context.busSubscribed, failed: snapshot.matches('error') };
});

test('subscribes to the bus again once the API it lost is restarted', async ({ appPage, electronApp }) => {
  await expect.poll(async () => (await shell(appPage)).busSubscribed).toBe(true);

  const crashed = await apiPid(electronApp);
  // Only the app under test's own API utility process: never a broad kill
  process.kill(crashed, 'SIGKILL');

  await expect.poll(async () => (await shell(appPage)).busSubscribed).toBe(false);
  await expect.poll(async () => (await shell(appPage)).busSubscribed).toBe(true);
  expect(await apiPid(electronApp), 'main started a new API process').not.toBe(crashed);
  expect((await shell(appPage)).failed, 'the window never fell to the error page').toBe(false);
});
