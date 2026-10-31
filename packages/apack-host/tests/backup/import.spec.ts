import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEarsEngine, type EARS, type EarsDatabase } from '@apackdev/ears';
import { untypedCreate } from '@apackdev/sdk/ears';
import { openDatabase } from '@apackdev/ears/lmdb';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { databaseBackupStore, importDatabase } from '../../src/backup/index.ts';
import { openDatabaseStore } from '../../src/database/open.ts';
import { readInstalledSchema } from '../../src/database/schema.ts';
import { createSettingsBackupValidator } from '../../src/features/settings/be/backup.ts';
import { appSettingsDefinition } from '../../src/features/settings/be/app-definition.ts';
import { createHostRuntime } from '../../src/services/index.ts';
import { createNativePackTestRegistry } from '../../src/testing/pack-registry.ts';
import { _openTestRunHistory, testRootEvents } from '@apackdev/sdk/testing';
import { tempDir, removeTempDirs, schemaContext, schemaWith, openWithTypes, writeData } from '../database/fixtures.ts';

const stores: EarsDatabase[] = [];
const retained: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const store of stores.splice(0)) store.close();
  for (const dir of retained.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  removeTempDirs();
});
const log = { info: () => {}, warn: () => {} };
const validate = createSettingsBackupValidator({ revision: 0, app: appSettingsDefinition, packs: {}, features: {}, dependencies: {} });

const note = (id: string) => id as EARS.EntityId;

/** The ids of the notes in the database at `dir` */
function notesAt(dir: string): string[] {
  const database = openDatabase({ path: dir, readOnly: true });
  try { return createEarsEngine({ database }).query('Note').ids(); }
  finally { database.close(); }
}

async function fixture(settings: unknown = {}) {
  const source = tempDir('settings-backup-source-');
  await writeData(source, () => {
    untypedCreate('Settings', { id: 'Settings-app' as EARS.EntityId }).set('data', settings);
  });
  const backup = tempDir('settings-backup-candidate-');
  fs.cpSync(_appDataPaths(source).lmdb, path.join(backup, 'lmdb'), { recursive: true });
  fs.writeFileSync(path.join(backup, 'metadata.json'), JSON.stringify({ databases: ['lmdb'] }));
  // The backup's database declares the notes the cases write, as the app's would
  const original = openWithTypes(path.join(backup, 'lmdb'), ['Note']);
  original.engine.create('Note', { id: note('Note-candidate') });
  original.database.close();
  fs.mkdirSync(path.join(backup, 'media'));
  fs.writeFileSync(path.join(backup, 'media', 'asset.txt'), 'candidate');
  const current = tempDir('settings-backup-current-');
  const paths = _appDataPaths(current);
  const { database, engine } = openDatabaseStore({ path: paths.lmdb, schema: schemaWith(readInstalledSchema(schemaContext(current)), ['Note']) });
  stores.push(database);
  const notes = engine;
  notes.create('Note', { id: note('Note-current') });
  return { backup, database, engine, notes, current, media: paths.media };
}

function appData(f: Awaited<ReturnType<typeof fixture>>) {
  vi.stubEnv('APACK_ENV', 'test');
  vi.stubEnv('APACK_USER_DATA_DIR', f.current);
  return createHostRuntime({ runHistory: _openTestRunHistory(), database: f.database, engine: f.engine, packs: createNativePackTestRegistry(),
    appVersion: '1.0.0', transport: { rootEvents: testRootEvents } }).services.appData;
}

it('restores the incumbent when installing the imported data fails', async () => {
  const f = await fixture();
  const service = appData(f);
  vi.spyOn(f.database, 'replaceWith').mockImplementationOnce(() => { throw new Error('candidate refused'); });
  await expect(service.importBackup(f.backup)).rejects.toThrow('candidate refused');
  expect(f.notes.query('Note').ids()).toEqual(['Note-current']);
  expect(fs.existsSync(f.media)).toBe(false);
  expect(fs.readdirSync(path.dirname(f.database.path)).filter(name => name.startsWith('.apack-import-'))).toEqual([]);
});

it('preserves the recovery error and a durable copy when import and restoring both fail', async () => {
  const f = await fixture();
  const service = appData(f);
  vi.spyOn(f.database, 'replaceWith').mockImplementation(() => { throw new Error('replace failed'); });
  let failure: unknown;
  try { await service.importBackup(f.backup); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  const rollback = (failure as AggregateError).message.split('retained at ')[1];
  retained.push(path.dirname(rollback));
  expect(path.dirname(path.dirname(rollback))).toBe(path.dirname(f.database.path));
  expect(notesAt(path.join(rollback, 'lmdb'))).toEqual(['Note-current']);
});

it('refuses invalid settings before entering replacement or touching the live database', async () => {
  const { backup, database, notes, media } = await fixture({ app: { projects: 'invalid' } });
  const replace = vi.fn();
  const replaceWith = vi.spyOn(database, 'replaceWith');
  await expect(importDatabase({ lmdb: databaseBackupStore(database) }, backup, media, { validate, log, withReplacement: replace })).rejects.toThrow();
  expect(replace).not.toHaveBeenCalled();
  expect(replaceWith).not.toHaveBeenCalled();
  expect(notes.query('Note').ids()).toEqual(['Note-current']);
});

it('installs the validated copy even when the original backup is removed after preflight', async () => {
  const { backup, database, notes, media } = await fixture();
  await importDatabase({ lmdb: databaseBackupStore(database) }, backup, media, { validate, log, withReplacement: async replace => {
    fs.rmSync(backup, { recursive: true });
    return replace();
  } });
  expect(notes.query('Note').ids()).toEqual(['Note-candidate']);
  expect(fs.readFileSync(path.join(media, 'asset.txt'), 'utf8')).toBe('candidate');
});

it('restores live data and the absence of media when accepting the imported data fails', async () => {
  const { backup, database, notes, media } = await fixture();
  const accept = vi.fn(async () => { expect(notes.query('Note').ids()).toEqual(['Note-candidate']); throw new Error('refused'); });
  await expect(importDatabase({ lmdb: databaseBackupStore(database) }, backup, media, { validate, log, accept })).rejects.toThrow('refused');
  expect(accept).toHaveBeenCalled();
  expect(notes.query('Note').ids()).toEqual(['Note-current']);
  expect(fs.existsSync(media)).toBe(false);
});

it('refuses unrelated writes from the incumbent copy until a rejected import has rolled back', async () => {
  const { backup, database, notes, media } = await fixture();
  const store = databaseBackupStore(database);
  let release!: () => void, copied!: () => void;
  const holding = new Promise<void>(resolve => { release = resolve; });
  const snapshot = new Promise<void>(resolve => { copied = resolve; });
  const failure = new Error('candidate acceptance refused');
  const importing = importDatabase({ lmdb: { ...store, async copyTo(target) {
    await store.copyTo(target); copied(); await holding;
  } } }, backup, media, { log, accept: async () => { throw failure; } });
  const rejected = expect(importing).rejects.toBe(failure);
  try {
    await snapshot;
    expect(notes.query('Note').ids()).toEqual(['Note-current']);
    expect(() => notes.create('Note', { id: note('Note-streamed') }))
      .toThrow(expect.objectContaining({ code: 'WRITE_PAUSED' }));
  } finally { release(); await rejected; }
  expect(notes.query('Note').ids()).toEqual(['Note-current']);
  notes.create('Note', { id: note('Note-resumed') });
  expect(notes.query('Note').ids()).toContain('Note-resumed');
});
