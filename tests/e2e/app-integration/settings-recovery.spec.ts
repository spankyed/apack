import { checkoutShippedPacksDir } from '@apackdev/host/packs/assets';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, waitForAppReady, type LaunchedApp } from '@apackdev/testing';
import { readSettingsOverrides } from '@apackdev/host/database';
import { installPackFromLocal } from '@apackdev/host/packs';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { type EARS } from '@elmdb/ears';
import { untypedCreate } from '@apackdev/sdk/ears';
import { writeData } from '../../../packages/apack-host/tests/database/fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');

test('repairs invalid persisted settings in the app and starts packs only after reopening', async () => {
  const testInfo = test.info();
  // Each close is bounded by the app's work rather than this clock (`launchApp`'s, which is `closeApp`)
  test.setTimeout(0);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-recovery-app-'));
  const unavailable = { 'unavailable/notes': { keep: true } };
  let app: LaunchedApp | undefined;
  const launch = async () => {
    app = await launchApp({ userDataDir, logFile: testInfo.outputPath(`app-${Date.now()}.log`) });
    return app.page;
  };
  try {
    // Model an existing profile: its installed declaration must be discoverable even when saved
    // preferences make refreshing the shipped pack refuse before startup recovery.
    await installPackFromLocal(path.join(checkoutShippedPacksDir(root), 'default-setup'),
      resolveAppEnvironment({ env: 'test', userDataDir }).packsDir);
    await writeData(userDataDir, () => {
      untypedCreate('Settings', { id: 'Settings-app' as EARS.EntityId }).set('data', {
        app: { projects: 'invalid' },
        features: { ...unavailable, 'default-setup/code': { defaultBaseDirectory: 123 } },
      });
    });
    const page = await launch();
    await expect(page.getByRole('heading', { name: 'Settings need attention' })).toBeVisible();
    await expect(page.getByText('features/default-setup/code', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Reset selected groups' }).click();
    await page.getByRole('button', { name: 'Confirm reset' }).click();
    await expect(page.getByRole('heading', { name: 'Settings repaired' })).toBeVisible();
    // A fresh window runtime must retain the restart requirement, rather than try to run a host-only shell.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings repaired' })).toBeVisible();
    // The next launch reads what the backend stored, not Chromium's profile
    await app!.close({ keepProfile: false });
    app = undefined;
    expect(readSettingsOverrides(userDataDir)).toEqual({ features: unavailable });

    const restarted = await launch();
    await waitForAppReady(restarted);
    await expect(restarted.getByRole('heading', { name: 'Settings need attention' })).toHaveCount(0);
    await expect.poll(() => restarted.evaluate(() => (window as any).applicationState
      .getSnapshot().context.acceptedPackRuntimes['default-setup'])).toBeTruthy();
  } finally {
    await app?.close({ keepProfile: false });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
