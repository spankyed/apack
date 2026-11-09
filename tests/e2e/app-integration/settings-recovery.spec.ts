import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { waitForAppReady } from '@apackdev/testing';
import { appLaunchEnv } from '../../../packages/apack-testing/src/launch-env.ts';
import { readSettingsOverrides } from '@apackdev/host/database';
import { installPackFromLocal } from '@apackdev/host/packs';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { type EARS } from '@apackdev/ears';
import { untypedCreate } from '@apackdev/sdk/ears';
import { writeData } from '../../../packages/apack-host/tests/database/fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');

test('repairs invalid persisted settings in the app and starts packs only after reopening', async ({ playwright }, testInfo) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-recovery-app-'));
  const unavailable = { 'unavailable/notes': { keep: true } };
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await playwright._electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [root], cwd: root,
      env: appLaunchEnv(process.env, userDataDir) });
    const log = fs.createWriteStream(testInfo.outputPath(`app-${Date.now()}.log`));
    app.process().stdout?.pipe(log, { end: false });
    app.process().stderr?.pipe(log, { end: false });
    app.once('close', () => log.end());
    await expect.poll(() => app!.windows().some(page => page.url().includes('/renderer/dist/index.html')),
      { message: 'main renderer, rather than the splash window' }).toBe(true);
    return app.windows().find(page => page.url().includes('/renderer/dist/index.html'))!;
  };
  try {
    // Model an existing profile: its installed declaration must be discoverable even when saved
    // preferences make refreshing the shipped pack refuse before startup recovery.
    await installPackFromLocal(path.join(root, 'packages/default-setup'),
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
    await app!.close();
    app = undefined;
    expect(readSettingsOverrides(userDataDir)).toEqual({ features: unavailable });

    const restarted = await launch();
    await waitForAppReady(restarted);
    await expect(restarted.getByRole('heading', { name: 'Settings need attention' })).toHaveCount(0);
    await expect.poll(() => restarted.evaluate(() => (window as any).applicationState
      .getSnapshot().context.acceptedPackRuntimes['default-setup'])).toBeTruthy();
  } finally {
    await app?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
