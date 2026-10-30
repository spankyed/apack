import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { APP_ENVS, appDataDirFor } from '@apackdev/sdk/env';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { DATABASE_FORMAT as ELMDB } from '@apackdev/ears/lmdb';
import { DATABASE_FORMAT as SQLITE, openDatabase as openSqlite, waitForNativeModels } from '@apackdev/ears/sqlite';
import { createEarsEngine, type EarsDatabase } from '@apackdev/ears';
import { holdRecoveryExclusion } from '../../src/database/recovery-lock.ts';
import { prepareImportRecovery } from '../../src/backup/recovery.ts';
import { configuredDatabaseFormat, databaseStorage, openDatabaseStore, openRunHistory, startDatabaseBackground, closeDatabases } from '../../src/database/index.ts';

const roots: string[] = [], opened: EarsDatabase[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const schema = { getRegisteredEntityTypes: () => new Set(['Probe']), getRegisteredRelationKinds: () => new Set<string>(), getRegisteredRoles: () => new Set<string>() };
const root = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-sqlite-profile-')); roots.push(dir); return dir; };
it('keeps elmdb as the normal default', () => { vi.stubEnv('APACK_STORAGE_FORMAT', undefined); vi.stubEnv('APACK_USER_DATA_DIR', undefined); expect(configuredDatabaseFormat()).toBe(ELMDB); });
it('refuses unknown boot formats', () => { vi.stubEnv('APACK_STORAGE_FORMAT', 'fiction/99'); expect(() => configuredDatabaseFormat()).toThrow('Unsupported database storage format'); });
it.each([undefined, 'relative/profile'])('requires explicit absolute candidate storage (%s)', dir => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', dir);
  expect(() => configuredDatabaseFormat()).toThrow('explicit absolute');
});
it.each(APP_ENVS)('refuses the default %s profile without opening it', env => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', appDataDirFor(env));
  expect(() => configuredDatabaseFormat()).toThrow('isolated profile');
});
it('selects both real stores and preserves the profile when selection is omitted on reopen', () => {
  const dir = root(), paths = _appDataPaths(dir);
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', dir);
  const primary = openDatabaseStore({ path: paths.lmdb, schema }), runs = openRunHistory(paths.runHistory);
  opened.push(primary.database, runs.database);
  expect(primary.database.format).toBe(SQLITE); expect(runs.database.format).toBe(SQLITE);
  primary.database.close(); runs.database.close();
  vi.stubEnv('APACK_STORAGE_FORMAT', undefined);
  expect(() => openDatabaseStore({ path: paths.lmdb, schema })).toThrow(expect.objectContaining({ code: 'STORAGE_MISMATCH' }));
  expect(() => openRunHistory(paths.runHistory)).toThrow(expect.objectContaining({ code: 'STORAGE_MISMATCH' }));
  expect(fs.existsSync(path.join(paths.lmdb, 'data.mdb'))).toBe(false);
  expect(fs.existsSync(path.join(paths.runHistory, 'data.mdb'))).toBe(false);
});
it('uses the explicitly supplied CLI profile for the isolation check', () => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', root());
  expect(() => configuredDatabaseFormat(appDataDirFor('production'))).toThrow('isolated profile');
});

it('refuses children of a default profile and symlink aliases without creating their targets', () => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE);
  expect(() => configuredDatabaseFormat(path.join(appDataDirFor('test'), 'candidate'))).toThrow('isolated profile');
  const alias = path.join(root(), 'alias'); fs.symlinkSync(appDataDirFor('test'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => configuredDatabaseFormat(alias)).toThrow('isolated profile');
});

it.each([ELMDB, SQLITE])('blocks writable recovery opens without salvaging either %s store', format => {
  const dir = root(), paths = _appDataPaths(dir);
  const primary = openDatabaseStore({ path: paths.lmdb, schema, storageFormat: format });
  const history = openRunHistory(paths.runHistory, { storageFormat: format });
  primary.engine.create('Probe', { id: 'Probe-incumbent' });
  primary.database.close(); history.database.close();
  const session = path.join(path.dirname(paths.lmdb), '.apack-import-interrupted');
  prepareImportRecovery(session, [{ name: 'lmdb', path: paths.lmdb, format }, { name: 'runHistory', path: paths.runHistory, format }]);
  expect(() => openDatabaseStore({ path: paths.lmdb, schema, storageFormat: format }))
    .toThrow(expect.objectContaining({ code: 'RECOVERY_REQUIRED' }));
  expect(() => openRunHistory(paths.runHistory, { storageFormat: format }))
    .toThrow(expect.objectContaining({ code: 'RECOVERY_REQUIRED' }));
  expect(fs.readdirSync(path.dirname(paths.runHistory)).some(name => name.includes('.unreadable-'))).toBe(false);
  const inspected = openDatabaseStore({ path: paths.lmdb, schema, readOnly: true, storageFormat: format });
  opened.push(inspected.database);
  expect(inspected.engine.query('Probe').ids()).toEqual(['Probe-incumbent']);
  const inspectedHistory = openRunHistory(paths.runHistory, { readOnly: true, storageFormat: format });
  opened.push(inspectedHistory.database);
  expect(inspectedHistory.database.isOpen).toBe(true);
});

it('routes explicit SQLite rebuild through maintenance ownership and waits for readiness', async () => {
  const db = openSqlite({ path: root(), syncs: false, schema: { types: {
    Probe: { required: [], search: { fields: { title: 1 } } },
  }, relations: {}, roles: [] } }); opened.push(db);
  const e = createEarsEngine({ database: db });
  e.create('Probe', { id: 'Probe-one', title: 'needle' });
  const before = e.lastCommit();
  const rebuild = databaseStorage(SQLITE).rebuildIndexes!(db);
  expect(() => e.create('Probe', { id: 'Probe-blocked' })).toThrow(expect.objectContaining({ code: 'WRITE_PAUSED' }));
  await rebuild;
  expect(e.query('Probe').search('needle', { fuzzy: false }).ids()).toEqual(['Probe-one']);
  expect(e.lastCommit()).toBe(before);
  e.create('Probe', { id: 'Probe-after', title: 'after' });
  expect(e.query('Probe').count()).toBe(2);
  expect(databaseStorage(ELMDB).rebuildIndexes).toBeUndefined();
});

it('refuses unreadable run history without replacement when maintenance disables salvage', () => {
  const parent = root(), directory = path.join(parent, 'runs'); fs.mkdirSync(directory);
  const bytes = Buffer.from('not an LMDB database');
  fs.writeFileSync(path.join(directory, 'data.mdb'), bytes);
  expect(() => openRunHistory(directory, { storageFormat: ELMDB, replaceUnreadable: false })).toThrow();
  expect(fs.readdirSync(parent).sort()).toEqual(['db-readers', 'runs']);
  expect(fs.readdirSync(path.join(parent, 'db-readers'))).toEqual([]);
  expect(fs.readFileSync(path.join(directory, 'data.mdb'))).toEqual(bytes);
});


it('starts optional models on managed SQLite stores and releases both owners on shutdown', async () => {
  const dir = root(), paths = _appDataPaths(dir);
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', dir);
  const primary = openDatabaseStore({ path: paths.lmdb, schema }), runs = openRunHistory(paths.runHistory);
  opened.push(primary.database, runs.database);
  await Promise.all([startDatabaseBackground(primary.database), startDatabaseBackground(runs.database)]);
  await Promise.all([waitForNativeModels(primary.database), waitForNativeModels(runs.database)]);
  const peer = openSqlite({ path: paths.lmdb }); opened.push(peer);
  await expect(startDatabaseBackground(peer)).rejects.toMatchObject({ code: 'BACKGROUND_OWNER_EXISTS' });
  await closeDatabases([primary.database, runs.database]);
  expect(primary.database.isOpen).toBe(false); expect(runs.database.isOpen).toBe(false);
  await startDatabaseBackground(peer); await waitForNativeModels(peer); await closeDatabases([peer]);
});

it('does not start native services for forensic SQLite readers or the normal elmdb backend', async () => {
  const dir = root(), writer = openSqlite({ path: dir }); writer.close();
  const reader = openSqlite({ path: dir, readOnly: true }); opened.push(reader);
  await startDatabaseBackground(reader);
  await expect(waitForNativeModels(reader)).rejects.toMatchObject({ code: 'BACKGROUND_OWNER_REQUIRED' });
  const native = databaseStorage(ELMDB).open({ path: root() }); opened.push(native);
  await expect(startDatabaseBackground(native)).resolves.toBeUndefined();
});


it.each([ELMDB, SQLITE])('quarantines corrupt %s history while an unrelated primary handle stays open', storageFormat => {
  const parent = root(), primary = openDatabaseStore({ path: path.join(parent, 'db'), schema, storageFormat });
  opened.push(primary.database);
  const directory = path.join(parent, 'runs'); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, databaseStorage(storageFormat).dataFile), Buffer.alloc(16384, 7));
  const history = openRunHistory(directory, { storageFormat }); opened.push(history.database);
  expect(history.database.isOpen).toBe(true);
  expect(primary.engine.query('Probe').count()).toBe(0);
  const aside = fs.readdirSync(parent).filter(name => name.startsWith('runs.unreadable-'));
  expect(aside).toHaveLength(1);
  expect(fs.readFileSync(path.join(parent, aside[0], databaseStorage(storageFormat).dataFile))).toEqual(Buffer.alloc(16384, 7));
});

it.each([ELMDB, SQLITE])('refuses %s history quarantine while a managed reader still holds the directory', storageFormat => {
  const parent = root(), directory = path.join(parent, 'runs');
  const seed = openRunHistory(directory, { storageFormat }); seed.database.close();
  const reader = openRunHistory(directory, { storageFormat, readOnly: true }); opened.push(reader.database);
  const file = path.join(directory, databaseStorage(storageFormat).dataFile), before = fs.readFileSync(file);
  const failure = Object.assign(new Error('Injected corrupt-open diagnosis'), { code: storageFormat === SQLITE ? 'SQLITE_CORRUPT' : 'CORRUPTED' });
  const spy = vi.spyOn(databaseStorage(storageFormat), 'open').mockImplementationOnce(() => { throw failure; });
  try {
    expect(() => openRunHistory(directory, { storageFormat })).toThrow('Close apps and tools using this profile');
    expect(fs.readdirSync(parent).some(name => name.startsWith('runs.unreadable-'))).toBe(false);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(reader.database.isOpen).toBe(true);
  } finally { spy.mockRestore(); }
});


it.each(['SQLITE_IOERR_READ', 'SQLITE_IOERR_FSYNC', 'SQLITE_CANTOPEN', 'SQLITE_PERM', 'SQLITE_FULL',
  'SQLITE_BUSY', 'SQLITE_CORRUPT_INDEX', 'SQLITE_CORRUPT_VTAB', 'CORRUPT', 'NATIVE_CHANGED'])
('never treats %s as permission to replace a SQLite history directory', code => {
  const parent = root(), directory = path.join(parent, 'runs'); fs.mkdirSync(directory);
  const file = path.join(directory, 'data.sqlite3'), before = Buffer.alloc(16384, 7); fs.writeFileSync(file, before);
  const failure = Object.assign(new Error('Injected non-primary open failure'), { code });
  const spy = vi.spyOn(databaseStorage(SQLITE), 'open').mockImplementationOnce(() => { throw failure; });
  try {
    expect(() => openRunHistory(directory, { storageFormat: SQLITE })).toThrow(failure);
    expect(fs.readdirSync(parent).some(name => name.startsWith('runs.unreadable-'))).toBe(false);
    expect(fs.readFileSync(file)).toEqual(before);
  } finally { spy.mockRestore(); }
});

it('retains the directory claim when a failed SQLite constructor could not close its connection', () => {
  const parent = root(), directory = path.join(parent, 'runs');
  const seed = openRunHistory(directory, { storageFormat: SQLITE });
  const prototype = Object.getPrototypeOf((seed.database as unknown as { sql: object }).sql);
  seed.database.close();
  const file = path.join(directory, 'data.sqlite3'), before = Buffer.alloc(16384, 7); fs.writeFileSync(file, before);
  const closeFailure = new Error('Injected constructor cleanup failure');
  const originalClose = prototype.close as (this: { close(): unknown }) => unknown;
  let closeLeaked: (() => unknown) | undefined, failure: unknown;
  const spy = vi.spyOn(prototype, 'close').mockImplementationOnce(function (this: { close(): unknown }) {
    closeLeaked = originalClose.bind(this); throw closeFailure;
  });
  try {
    try { openRunHistory(directory, { storageFormat: SQLITE }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({ code: 'SQLITE_NOTADB', databaseConnectionUnclosed: true });
    expect((failure as AggregateError).errors).toContain(closeFailure);
    expect(() => holdRecoveryExclusion(directory)).toThrow('Close apps and tools using this profile');
    expect(fs.readdirSync(path.join(parent, 'db-readers'))).toHaveLength(1);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(parent).some(name => name.startsWith('runs.unreadable-'))).toBe(false);
  } finally {
    spy.mockRestore(); closeLeaked?.();
    // The fixture closes the captured native connection; production retains this claim until process exit.
  }
});


it('preserves failed SQLite constructor authority without an AggregateError prototype', () => {
  const parent = root(), directory = path.join(parent, 'runs'); fs.mkdirSync(directory);
  const file = path.join(directory, 'data.sqlite3'), before = Buffer.alloc(16384, 7); fs.writeFileSync(file, before);
  const failure = Object.assign(new Error('Unclosed constructor connection'), { code: 'SQLITE_NOTADB', databaseConnectionUnclosed: true });
  const spy = vi.spyOn(databaseStorage(SQLITE), 'open').mockImplementationOnce(() => { throw failure; });
  try {
    expect(() => openRunHistory(directory, { storageFormat: SQLITE })).toThrow(failure);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(path.join(parent, 'db-readers'))).toHaveLength(1);
    expect(fs.readdirSync(parent).some(name => name.startsWith('runs.unreadable-'))).toBe(false);
  } finally { spy.mockRestore(); }
});


it.each([ELMDB, SQLITE])('refuses stale %s history publication after another directory was installed', storageFormat => {
  const parent = root(), directory = path.join(parent, 'runs'), previous = path.join(parent, 'previous');
  fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, databaseStorage(storageFormat).dataFile), Buffer.alloc(16384, 7));
  const originalOpen = fs.openSync;
  let installed = false;
  const spy = vi.spyOn(fs, 'openSync').mockImplementation((...args: Parameters<typeof fs.openSync>) => {
    if (!installed && String(args[0]) === path.join(parent, 'db-recovery.lock') && args[1] === 'wx') {
      installed = true;
      // A cooperating publisher can win after the failed open releases its claim and before this lock.
      fs.renameSync(directory, previous);
      const replacement = openRunHistory(directory, { storageFormat }); replacement.database.close();
      fs.writeFileSync(path.join(directory, 'new-publication'), 'must survive');
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try {
    expect(() => openRunHistory(directory, { storageFormat })).toThrow(expect.objectContaining({ code: 'PUBLICATION_REFUSED' }));
    expect(installed).toBe(true);
    expect(fs.readFileSync(path.join(directory, 'new-publication'), 'utf8')).toBe('must survive');
    expect(fs.readdirSync(parent).some(name => name.startsWith('runs.unreadable-'))).toBe(false);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  const retry = openRunHistory(directory, { storageFormat }); opened.push(retry.database);
  expect(retry.database.isOpen).toBe(true);
});
