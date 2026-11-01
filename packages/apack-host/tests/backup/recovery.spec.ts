import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEarsEngine } from '@apackdev/ears';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { databaseStorage } from '../../src/database/storage.ts';
import { findDatabaseWriter, holdDatabaseWriteLock, publishRunningApp, openDatabaseStore, openRunHistory } from '../../src/database/index.ts';
import { assertNoImportRecovery, prepareImportRecovery } from '../../src/backup/recovery.ts';
import { holdRecoveryExclusion, openProfileDatabase } from '../../src/database/recovery-lock.ts';
import { listImportRecoveries, restoreImportRecovery } from '../../src/backup/restore.ts';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const schema = (type: string) => ({ types: { [type]: { required: [] } }, relations: {}, roles: [] });
function fixture(format: string, hadMedia = true) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-import-recovery-')); roots.push(userDataDir);
  const target = { ...resolveAppEnvironment({ env: 'test', userDataDir }), storageFormat: format };
  const paths = _appDataPaths(userDataDir), session = '.apack-import-owned', dir = path.join(path.dirname(paths.lmdb), session);
  fs.mkdirSync(path.join(dir, 'rollback'), { recursive: true });
  for (const [name, type] of [['lmdb', 'Row'], ['runHistory', 'RunNode']] as const) {
    const db = databaseStorage(format).open({ path: paths[name], schema: schema(type), syncs: false });
    try {
      const e = createEarsEngine({ database: db }); e.create(type, { id: `${type}-before` });
      db.backup(path.join(dir, 'rollback', name)); e.create(type, { id: `${type}-interrupted` });
    } finally { db.close(); }
  }
  fs.mkdirSync(paths.media, { recursive: true }); fs.writeFileSync(path.join(paths.media, 'asset'), 'candidate');
  if (hadMedia) { fs.mkdirSync(path.join(dir, 'rollback/media')); fs.writeFileSync(path.join(dir, 'rollback/media/asset'), 'incumbent'); }
  prepareImportRecovery(dir, [{ name: 'lmdb', path: paths.lmdb, format }, { name: 'runHistory', path: paths.runHistory, format }], paths.media);
  return { target, paths, session, dir, format };
}
function ids(dir: string, format: string, type = 'Row') {
  const db = databaseStorage(format).open({ path: dir, readOnly: true });
  try { return createEarsEngine({ database: db }).query(type).ids(); } finally { db.close(); }
}

it.each(['elmdb/1', 'sqlite/1'])('restores both %s stores and media, preserves forensic copies, and never replays completed recovery', format => {
  const f = fixture(format);
  expect(listImportRecoveries(f.target.userDataDir)).toEqual([{ session: f.session, status: 'pending', recoveryPath: path.join(f.dir, 'rollback') }]);
  expect(() => assertNoImportRecovery(f.paths.lmdb)).toThrow(expect.objectContaining({ code: 'RECOVERY_REQUIRED' }));
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
  expect(() => assertNoImportRecovery(f.paths.lmdb)).not.toThrow();
  expect(ids(f.paths.lmdb, format)).toEqual(['Row-before']);
  expect(ids(f.paths.runHistory, format, 'RunNode')).toEqual(['RunNode-before']);
  expect(ids(path.join(f.dir, 'interrupted/lmdb'), format)).toEqual(['Row-before', 'Row-interrupted']);
  expect(ids(path.join(f.dir, 'rollback/lmdb'), format)).toEqual(['Row-before']);
  expect(fs.readFileSync(path.join(f.paths.media, 'asset'), 'utf8')).toBe('incumbent');
  expect(fs.readFileSync(path.join(f.dir, 'interrupted/media/asset'), 'utf8')).toBe('candidate');
  const db = databaseStorage(format).open({ path: f.paths.lmdb, syncs: false });
  try { createEarsEngine({ database: db }).create('Row', { id: 'Row-later' }); } finally { db.close(); }
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
  expect(ids(f.paths.lmdb, format)).toEqual(['Row-before', 'Row-later']);
  expect(findDatabaseWriter(f.target.userDataDir)).toBeNull();
});

it.each(['move-incumbent', 'publish-incumbent'] as const)('resumes after interruption immediately following %s', boundary => {
  const f = fixture('sqlite/1'), failure = new Error('process interruption');
  const rename = fs.renameSync.bind(fs); let armed = true;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    rename(from, to);
    if (armed && String(to) === (boundary === 'move-incumbent' ? path.join(f.dir, 'interrupted/lmdb') : f.paths.lmdb)) {
      armed = false; throw failure;
    }
  });
  syncBuiltinESMExports();
  expect(() => restoreImportRecovery(f.target, f.session)).toThrow(failure);
  spy.mockRestore(); syncBuiltinESMExports();
  expect(listImportRecoveries(f.target.userDataDir)[0]?.status).toBe('restoring');
  expect(() => assertNoImportRecovery(f.paths.lmdb)).toThrow(expect.objectContaining({ code: 'RECOVERY_REQUIRED' }));
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
  expect(ids(f.paths.lmdb, f.format)).toEqual(['Row-before']);
  expect(ids(f.paths.runHistory, f.format, 'RunNode')).toEqual(['RunNode-before']);
});


// Exercise alias spelling on Linux too; macOS /var -> /private/var exposed this with real import records.
function aliasedFixture(format: string, recordAlias: boolean) {
  const f = fixture(format), alias = path.join(f.target.userDataDir, 'profile-alias');
  fs.symlinkSync(f.target.userDataDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const target = { ...resolveAppEnvironment({ env: 'test', userDataDir: recordAlias ? fs.realpathSync(f.target.userDataDir) : alias }), storageFormat: format };
  const paths = _appDataPaths(target.userDataDir), recorded = _appDataPaths(recordAlias ? alias : fs.realpathSync(f.target.userDataDir));
  prepareImportRecovery(f.dir, [{ name: 'lmdb', path: recorded.lmdb, format }, { name: 'runHistory', path: recorded.runHistory, format }], recorded.media);
  return { ...f, target, paths, originalTarget: f.target };
}

it.each(['elmdb/1', 'sqlite/1'].flatMap(format => [false, true].flatMap(recordAlias =>
  ['complete', 'move-incumbent', 'publish-incumbent'].map(boundary => ({ format, recordAlias, boundary })))))
('restores $format through parent aliases (recordAlias=$recordAlias) at $boundary', ({ format, recordAlias, boundary }) => {
  const f = aliasedFixture(format, recordAlias), failure = new Error('interrupted alias recovery');
  expect(listImportRecoveries(f.target.userDataDir)[0]?.status).toBe('pending');
  if (boundary !== 'complete') {
    const rename = fs.renameSync.bind(fs);
    const destination = boundary === 'move-incumbent'
      ? path.join(path.dirname(f.paths.lmdb), f.session, 'interrupted/lmdb') : f.paths.lmdb;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to);
      if (String(to) === destination) throw failure;
    });
    syncBuiltinESMExports();
    expect(() => restoreImportRecovery(f.target, f.session)).toThrow(failure);
    spy.mockRestore(); syncBuiltinESMExports();
    expect(listImportRecoveries(f.target.userDataDir)[0]?.status).toBe('restoring');
  }
  // A resumed operator may select the same physical profile through another spelling.
  expect(restoreImportRecovery(f.originalTarget, f.session).status).toBe('recovered');
  expect(ids(f.paths.lmdb, format)).toEqual(['Row-before']);
  expect(ids(f.paths.runHistory, format, 'RunNode')).toEqual(['RunNode-before']);
  expect(ids(path.join(f.dir, 'interrupted/lmdb'), format)).toEqual(['Row-before', 'Row-interrupted']);
  expect(fs.readFileSync(path.join(f.paths.media, 'asset'), 'utf8')).toBe('incumbent');
  expect(listImportRecoveries(f.target.userDataDir)[0]?.status).toBe('recovered');
});

it.each(['elmdb/1', 'sqlite/1'])('parent aliases preserve managed reader exclusion for %s', format => {
  const f = aliasedFixture(format, false);
  const reader = openRunHistory(_appDataPaths(f.originalTarget.userDataDir).runHistory, { readOnly: true, storageFormat: format });
  try { expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Close apps and tools using this profile'); }
  finally { reader.database.close(); }
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
});

it.each(['foreign-parent', 'different-leaf', 'relative', 'leaf-symlink'] as const)
('does not admit %s as a recovery destination through an alias', kind => {
  const f = aliasedFixture('sqlite/1', false), marker = path.join(f.dir, 'recovery.json');
  const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (kind === 'foreign-parent') {
    const foreign = path.join(f.target.userDataDir, 'foreign'); fs.mkdirSync(foreign);
    record.stores[0].path = path.join(foreign, path.basename(f.paths.lmdb));
  } else if (kind === 'different-leaf') record.stores[0].path = path.join(path.dirname(f.paths.lmdb), 'other');
  else if (kind === 'relative') {
    // path.relative(cwd, target) is absolute when Windows puts cwd and temp on different drives.
    record.stores[0].path = path.basename(f.paths.lmdb);
    expect(path.isAbsolute(record.stores[0].path)).toBe(false);
  }
  else {
    const moved = f.paths.lmdb + '-moved'; fs.renameSync(f.paths.lmdb, moved); fs.symlinkSync(moved, f.paths.lmdb, process.platform === 'win32' ? 'junction' : 'dir');
  }
  fs.writeFileSync(marker, JSON.stringify(record));
  expect(() => restoreImportRecovery(f.target, f.session)).toThrow(kind === 'leaf-symlink' ? 'ordinary directory' : 'does not match this profile');
  expect(fs.existsSync(path.join(f.dir, 'interrupted/lmdb'))).toBe(false);
  expect(fs.existsSync(marker)).toBe(true);
  expect(ids(f.paths.lmdb, f.format)).toEqual(['Row-before', 'Row-interrupted']);
});

it('restores the original absence of media', () => {
  const f = fixture('sqlite/1', false); restoreImportRecovery(f.target, f.session);
  expect(fs.existsSync(f.paths.media)).toBe(false);
  expect(fs.readFileSync(path.join(f.dir, 'interrupted/media/asset'), 'utf8')).toBe('candidate');
});

it('refuses a running app and another writer without staging or changing data', () => {
  const f = fixture('sqlite/1'); const running = publishRunningApp(f.target.userDataDir);
  try { expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Quit the app'); }
  finally { running(); }
  expect(findDatabaseWriter(f.target.userDataDir)).toBeNull();
  const lock = holdDatabaseWriteLock(f.target.userDataDir, 'another operation');
  try { expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Another tool'); }
  finally { lock.release(); }
  expect(fs.existsSync(path.join(f.dir, 'restore-stage'))).toBe(false);
  expect(ids(f.paths.lmdb, f.format)).toEqual(['Row-before', 'Row-interrupted']);
});

it('validates every incumbent before moving any live store', () => {
  const f = fixture('sqlite/1'); fs.writeFileSync(path.join(f.dir, 'rollback/runHistory/data.sqlite3'), 'damaged');
  expect(() => restoreImportRecovery(f.target, f.session)).toThrow();
  expect(fs.existsSync(path.join(f.dir, 'interrupted'))).toBe(false);
  expect(ids(f.paths.lmdb, f.format)).toEqual(['Row-before', 'Row-interrupted']);
  expect(findDatabaseWriter(f.target.userDataDir)).toBeNull();
});

it('refuses a changed stage on resume and keeps the preparation', () => {
  const f = fixture('sqlite/1');
  const rename = fs.renameSync.bind(fs);
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === path.join(f.dir, 'interrupted/lmdb')) throw new Error('stop before publication');
    rename(from, to);
  });
  syncBuiltinESMExports();
  expect(() => restoreImportRecovery(f.target, f.session)).toThrow('stop before publication'); spy.mockRestore(); syncBuiltinESMExports();
  fs.appendFileSync(path.join(f.dir, 'restore-stage/runHistory/data.sqlite3'), 'changed');
  expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Recovery copy changed');
  expect(fs.existsSync(path.join(f.dir, 'recovery.json'))).toBe(true);
  expect(ids(f.paths.lmdb, f.format)).toEqual(['Row-before', 'Row-interrupted']);
});

it('rejects path traversal, foreign profile destinations and mismatched format', () => {
  const f = fixture('sqlite/1');
  expect(() => restoreImportRecovery(f.target, '../escape')).toThrow('Name one');
  expect(() => restoreImportRecovery({ ...f.target, storageFormat: 'elmdb/1' }, f.session)).toThrow('storage format');
  const file = path.join(f.dir, 'recovery.json'), original = JSON.parse(fs.readFileSync(file, 'utf8'));
  original.stores[0].path = path.join(f.target.userDataDir, 'outside'); fs.writeFileSync(file, JSON.stringify(original));
  expect(() => restoreImportRecovery(f.target, f.session)).toThrow('does not match this profile');
  expect(fs.existsSync(path.join(f.dir, 'restore-stage'))).toBe(false);
});

it.each(['lmdb', 'runHistory'] as const)('excludes an open managed %s reader until it closes', name => {
  const f = fixture('sqlite/1');
  const reader = name === 'runHistory' ? openRunHistory(f.paths.runHistory, { readOnly: true, storageFormat: f.format })
    : openDatabaseStore({ path: f.paths.lmdb, readOnly: true, storageFormat: f.format, schema: {
      getRegisteredEntityTypes: () => new Set(['Row']), getRegisteredRelationKinds: () => new Set<string>(), getRegisteredRoles: () => new Set<string>(),
    } });
  try {
    expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Close apps and tools using this profile');
    expect(fs.existsSync(path.join(f.dir, 'restore-stage'))).toBe(false);
  } finally { reader.database.close(); }
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
});

it('refuses new readers during physical replacement and releases failed-open claims', () => {
  const f = fixture('sqlite/1'), exclusion = holdRecoveryExclusion(f.paths.lmdb);
  try {
    expect(() => openRunHistory(f.paths.runHistory, { readOnly: true, storageFormat: f.format })).toThrow('Wait for import recovery');
  } finally { exclusion.release(); }
  const failure = new Error('database open refused');
  expect(() => openProfileDatabase(f.paths.lmdb, true, () => { throw failure; })).toThrow(failure);
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
});

it.skipIf(process.platform === 'win32')('refuses a managed open without writable metadata while direct read-only snapshots remain available', () => {
  const f = fixture('sqlite/1'), parent = path.dirname(f.paths.lmdb);
  fs.chmodSync(parent, 0o500);
  try {
    expect(() => openRunHistory(f.paths.runHistory, { readOnly: true, storageFormat: f.format })).toThrow();
    expect(ids(f.paths.runHistory, f.format, 'RunNode')).toEqual(['RunNode-before', 'RunNode-interrupted']);
  } finally { fs.chmodSync(parent, 0o700); }
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
});

it.each([true, false])('retains a managed handle claim when close fails (readOnly=%s)', readOnly => {
  const f = fixture('sqlite/1'), reader = { database: openProfileDatabase(f.paths.runHistory, readOnly,
    () => databaseStorage(f.format).open({ path: f.paths.runHistory, readOnly })) };
  const sql = (reader.database as unknown as { sql: { close(): void } }).sql;
  const failure = new Error('database close failed');
  const spy = vi.spyOn(sql, 'close').mockImplementationOnce(() => { throw failure; });
  try {
    expect(() => reader.database.close()).toThrow(failure);
    expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Close apps and tools using this profile');
  } finally { spy.mockRestore(); reader.database.close(); }
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
});

it.each(['invalid record', JSON.stringify({ pid: process.pid, machine: 'another-host', what: 'reader', since: 'now' })])('refuses unresolved reader ownership (%s)', record => {
  const f = fixture('sqlite/1'), dir = path.join(path.dirname(f.paths.lmdb), 'db-readers'), file = path.join(dir, 'unresolved.json');
  fs.mkdirSync(dir); fs.writeFileSync(file, record);
  expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Close apps and tools using this profile');
  expect(fs.existsSync(path.join(f.dir, 'restore-stage'))).toBe(false);
  expect(findDatabaseWriter(f.target.userDataDir)).toBeNull();
  fs.unlinkSync(file);
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
});


it.each(['elmdb/1', 'sqlite/1'])('excludes writable %s handles from physical recovery until close', format => {
  const f = fixture(format);
  for (const [name, type] of [['lmdb', 'Row'], ['runHistory', 'RunNode']] as const) {
    // This handle predates the recovery attempt; use the real managed-open protocol and real backend.
    const database = openProfileDatabase(f.paths[name], false, () => databaseStorage(format).open({ path: f.paths[name] }));
    const engine = createEarsEngine({ database });
    try {
      engine.create(type, { id: `${type}-held` });
      expect(() => restoreImportRecovery(f.target, f.session)).toThrow('Close apps and tools using this profile');
      expect(fs.existsSync(path.join(f.dir, 'restore-stage'))).toBe(false);
      expect(engine.query(type).ids()).toContain(`${type}-held`);
      engine.create(type, { id: `${type}-still-writable` });
    } finally { database.close(); }
  }
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
  expect(ids(f.paths.lmdb, format)).toEqual(['Row-before']);
});

it.each([false, undefined])('refuses a new writable open during publication (readOnly=%s)', readOnly => {
  const f = fixture('sqlite/1'), exclusion = holdRecoveryExclusion(f.paths.lmdb);
  let database: ReturnType<typeof openProfileDatabase> | undefined, entered = false;
  try {
    expect(() => openProfileDatabase(f.paths.runHistory, readOnly, () => {
      entered = true; database = databaseStorage(f.format).open({ path: f.paths.runHistory }); return database;
    })).toThrow('Wait for import recovery');
    expect(entered).toBe(false);
  } finally { database?.close(); exclusion.release(); }
  expect(restoreImportRecovery(f.target, f.session).status).toBe('recovered');
});

it('a store-only publication excludes that store but permits an unrelated sibling handle', () => {
  const f = fixture('sqlite/1');
  const primary = openProfileDatabase(f.paths.lmdb, false, () => databaseStorage(f.format).open({ path: f.paths.lmdb }));
  try {
    const exclusion = holdRecoveryExclusion(f.paths.runHistory, 'store');
    try { expect(() => holdRecoveryExclusion(f.paths.lmdb, 'store')).toThrow('recovery is already active'); }
    finally { exclusion.release(); }
    expect(() => holdRecoveryExclusion(f.paths.lmdb, 'store')).toThrow('Close apps and tools using this profile');
  } finally { primary.close(); }
  const exclusion = holdRecoveryExclusion(f.paths.lmdb, 'store'); exclusion.release();
});

it('a store-only publication refuses claims whose database identity is unresolved', () => {
  const f = fixture('sqlite/1'), registry = path.join(path.dirname(f.paths.lmdb), 'db-readers');
  fs.mkdirSync(registry);
  fs.writeFileSync(path.join(registry, 'unknown.json'), JSON.stringify({ pid: process.pid, machine: os.hostname(), what: 'unknown tool' }));
  expect(() => holdRecoveryExclusion(f.paths.runHistory, 'store')).toThrow('Close apps and tools using this profile');
});


it.each([true, false])('refuses managed database-leaf aliases before opening (readOnly=%s)', readOnly => {
  const f = fixture('sqlite/1'), alias = path.join(path.dirname(f.paths.runHistory), 'history-alias');
  fs.symlinkSync(f.paths.runHistory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  let entered = false;
  expect(() => openProfileDatabase(alias, readOnly, () => {
    entered = true; return databaseStorage(f.format).open({ path: alias, readOnly });
  })).toThrow('ordinary database directory');
  expect(entered).toBe(false);
  expect(fs.existsSync(path.join(path.dirname(f.paths.runHistory), 'db-readers'))).toBe(false);
  // An explicit unmanaged forensic snapshot may still inspect the target through its alias.
  expect(ids(alias, f.format, 'RunNode')).toEqual(['RunNode-before', 'RunNode-interrupted']);
});


it('excludes physical directory identity even when its claim uses another leaf spelling', () => {
  const f = fixture('sqlite/1');
  const database = openProfileDatabase(f.paths.runHistory, false, () => databaseStorage(f.format).open({ path: f.paths.runHistory }));
  const registry = path.join(path.dirname(f.paths.runHistory), 'db-readers'), files = fs.readdirSync(registry);
  expect(files).toHaveLength(1);
  const file = path.join(registry, files[0]), record = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(record.directory).toMatch(/^\d+:[1-9]\d*$/);
  fs.writeFileSync(file, JSON.stringify({ ...record, database: 'another-leaf-spelling' }));
  let unexpected: ReturnType<typeof holdRecoveryExclusion> | undefined;
  try {
    expect(() => { unexpected = holdRecoveryExclusion(f.paths.runHistory, 'store'); }).toThrow('Close apps and tools using this profile');
  } finally { unexpected?.release(); database.close(); }
});
