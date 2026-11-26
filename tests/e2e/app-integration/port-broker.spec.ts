// Direct MessageChannelMain port brokering across Electron main, preload, and the API UtilityProcess:
// an app window receives a direct transport on connect(), sees onClose() immediately when the API
// UtilityProcess crashes (SIGKILL), automatically receives a fresh generation when main restarts it,
// and cleanly re-acquires a fresh port after a soft page reload.
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

interface PortProbeState {
  generations: number[];
  closedGenerations: number[];
}

async function attachPortProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const bridge = (window as unknown as {
      electronAPI: {
        backendPort: {
          connect(onPort: (transport: { onClose(cb: () => void): void; close(): void }, info: { generation: number }) => void): () => void;
        };
      };
    }).electronAPI;

    const state: PortProbeState & { unsubscribe?: () => void } = {
      generations: [],
      closedGenerations: [],
    };
    state.unsubscribe = bridge.backendPort.connect((transport, info) => {
      state.generations.push(info.generation);
      transport.onClose(() => {
        state.closedGenerations.push(info.generation);
      });
    });
    (window as unknown as { __portBrokerProbe?: typeof state }).__portBrokerProbe = state;
  });
}

async function readPortProbe(page: Page): Promise<PortProbeState> {
  return page.evaluate(() => {
    const state = (window as unknown as { __portBrokerProbe?: PortProbeState }).__portBrokerProbe;
    return {
      generations: [...(state?.generations ?? [])],
      closedGenerations: [...(state?.closedGenerations ?? [])],
    };
  });
}

test('brokers a direct MessagePort that closes on API crash, re-delivers on restart, and survives reload', async ({ appPage, electronApp }) => {
  await attachPortProbe(appPage);
  await expect.poll(async () => (await readPortProbe(appPage)).generations).toEqual([1]);

  // Killing the API UtilityProcess notifies the window immediately and main re-brokers a fresh generation on restart
  const firstPid = await apiPid(electronApp);
  process.kill(firstPid, 'SIGKILL');

  await expect.poll(async () => (await readPortProbe(appPage)).closedGenerations).toEqual([1]);
  await expect.poll(async () => (await readPortProbe(appPage)).generations).toEqual([1, 2]);
  expect(await apiPid(electronApp)).not.toBe(firstPid);

  // Soft-reloading the document triggers pagehide cleanup and lets the new document acquire a fresh port
  await appPage.reload({ waitUntil: 'domcontentloaded' });
  await attachPortProbe(appPage);
  await expect.poll(async () => (await readPortProbe(appPage)).generations).toEqual([2]);

  // Unsubscribing closes the active transport cleanly
  await appPage.evaluate(() => {
    (window as unknown as { __portBrokerProbe?: { unsubscribe?: () => void } }).__portBrokerProbe?.unsubscribe?.();
  });
  await expect.poll(async () => (await readPortProbe(appPage)).closedGenerations).toEqual([2]);
});
