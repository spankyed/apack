import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEarsEngine, type EARS, type OrderedKV } from '@apackdev/ears';
import { untypedCreate } from '@apackdev/sdk/ears';
import { openLmdbStore, type LmdbStore } from '@apackdev/ears/lmdb';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { importDatabase } from '../../src/backup/index.ts';
import { openDatabaseStore } from '../../src/database/open.ts';
import { readInstalledSchema } from '../../src/database/schema.ts';
import { createSettingsBackupValidator } from '../../src/features/settings/be/backup.ts';
import { appSettingsDefinition } from '../../src/features/settings/be/app-definition.ts';
import { createHostRuntime } from '../../src/services/index.ts';
import { createNativePackTestRegistry } from '../../src/testing/pack-registry.ts';
import { _memoryRunHistoryStore, testRootEvents } from '@apackdev/sdk/testing';
import { tempDir, removeTempDirs, schemaContext, writeData } from '../database/fixtures.ts';

const stores: LmdbStore[] = [];
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

/** An engine over `kv` that takes any type, for the notes these cases write and look for */
const anyType = (kv: OrderedKV) => createEarsEngine({ kv, isEntityType: () => true, isRelationKind: () => true, isRole: () => true });
const note = (id: string) => id as EARS.EntityId;

/** The ids of the notes in the database at `dir` */
function notesAt(dir: string): string[] {
  const store = openLmdbStore({ path: dir, readOnly: true });
  try { return anyType(store.kv).query('Note').ids(); }
  finally { store.close(); }
}

async function fixture(settings: unknown = {}) {
  const source = tempDir('settings-backup-source-');
  await writeData(source, () => {
    untypedCreate('Settings', { id: 'Settings-app' as EARS.EntityId }).set('data', settings);
  });
  const backup = tempDir('settings-backup-candidate-');
  fs.cpSync(_appDataPaths(source).lmdb, path.join(backup, 'lmdb'), { recursive: true });
  fs.writeFileSync(path.join(backup, 'metadata.json'), JSON.stringify({ databases: ['lmdb'] }));
  const original = openLmdbStore({ path: path.join(backup, 'lmdb') });
  anyType(original.kv).create('Note', { id: note('Note-candidate') });
  original.close();
  fs.mkdirSync(path.join(backup, 'media'));
  fs.writeFileSync(path.join(backup, 'media', 'asset.txt'), 'candidate');
  const current = tempDir('settings-backup-current-');
  const paths = _appDataPaths(current);
  const { store, engine } = openDatabaseStore({ path: paths.lmdb, schema: readInstalledSchema(schemaContext(current)) });
  stores.push(store);
  const notes = anyType(store.kv);
  notes.create('Note', { id: note('Note-current') });
  return { backup, store, engine, notes, current, media: paths.media };
}

function appData(f: Awaited<ReturnType<typeof fixture>>) {
  vi.stubEnv('APACK_ENV', 'test');
  vi.stubEnv('APACK_USER_DATA_DIR', f.current);
  return createHostRuntime({ runHistory: _memoryRunHistoryStore(), store: f.store, engine: f.engine, packs: createNativePackTestRegistry(),
    appVersion: '1.0.0', transport: { rootEvents: testRootEvents } }).services.appData;
}

it('restores the incumbent when installing the imported data fails', async () => {
  const f = await fixture();
  const service = appData(f);
  vi.spyOn(f.store, 'replaceWith').mockImplementationOnce(() => { throw new Error('candidate refused'); });
  await expect(service.importBackup(f.backup)).rejects.toThrow('candidate refused');
  expect(f.notes.query('Note').ids()).toEqual(['Note-current']);
  expect(fs.existsSync(f.media)).toBe(false);
  expect(fs.readdirSync(path.dirname(f.store.path)).filter(name => name.startsWith('.apack-import-'))).toEqual([]);
});

it('preserves the recovery error and a durable copy when import and restoring both fail', async () => {
  const f = await fixture();
  const service = appData(f);
  vi.spyOn(f.store, 'replaceWith').mockImplementation(() => { throw new Error('replace failed'); });
  let failure: unknown;
  try { await service.importBackup(f.backup); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  const rollback = (failure as AggregateError).message.split('retained at ')[1];
  retained.push(path.dirname(rollback));
  expect(path.dirname(path.dirname(rollback))).toBe(path.dirname(f.store.path));
  expect(notesAt(path.join(rollback, 'lmdb'))).toEqual(['Note-current']);
});

it('refuses invalid settings before entering replacement or touching the live database', async () => {
  const { backup, store, notes, media } = await fixture({ app: { projects: 'invalid' } });
  const replace = vi.fn();
  const replaceWith = vi.spyOn(store, 'replaceWith');
  await expect(importDatabase({ lmdb: store }, backup, media, { validate, log, withReplacement: replace })).rejects.toThrow();
  expect(replace).not.toHaveBeenCalled();
  expect(replaceWith).not.toHaveBeenCalled();
  expect(notes.query('Note').ids()).toEqual(['Note-current']);
});

it('installs the validated copy even when the original backup is removed after preflight', async () => {
  const { backup, store, notes, media } = await fixture();
  await importDatabase({ lmdb: store }, backup, media, { validate, log, withReplacement: async replace => {
    fs.rmSync(backup, { recursive: true });
    return replace();
  } });
  expect(notes.query('Note').ids()).toEqual(['Note-candidate']);
  expect(fs.readFileSync(path.join(media, 'asset.txt'), 'utf8')).toBe('candidate');
});

it('restores live data and the absence of media when accepting the imported data fails', async () => {
  const { backup, store, notes, media } = await fixture();
  const accept = vi.fn(async () => { expect(notes.query('Note').ids()).toEqual(['Note-candidate']); throw new Error('refused'); });
  await expect(importDatabase({ lmdb: store }, backup, media, { validate, log, accept })).rejects.toThrow('refused');
  expect(accept).toHaveBeenCalled();
  expect(notes.query('Note').ids()).toEqual(['Note-current']);
  expect(fs.existsSync(media)).toBe(false);
});
