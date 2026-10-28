// Real host constructors and backup coordination over both stores. No backend module aliases.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { bindHost } from '@apackdev/sdk/runtime';
import { unbindHost } from '@apackdev/sdk/runtime/internals';
import { readInstalledSchema } from '../../src/database/schema.ts';
import { schemaContext, schemaWith } from '../database/fixtures.ts';
import { testRootEvents } from '@apackdev/sdk/testing';
import { createHostRuntime } from '../../src/services/index.ts';
import { createNativePackTestRegistry } from '../../src/testing/pack-registry.ts';
import type { EarsDatabase, EARS } from '@apackdev/ears';
import { DATABASE_FORMAT as ELMDB } from '@apackdev/ears/lmdb';
import { DATABASE_FORMAT as SQLITE } from '@apackdev/ears/sqlite';
import { databaseBackupStore, exportDatabase, importDatabase, readBackup } from '../../src/backup/index.ts';
import { openDatabaseStore, openRunHistory } from '../../src/database/open.ts';
import { databaseStorage } from '../../src/database/storage.ts';
import { createRunHistory } from '../../src/services/run-history.ts';

const roots: string[] = [], opened: EarsDatabase[] = [];
afterEach(() => {
  unbindHost();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const db of opened.splice(0)) db.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const log = { info() {}, warn() {} };
const id = (s: string) => s as EARS.EntityId;
const schemaFor = (dir: string) => schemaWith(readInstalledSchema(schemaContext(dir)), ['Note']);
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-backup-storage-')); roots.push(dir); return dir; }
function storesAt(dir: string, storageFormat: string, label: string) {
  const paths = _appDataPaths(dir);
  const primary = openDatabaseStore({ path: paths.lmdb, schema: schemaFor(dir), storageFormat });
  const history = openRunHistory(paths.runHistory, { storageFormat });
  opened.push(primary.database, history.database);
  primary.engine.create('Note', { id: id('Note-' + label), title: label });
  const node = createRunHistory(history.engine).start({ kind: 'flow', label });
  const stores = { lmdb: databaseBackupStore(primary.database, primary.engine), runHistory: databaseBackupStore(history.database, history.engine) };
  return { ...primary, history, node, stores };
}
async function fixture(format: string, settings: unknown = {}) {
  const dir = root(), source = storesAt(path.join(dir, 'source'), format, 'candidate');
  source.engine.create('Settings', { id: id('Settings-app'), data: settings });
  const media = _appDataPaths(path.join(dir, 'source')).media; fs.mkdirSync(media, { recursive: true }); fs.writeFileSync(path.join(media, 'asset'), 'candidate');
  const backup = await exportDatabase(source.stores, path.join(dir, 'backups'), { name: 'candidate', databases: ['lmdb', 'runHistory'], mediaPath: media, log });
  const live = storesAt(path.join(dir, 'live'), format, 'incumbent');
  const liveMedia = _appDataPaths(path.join(dir, 'live')).media; fs.mkdirSync(liveMedia, { recursive: true }); fs.writeFileSync(path.join(liveMedia, 'asset'), 'incumbent');
  return { dir, source, backup, live, liveMedia };
}
function assertIncumbent(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.live.engine.query('Note').ids()).toEqual(['Note-incumbent']);
  expect(f.live.history.engine.query('RunNode').ids()).toEqual([f.live.node.id]);
  expect(fs.readFileSync(path.join(f.liveMedia, 'asset'), 'utf8')).toBe('incumbent');
}

describe.each([ELMDB, SQLITE])('Host backup storage %s', format => {
  it('opens real primary/run-history backups and uses the files even when metadata claims another format', async () => {
    const f = await fixture(format);
    const metadata = JSON.parse(fs.readFileSync(path.join(f.backup, 'metadata.json'), 'utf8'));
    expect(metadata.storageFormats).toEqual({ lmdb: format, runHistory: format });
    metadata.storageFormats = { lmdb: 'fiction/99', runHistory: 'fiction/99' };
    fs.writeFileSync(path.join(f.backup, 'metadata.json'), JSON.stringify(metadata));
    const contents = readBackup(f.backup, ['Note']);
    expect(contents.databases).toEqual(['lmdb', 'runHistory']);
    expect(contents.counts).toEqual([['Note', 1]]);
    expect(contents.storageFormats).toEqual(metadata.storageFormats);
    await importDatabase(f.live.stores, f.backup, f.liveMedia, { log });
    expect(f.live.engine.query('Note').ids()).toEqual(['Note-candidate']);
    expect(f.live.history.engine.query('RunNode').ids()).toEqual([f.source.node.id]);
    expect(fs.readFileSync(path.join(f.liveMedia, 'asset'), 'utf8')).toBe('candidate');
    const copy = databaseStorage(format).open({ path: path.join(f.backup, 'lmdb'), readOnly: true });
    try { expect(copy.format).toBe(format); } finally { copy.close(); }
  });

  it('restores both populated stores and media when application acceptance refuses', async () => {
    const f = await fixture(format), heard: unknown[] = [];
    const watch = f.live.engine.watch(() => f.live.engine.query('Note').ids(), rows => heard.push(rows));
    await f.live.engine.admin.watchesSettled();
    try {
      await expect(importDatabase(f.live.stores, f.backup, f.liveMedia, { log, accept: async () => {
        expect(f.live.engine.query('Note').ids()).toEqual(['Note-candidate']);
        expect(f.live.history.engine.query('RunNode').ids()).toEqual([f.source.node.id]);
        expect(fs.readFileSync(path.join(f.liveMedia, 'asset'), 'utf8')).toBe('candidate');
        throw new Error('application acceptance refused');
      }, restored: async () => { assertIncumbent(f); } })).rejects.toThrow('application acceptance refused');
      await f.live.engine.admin.watchesSettled();
      expect(heard.at(-1)).toEqual(['Note-incumbent']);
      assertIncumbent(f);
      expect(fs.readdirSync(path.dirname(f.live.database.path)).some(name => name.startsWith('.apack-import-'))).toBe(false);
    } finally { watch.stop(); }
  });

  it('restores the primary when replacing the second store refuses', async () => {
    const f = await fixture(format);
    vi.spyOn(f.live.history.database, 'replaceWith').mockImplementationOnce(() => { throw new Error('second store refused'); });
    await expect(importDatabase(f.live.stores, f.backup, f.liveMedia, { log })).rejects.toThrow('second store refused');
    assertIncumbent(f);
  });

  it('restores a replacement which committed before reporting NOT_DURABLE', async () => {
    const f = await fixture(format), replace = f.live.database.replaceWith.bind(f.live.database);
    const error = Object.assign(new Error('committed but sync failed'), { code: 'NOT_DURABLE' });
    vi.spyOn(f.live.database, 'replaceWith').mockImplementationOnce(dir => { replace(dir); throw error; });
    await expect(importDatabase(f.live.stores, f.backup, f.liveMedia, { log })).rejects.toBe(error);
    assertIncumbent(f);
  });

  it('keeps readable incumbent copies when replacement and restoration both fail', async () => {
    const f = await fixture(format);
    vi.spyOn(f.live.database, 'replaceWith').mockImplementation(() => { throw new Error('replace refused'); });
    let failure: unknown;
    try { await importDatabase(f.live.stores, f.backup, f.liveMedia, { log }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    const retained = (failure as AggregateError).message.split('retained at ')[1]!;
    const db = databaseStorage(format).open({ path: path.join(retained, 'lmdb'), readOnly: true });
    const history = databaseStorage(format).open({ path: path.join(retained, 'runHistory'), readOnly: true });
    try { expect(db.stats().types.Note?.live).toBe(1); expect(history.stats().types.RunNode?.live).toBe(1); }
    finally { db.close(); history.close(); }
  });

  it('refuses cross-format import before validation, replacement or media changes', async () => {
    const f = await fixture(format), other = format === SQLITE ? ELMDB : SQLITE;
    const source = storesAt(path.join(f.dir, 'other'), other, 'other');
    const backup = await exportDatabase(source.stores, path.join(f.dir, 'other-backups'), { name: 'other', databases: ['lmdb', 'runHistory'], mediaPath: path.join(f.dir, 'none'), log });
    const validate = vi.fn(), replace = vi.spyOn(f.live.database, 'replaceWith');
    let refusal: unknown;
    try { await importDatabase(f.live.stores, backup, f.liveMedia, { validate, log }); } catch (error) { refusal = error; }
    expect(validate).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); assertIncumbent(f);
    expect(refusal).toEqual(expect.objectContaining({ message: expect.stringContaining('convert an explicit copy first') }));
  });

  it('checks the second store format before validating or replacing the primary', async () => {
    const f = await fixture(format), other = format === SQLITE ? ELMDB : SQLITE;
    const source = storesAt(path.join(f.dir, 'other'), other, 'other');
    fs.rmSync(path.join(f.backup, 'runHistory'), { recursive: true });
    source.history.database.backup(path.join(f.backup, 'runHistory'));
    const validate = vi.fn(), replace = vi.spyOn(f.live.database, 'replaceWith');
    let refusal: unknown;
    try { await importDatabase(f.live.stores, f.backup, f.liveMedia, { validate, log }); } catch (error) { refusal = error; }
    expect(validate).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); assertIncumbent(f);
    expect(refusal).toEqual(expect.objectContaining({ message: expect.stringContaining(`Cannot import runHistory in ${other} into ${format}`) }));
  });

  it('imports through the actual appData service and refreshes the accepted settings', async () => {
    const f = await fixture(format, { app: { personal: { name: 'Candidate' } } });
    vi.stubEnv('APACK_ENV', 'test'); vi.stubEnv('APACK_USER_DATA_DIR', path.join(f.dir, 'live'));
    const runtime = createHostRuntime({ database: f.live.database, engine: f.live.engine, runHistory: f.live.history,
      packs: createNativePackTestRegistry(), appVersion: '1.0.0', transport: { rootEvents: testRootEvents } });
    bindHost(runtime);
    expect(runtime.services.settings.getOverrides()).toEqual({});
    await runtime.services.appData.importBackup(f.backup);
    expect(runtime.services.settings.getOverrides()).toEqual({ app: { personal: { name: 'Candidate' } } });
    expect(f.live.engine.query('Note').ids()).toEqual(['Note-candidate']);
    expect(fs.readFileSync(path.join(f.liveMedia, 'asset'), 'utf8')).toBe('candidate');
  });

  it('refuses invalid settings through appData before replacing either live store', async () => {
    const f = await fixture(format, { app: { projects: 'invalid' } });
    vi.stubEnv('APACK_ENV', 'test'); vi.stubEnv('APACK_USER_DATA_DIR', path.join(f.dir, 'live'));
    const runtime = createHostRuntime({ database: f.live.database, engine: f.live.engine, runHistory: f.live.history,
      packs: createNativePackTestRegistry(), appVersion: '1.0.0', transport: { rootEvents: testRootEvents } });
    bindHost(runtime);
    const replace = vi.spyOn(f.live.database, 'replaceWith');
    await expect(runtime.services.appData.importBackup(f.backup)).rejects.toThrow();
    expect(replace).not.toHaveBeenCalled(); assertIncumbent(f);
  });

  it('refuses ambiguous physical files regardless of backup metadata', async () => {
    const f = await fixture(format), foreign = databaseStorage(format === SQLITE ? ELMDB : SQLITE).dataFile;
    fs.writeFileSync(path.join(f.backup, 'lmdb', foreign), 'not a database');
    expect(() => readBackup(f.backup)).toThrow('ambiguous database files');
    assertIncumbent(f);
  });
});

it('does not create an elmdb database over a SQLite host directory', () => {
  const dir = root(); const store = openDatabaseStore({ path: dir, schema: schemaFor(dir), storageFormat: SQLITE }); opened.push(store.database);
  expect(() => openDatabaseStore({ path: dir, schema: schemaFor(dir) })).toThrow(expect.objectContaining({ code: 'STORAGE_MISMATCH' }));
  expect(fs.existsSync(path.join(dir, 'data.mdb'))).toBe(false);
});


it.each([ELMDB, SQLITE])('does not move a %s run history aside when the other backend is selected', format => {
  const dir = root(), history = openRunHistory(path.join(dir, 'runs'), { storageFormat: format });
  opened.push(history.database);
  const other = format === SQLITE ? ELMDB : SQLITE;
  expect(() => openRunHistory(history.database.path, { storageFormat: other }))
    .toThrow(expect.objectContaining({ code: 'STORAGE_MISMATCH' }));
  expect(fs.readdirSync(dir)).toEqual(['runs']);
  expect(fs.existsSync(path.join(history.database.path, databaseStorage(other).dataFile))).toBe(false);
});
