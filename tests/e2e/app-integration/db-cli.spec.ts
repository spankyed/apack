// apack db opens a data dir's database offline (docs/goals/goal-apack-db-cli.md, Decision 2 A): with the app running
// on it, a read works and warns that it may be stale, and replacing or resetting the data is refused
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { test, expect } from '@apackdev/testing';

const CLI = path.resolve(import.meta.dirname, '../../../packages/apack-cli/bin/apack.mjs');

// No timeout of its own: the test's is the bound, and a CLI on a busy machine answers late rather than not at all
async function apackDb(args: string[]) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, 'db', ...args], { encoding: 'utf-8' });
    return { status: 0, stdout: stdout.trim(), stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { status: typeof failed.code === 'number' ? failed.code : 1, stdout: (failed.stdout ?? '').trim(), stderr: failed.stderr ?? '' };
  }
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

  const read = await apackDb(['query', 'return [query(EARS.Entity.Settings).exists(), query(EARS.Entity.Flow).count() > 0]', '--data-dir', dataDir, '-o', 'json']);
  expect(read.stderr).toContain(`Database: ${dataDir} (offline)`);
  expect(read.stderr).toMatch(/Warning: apack is running on it \(its process is running \(pid \d+\)\)/);
  expect(read.status, read.stderr).toBe(0);
  // The app's settings and written flows
  expect(JSON.parse(read.stdout)).toEqual([true, true]);

  const reset = await apackDb(['reset', '--force', '--data-dir', dataDir]);
  expect(reset.status).toBe(1);
  expect(reset.stderr).toMatch(/quit it first/);

  const flows = await apackDb(['query', 'return query(EARS.Entity.Flow).count() > 0', '--data-dir', dataDir]);
  expect(flows.stdout).toBe('true');
});
