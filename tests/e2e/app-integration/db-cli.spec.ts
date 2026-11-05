// apack db opens a data dir's database offline (docs/goals/goal-apack-db-cli.md, Decision 2 A): with the app running
// on it, a read works and warns that it may be stale, and replacing or resetting the data is refused
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { test, expect } from '@apackdev/testing';

const CLI = path.resolve(import.meta.dirname, '../../../packages/apack-cli/bin/apack.mjs');

function apackDb(args: string[]) {
  const result = spawnSync(process.execPath, [CLI, 'db', ...args], { encoding: 'utf-8', timeout: 60_000 });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

test("reads the running app's data and refuses to reset it", async ({ electronApp, app, appPage }) => {
  // Connected: the API booted, hydrated and written the app's data
  await app.waitForState('running.connected');
  // Defaults are declarative; a Settings row exists only after an explicit override is saved.
  await app.navigate('host/settings');
  await appPage.getByRole('button', { name: 'Personal', exact: true }).click();
  await appPage.getByLabel('Full Name', { exact: true }).fill('Offline CLI acceptance');
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  const dataDir = await electronApp.evaluate(({ app: electron }) => electron.getPath('userData'));

  const read = apackDb(['query', 'return [query(EARS.Entity.Settings).exists(), query(EARS.Entity.Flow).count() > 0]', '--data-dir', dataDir, '-o', 'json']);
  expect(read.stderr).toContain(`Database: ${dataDir} (offline)`);
  expect(read.stderr).toMatch(/Warning: apack is running on it \(its process is running \(pid \d+\)\)/);
  expect(read.status, read.stderr).toBe(0);
  // The app's settings and written flows
  expect(JSON.parse(read.stdout)).toEqual([true, true]);

  const reset = apackDb(['reset', '--force', '--data-dir', dataDir]);
  expect(reset.status).toBe(1);
  expect(reset.stderr).toMatch(/quit it first/);

  const flows = apackDb(['query', 'return query(EARS.Entity.Flow).count() > 0', '--data-dir', dataDir]);
  expect(flows.stdout).toBe('true');
});
