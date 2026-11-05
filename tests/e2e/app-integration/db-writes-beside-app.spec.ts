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

  const refused = await apackDb(dataDir!, 'exec', "upsert(EARS.Entity.Settings, { id: 'Settings-app', data: 'not settings' })")
    .then(() => null, (error: { code?: number; stderr?: string }) => error);
  expect(refused?.code).toBe(1);
  expect(refused?.stderr).toContain('Nothing it wrote was kept');

  const { stdout } = await apackDb(dataDir!, 'query', "return typeof getRow('Settings-app')?.data");
  expect(stdout.trim()).not.toBe('string');
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

test('a reset from apack db starts the running app over, and it goes on working', async ({ app, appPage, electronApp }) => {
  await app.waitForSurface('default-setup/library');
  await app.navigate('default-setup/library');
  await expect.poll(() => libraryDocuments(appPage)).toContain('Claude Code commands');
  const dataDir = (await electronApp.evaluate(() => process.env.APACK_USER_DATA_DIR))!;

  await apackDb(dataDir, 'exec', "write(query(EARS.Entity.Document).where('name', 'Claude Code commands').ids()[0]).set('name', 'Renamed before the reset')");
  const nameCount = (name: string) => `return query(EARS.Entity.Document).where('name', ${JSON.stringify(name)}).count()`;
  const { stdout } = await apackDb(dataDir, 'reset', '--force', '--keep-keys');
  expect(stdout).toContain('running apack starts over');

  await expect.poll(async () => (await apackDb(dataDir, 'query', nameCount('Claude Code commands'))).stdout.trim(), { timeout: 15_000 }).toBe('1');
  expect((await apackDb(dataDir, 'query', nameCount('Renamed before the reset'))).stdout.trim()).toBe('0');
  expect(await app.getState()).toEqual(expect.objectContaining({ running: 'connected' }));

  await appPage.evaluate(() => {
    type Actor = { send(event: { type: 'CREATE_FOLDER'; name: string }): void };
    (window as { applicationState?: { system?: { get(id: string): Actor | undefined } } })
      .applicationState?.system?.get('default-setup/library')?.send({ type: 'CREATE_FOLDER', name: 'Made after the reset' });
  });
  const folders = "return query(EARS.Entity.Collection).where('name', 'Made after the reset').count()";
  await expect.poll(async () => (await apackDb(dataDir, 'query', folders)).stdout.trim(), { timeout: 15_000 }).toBe('1');
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
