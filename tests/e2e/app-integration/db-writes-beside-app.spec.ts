// `apack db exec` writes from its own process, where nothing in the app can hear the commit. This runs the real CLI
// against a running app's data dir, and the library's tree is what shows the app was told: it renders a live view, and
// a view runs again only when its engine hears a commit.
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from '@apackdev/testing';
import { libraryDocuments } from './library-documents.ts';

const CLI = path.resolve(import.meta.dirname, '../../../packages/apack-cli/bin/apack.mjs');
const WRITTEN_DOCUMENT = 'Codex commands';
const CHANGED_DOCUMENT = 'Codex commands from a terminal';

test('a write from apack db exec shows in the running app, without a restart', async ({ app, appPage, electronApp }) => {
  await app.waitForSurface('default-setup/library');
  await app.navigate('default-setup/library');
  await expect.poll(() => libraryDocuments(appPage)).toContain(WRITTEN_DOCUMENT);

  const dataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);
  expect(dataDir, 'the app says which data dir it runs on').toBeTruthy();
  const code = `const [id] = query(EARS.Entity.Document).where('name', ${JSON.stringify(WRITTEN_DOCUMENT)}).ids();
    write(id).set('name', ${JSON.stringify(CHANGED_DOCUMENT)}); return id;`;
  const { stderr } = await promisify(execFile)(process.execPath, [CLI, 'db', 'exec', code, '--data-dir', dataDir!], {
    env: { ...process.env, APACK_ENV: 'test' },
  });
  expect(stderr).toContain('apack is running on it');

  await expect.poll(() => libraryDocuments(appPage), { timeout: 15_000 }).toContain(CHANGED_DOCUMENT);
  expect(await libraryDocuments(appPage)).not.toContain(WRITTEN_DOCUMENT);
});

test('an invalid settings row from apack db exec is refused, and the app carries on', async ({ app, electronApp }) => {
  await app.waitForState('running.connected');
  const dataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);
  const apackDb = (...args: string[]) => promisify(execFile)(process.execPath, [CLI, 'db', ...args, '--data-dir', dataDir!], {
    env: { ...process.env, APACK_ENV: 'test' },
  });

  const refused = await apackDb('exec', "upsert(EARS.Entity.Settings, { id: 'Settings-app', data: 'not settings' })")
    .then(() => null, (error: { code?: number; stderr?: string }) => error);
  expect(refused?.code, 'saved, but not taken').toBe(4);
  expect(refused?.stderr).toContain('it refused its stored settings');

  const { stdout } = await apackDb('query', "return typeof getRow('Settings-app')?.data");
  expect(stdout.trim()).toBe('object');
  expect(await app.getState()).toEqual(expect.objectContaining({ running: 'connected' }));
});
