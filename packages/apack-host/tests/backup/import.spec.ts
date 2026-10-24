import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { type EARS } from '@apackdev/ears';
import { untypedCreate } from '@apackdev/sdk/ears';
import { openEnvAt, closeEnv, type LmdbStore } from '@apackdev/ears/lmdb';
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
async function fixture(settings: unknown = {}) {
  const source = tempDir('settings-backup-source-');
  await writeData(source, () => {
    untypedCreate('Settings', { id: 'Settings-app' as EARS.EntityId }).set('data', settings);
  });
  const backup = tempDir('settings-backup-candidate-');
  fs.cpSync(_appDataPaths(source).lmdb, path.join(backup, 'lmdb'), { recursive: true });
  fs.writeFileSync(path.join(backup, 'metadata.json'), JSON.stringify({ databases: ['lmdb'] }));
  const original = openEnvAt(path.join(backup, 'lmdb'));
  original.rows.putSync('Note-candidate', { type: 'Note', fields: [], outOfLine: [] });
  closeEnv(original);
  fs.mkdirSync(path.join(backup, 'media'));
  fs.writeFileSync(path.join(backup, 'media', 'asset.txt'), 'candidate');
  const current = tempDir('settings-backup-current-');
  const paths = _appDataPaths(current);
  const { store, engine } = openDatabaseStore({
    path: paths.lmdb,
    schema: readInstalledSchema(schemaContext(current)), log: () => {},
  });
  stores.push(store);
  // Hydration loads an entity's fields, so the incumbent holds one to be visible in memory after a restore
  store.env.rows.putSync('Note-current', { type: 'Note', fields: [['title', 'current']], outOfLine: [] });
  return { backup, store, engine, current, media: paths.media };
}

function appData(f: Awaited<ReturnType<typeof fixture>>) {
  vi.stubEnv('APACK_ENV', 'test');
  vi.stubEnv('APACK_USER_DATA_DIR', f.current);
  return createHostRuntime({ runHistory: _memoryRunHistoryStore(), store: f.store, engine: f.engine, packs: createNativePackTestRegistry(),
    appVersion: '1.0.0', transport: { rootEvents: testRootEvents } }).services.appData;
}

it('restores and hydrates the incumbent when imported data fails hydration', async () => {
  const f = await fixture();
  const service = appData(f);
  vi.spyOn(f.store, 'hydrate').mockRejectedValueOnce(new Error('candidate hydration failed'));
  await expect(service.importBackup(f.backup)).rejects.toThrow('candidate hydration failed');
  expect(f.store.env.rows.get('Note-current')).toMatchObject({ type: 'Note' });
  expect(f.store.env.rows.get('Note-candidate')).toBeUndefined();
  expect(f.engine.query.ids('Note-current' as EARS.EntityId).pickOne(['entityType'])).not.toBeNull();
  expect(fs.existsSync(f.media)).toBe(false);
  expect(fs.readdirSync(path.dirname(f.store.path)).filter(name => name.startsWith('.apack-import-'))).toEqual([]);
});

it('preserves the recovery error and a durable copy when installing the import and the rollback both fail', async () => {
  const f = await fixture();
  const service = appData(f);
  const replace = vi.spyOn(f.store, 'replaceWith').mockImplementation(() => { throw new Error('replace failed'); });
  let failure: unknown;
  try { await service.importBackup(f.backup); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  const rollback = (failure as AggregateError).message.split('retained at ')[1];
  expect(path.dirname(path.dirname(rollback))).toBe(path.dirname(f.store.path));
  const copy = openEnvAt(path.join(rollback, 'lmdb'), { readOnly: true });
  try { expect(copy.rows.get('Note-current')).toMatchObject({ type: 'Note' }); }
  finally { closeEnv(copy); }
  replace.mockRestore();
});

it('refuses invalid settings before entering replacement or closing the live database', async () => {
  const { backup, store, media } = await fixture({ app: { projects: 'invalid' } });
  const replace = vi.fn();
  const close = vi.spyOn(store, 'close');
  await expect(importDatabase({ lmdb: store }, backup, media, { validate, log, withReplacement: replace })).rejects.toThrow();
  expect(replace).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(store.env.rows.get('Note-current')).toMatchObject({ type: 'Note' });
});

it('installs the validated copy even when the original backup is removed after preflight', async () => {
  const { backup, store, media } = await fixture();
  await importDatabase({ lmdb: store }, backup, media, { validate, log, withReplacement: async replace => {
    fs.rmSync(backup, { recursive: true });
    return replace();
  } });
  expect(store.env.rows.get('Note-candidate')).toMatchObject({ type: 'Note' });
  expect(store.env.rows.get('Note-current')).toBeUndefined();
  expect(fs.readFileSync(path.join(media, 'asset.txt'), 'utf8')).toBe('candidate');
});

it('restores live data and absence of media when installing the imported database fails', async () => {
  const { backup, store, media } = await fixture();
  vi.spyOn(store, 'replaceWith').mockImplementationOnce(() => { throw new Error('replace failed'); });
  await expect(importDatabase({ lmdb: store }, backup, media, { validate, log })).rejects.toThrow('replace failed');
  expect(store.env.rows.get('Note-current')).toMatchObject({ type: 'Note' });
  expect(store.env.rows.get('Note-candidate')).toBeUndefined();
  expect(fs.existsSync(media)).toBe(false);
});

it('retains a readable rollback snapshot when restoration also fails', async () => {
  const { backup, store, media } = await fixture();
  const replace = vi.spyOn(store, 'replaceWith').mockImplementation(() => { throw new Error('replace failed'); });
  let failure: unknown;
  try { await importDatabase({ lmdb: store }, backup, media, { validate, log }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  const rollback = (failure as AggregateError).message.split('retained at ')[1];
  retained.push(path.dirname(rollback));
  const copy = openEnvAt(path.join(rollback, 'lmdb'), { readOnly: true });
  try { expect(copy.rows.get('Note-current')).toMatchObject({ type: 'Note' }); }
  finally { closeEnv(copy); }
  replace.mockRestore();
});
