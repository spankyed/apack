// Direct MessageChannelMain port brokering across Electron main, preload, and the API UtilityProcess:
// the renderer owns the window's single direct transport via backendPort.connect(), observes immediate
// disconnect when the API UtilityProcess crashes (SIGKILL), automatically reconnects on a fresh generation
// when main restarts it, and cleanly re-acquires a fresh port after a soft page reload.
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

const API_SERVICE_NAME = 'apack API Server';

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

interface ShellProbeState {
  events: string[];
}

async function attachShellProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const appState = (window as unknown as {
      applicationState: {
        onEvent(listener: (record: { to: string; event: { type?: string } }) => void): { unsubscribe(): void };
      };
    }).applicationState;
    const state: ShellProbeState = { events: [] };
    appState.onEvent(({ event }) => {
      if (event.type === 'BUS_CONNECTION_LOST' || event.type === 'BUS_SUBSCRIBED') {
        state.events.push(event.type);
      }
    });
    (window as unknown as { __portBrokerShellProbe?: ShellProbeState }).__portBrokerShellProbe = state;
  });
}

async function readShellProbe(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as unknown as { __portBrokerShellProbe?: ShellProbeState }).__portBrokerShellProbe?.events ?? []),
  ]);
}

test('brokers a direct MessagePort that closes on API crash, re-delivers on restart, and survives reload', async ({ app, appPage, electronApp }) => {
  // The renderer transport owns the window's single backendPort subscriber
  const duplicateError = await appPage.evaluate(() => {
    const bridge = (window as unknown as {
      electronAPI: { backendPort: { connect(onPort: () => void): () => void } };
    }).electronAPI;
    try {
      bridge.backendPort.connect(() => {});
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(duplicateError).toContain('already has an active subscriber');

  // Verify live traffic flows over the brokered MessagePort before crashing the API process
  expect((await app.ask('host/settings', { type: 'GET_SETTINGS' })).type).toBe('ASK_ANSWERED');
  await attachShellProbe(appPage);

  // Killing the API UtilityProcess notifies the window immediately and main re-brokers a fresh generation on restart
  const firstPid = await apiPid(electronApp);
  process.kill(firstPid, 'SIGKILL');

  await expect.poll(() => readShellProbe(appPage)).toEqual(['BUS_CONNECTION_LOST', 'BUS_SUBSCRIBED']);
  await expect.poll(() => apiPid(electronApp)).not.toBe(firstPid);
  await expect.poll(async () => (await app.getState())).toBe('running.connected');
  expect((await app.ask('host/settings', { type: 'GET_SETTINGS' })).type).toBe('ASK_ANSWERED');

  // Soft-reloading the document triggers pagehide cleanup and lets the new document acquire a fresh port
  await appPage.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(async () => appPage.evaluate(() => {
    const snap = (window as unknown as {
      applicationState?: { getSnapshot(): { value: unknown; context: { busSubscribed?: boolean } } };
    }).applicationState?.getSnapshot();
    const state = String(snap?.value ?? '');
    return (state === 'running.connected' || state.startsWith('onboarding')) && snap?.context?.busSubscribed === true;
  })).toBe(true);
  expect((await app.ask('host/settings', { type: 'GET_SETTINGS' })).type).toBe('ASK_ANSWERED');
});
