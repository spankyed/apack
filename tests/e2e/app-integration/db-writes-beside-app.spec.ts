// `apack db exec` writes from its own process, and tells the app nothing: the commit wakes it. This runs the real CLI
// against a running app's data dir, and the library's tree is what shows the app heard: it renders a live view, and a
// view runs again only when its engine hears a commit.
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from '@apackdev/testing';
import { libraryDocuments } from './library-documents.ts';

const CLI = path.resolve(import.meta.dirname, '../../../packages/apack-cli/bin/apack.mjs');
const WRITTEN_DOCUMENT = 'Codex commands';
const CHANGED_DOCUMENT = 'Codex commands from a terminal';

/** `apack db <args>` on the data dir, as a real process */
const apackDb = (dataDir: string, ...args: string[]) => promisify(execFile)(process.execPath, [CLI, 'db', ...args, '--data-dir', dataDir], {
  env: { ...process.env, APACK_ENV: 'test' },
});

test('a write from apack db exec shows in the running app, without a restart', async ({ app, appPage, electronApp }) => {
  await app.waitForSurface('default-setup/library');
  await app.navigate('default-setup/library');
  await expect.poll(() => libraryDocuments(appPage)).toContain(WRITTEN_DOCUMENT);

  const dataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);
  expect(dataDir, 'the app says which data dir it runs on').toBeTruthy();
  const code = `const [id] = query(EARS.Entity.Document).where('name', ${JSON.stringify(WRITTEN_DOCUMENT)}).ids();
    write(id).set('name', ${JSON.stringify(CHANGED_DOCUMENT)}); return id;`;
  await apackDb(dataDir!, 'exec', code);

  await expect.poll(() => libraryDocuments(appPage), { timeout: 15_000 }).toContain(CHANGED_DOCUMENT);
  expect(await libraryDocuments(appPage)).not.toContain(WRITTEN_DOCUMENT);
});

test('an invalid settings row from apack db exec is refused, and the app carries on', async ({ app, electronApp }) => {
  await app.waitForState('running.connected');
  const dataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);

  await apackDb(dataDir!, 'exec', "upsert(EARS.Entity.Settings, { id: 'Settings-app', data: 'not settings' })");

  await expect.poll(async () => (await apackDb(dataDir!, 'query', "return typeof getRow('Settings-app')?.data")).stdout.trim(),
    { timeout: 15_000 }).toBe('object');
  expect(await app.getState()).toEqual(expect.objectContaining({ running: 'connected' }));
});

test('a tool killed right after committing is heard, with nothing committed in the app', async ({ app, appPage, electronApp }) => {
  await app.waitForSurface('default-setup/library');
  await app.navigate('default-setup/library');
  await expect.poll(() => libraryDocuments(appPage)).toContain('Chat commands');
  const dataDir = await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR);

  const script = path.join(dataDir!, 'killed.mjs');
  fs.writeFileSync(script, `export default ({ db, EARS }) => {
    const [id] = db.ears.query(EARS.Entity.Document).where('name', 'Chat commands').ids();
    db.ears.write(id).set('name', 'Chat commands from a killed tool');
    process.kill(process.pid, 'SIGKILL');
  };`);
  const killed = await apackDb(dataDir!, 'script', script).then(() => null, (error: { signal?: string }) => error);
  expect(killed?.signal, 'the tool died as soon as it had committed').toBe('SIGKILL');

  await expect.poll(() => libraryDocuments(appPage), { timeout: 15_000 }).toContain('Chat commands from a killed tool');
});

/** Creates two notes through the CLI, the first's text linking to the second, as a tool writes past any repository */
const linkedNotes = `
  const fields = { completed: false, displayOrder: 0, hideCompletedChildren: false, icon: '', lastSeen: 0, noteType: 'document' };
  const target = create(EARS.Entity.Note, { ...fields, title: 'target', content: '' }).id();
  const source = create(EARS.Entity.Note, { ...fields, title: 'source', content: '[t](apack-ref://note/' + target + ')' }).id();
  return source;`;

test('a note a tool writes gets its references in the running app', async ({ app, electronApp }) => {
  await app.waitForState('running.connected');
  const dataDir = (await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR))!;
  const source = JSON.parse((await apackDb(dataDir, 'exec', linkedNotes, '-o', 'json')).stdout) as string;
  const references = `return findRelations({ source: ${JSON.stringify(source)}, kind: 'references' }).length`;
  await expect.poll(async () => (await apackDb(dataDir, 'query', references)).stdout.trim(), { timeout: 15_000 }).toBe('1');
});
