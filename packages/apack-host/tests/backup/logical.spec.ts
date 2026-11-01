import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEarsEngine, type EarsDatabase } from '@apackdev/ears';
import { openDatabase, stageLogicalSnapshot } from '@apackdev/ears/sqlite';
import { databaseBackupStore, exportLogicalDatabase, importLogicalDatabase, readLogicalBackup, type BackupStores } from '../../src/backup/index.ts';
const roots: string[] = [], databases: EarsDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const root = () => { const value = fs.mkdtempSync(path.join(tmpdir(), 'apack-logical-backup-')); roots.push(value); return value; };
function open(dir: string, type = 'Row') {
  const db = openDatabase({ path: dir, syncs: false, schema: { types: { [type]: { required: [] } }, relations: {}, roles: [] } });
  databases.push(db); return { db, e: createEarsEngine({ database: db }) };
}
function fixture() {
  const parent = root(), source = open(path.join(parent, 'source')), current = open(path.join(parent, 'lmdb'));
  source.e.create('Row', { id: 'Row-candidate', negative: -0, text: 'candidate' });
  current.e.create('Row', { id: 'Row-incumbent', text: 'incumbent' });
  const media = path.join(parent, 'media'); fs.mkdirSync(media); fs.writeFileSync(path.join(media, 'asset'), 'incumbent media');
  const archive = path.join(parent, 'primary.ears'), stores: BackupStores = { lmdb: databaseBackupStore(current.db, current.e) };
  return { parent, source, current, media, archive, stores };
}
const log = { info: () => {}, warn: () => {} };
it('exclusively publishes a complete private archive readable through the app-only staging API', async () => {
  const f = fixture(); expect(await exportLogicalDatabase(f.source.db, f.archive)).toBe(f.archive);
  expect(fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-logical-export-'))).toEqual([]);
  if (process.platform !== 'win32') expect(fs.statSync(f.archive).mode & 0o777).toBe(0o600);
  const result = await stageLogicalSnapshot(fs.createReadStream(f.archive), path.join(f.parent, 'check'));
  const db = openDatabase({ path: result.path, readOnly: true }); databases.push(db);
  expect(createEarsEngine({ database: db }).query('Row').ids()).toEqual(['Row-candidate']);
});
it('preserves an existing output and a racing output without replacing either', async () => {
  const f = fixture(); fs.writeFileSync(f.archive, 'incumbent');
  await expect(exportLogicalDatabase(f.source.db, f.archive)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(fs.readFileSync(f.archive, 'utf8')).toBe('incumbent'); fs.unlinkSync(f.archive);
  const link = fs.linkSync, spy = vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
    if (to === f.archive) fs.writeFileSync(f.archive, 'racing incumbent');
    return link(from, to);
  }); syncBuiltinESMExports();
  await expect(exportLogicalDatabase(f.source.db, f.archive)).rejects.toMatchObject({ code: 'EEXIST' }); spy.mockRestore(); syncBuiltinESMExports();
  expect(fs.readFileSync(f.archive, 'utf8')).toBe('racing incumbent');
  expect(fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-logical-export-'))).toEqual([]);
});
it('cleans refused publication and leaves no final artifact on an unsupported filesystem operation', async () => {
  const f = fixture(), error = Object.assign(new Error('exclusive publication unsupported'), { code: 'ENOTSUP' });
  vi.spyOn(fs, 'linkSync').mockImplementation(() => { throw error; }); syncBuiltinESMExports();
  await expect(exportLogicalDatabase(f.source.db, f.archive)).rejects.toBe(error);
  expect(fs.existsSync(f.archive)).toBe(false);
  expect(fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-logical-export-'))).toEqual([]);
});
it('reports a published but unsynchronized directory truthfully and retains its complete archive', async () => {
  const f = fixture(), fsync = fs.fsyncSync;
  const error = Object.assign(new Error('directory sync IO'), { code: 'EIO' });
  const spy = vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (fs.fstatSync(fd).isDirectory()) throw error; return fsync(fd); }); syncBuiltinESMExports();
  await expect(exportLogicalDatabase(f.source.db, f.archive)).rejects.toMatchObject({ code: 'NOT_DURABLE', publishedPath: f.archive });
  spy.mockRestore(); syncBuiltinESMExports();
  await expect(stageLogicalSnapshot(fs.createReadStream(f.archive), path.join(f.parent, 'check'))).resolves.toMatchObject({ audit: { ok: true } });
});
it('replaces a populated store through the existing coordinator and preserves separately owned media', async () => {
  const f = fixture(); await exportLogicalDatabase(f.source.db, f.archive); const before = f.current.e.lastCommit();
  const seen: string[][] = [], watch = f.current.e.watch(() => f.current.e.query('Row').ids(), ids => seen.push([...ids]));
  try {
    await f.current.e.admin.watchesSettled();
    const result = await importLogicalDatabase(f.stores, { lmdb: f.archive }, f.media, { log });
    expect(result.databases).toEqual(['lmdb']); await f.current.e.admin.watchesSettled();
    expect(seen).toEqual([['Row-incumbent'], ['Row-candidate']]);
    expect(Object.is(f.current.e.getAttr('Row-candidate', 'negative'), -0)).toBe(true);
    expect(f.current.e.lastCommit()).toBeGreaterThan(before);
    expect(fs.readFileSync(path.join(f.media, 'asset'), 'utf8')).toBe('incumbent media');
    expect(fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-'))).toEqual([]);
  } finally { watch.stop(); }
});
it('validates all selected stores before replacing either, then imports primary and run history together', async () => {
  const f = fixture(), sourceRuns = open(path.join(f.parent, 'source-runs'), 'RunNode'), runs = open(path.join(f.parent, 'runHistory'), 'RunNode');
  sourceRuns.e.create('RunNode', { id: 'RunNode-candidate' }); runs.e.create('RunNode', { id: 'RunNode-incumbent' });
  const stores = { ...f.stores, runHistory: databaseBackupStore(runs.db, runs.e) }, history = path.join(f.parent, 'runs.ears');
  await exportLogicalDatabase(f.source.db, f.archive); await exportLogicalDatabase(sourceRuns.db, history);
  const valid = fs.readFileSync(history); fs.writeFileSync(history, valid.subarray(0, -1));
  const primaryReplace = vi.spyOn(f.current.db, 'replaceWith'), historyReplace = vi.spyOn(runs.db, 'replaceWith');
  await expect(importLogicalDatabase(stores, { lmdb: f.archive, runHistory: history }, f.media, { log })).rejects.toThrow();
  expect(primaryReplace).not.toHaveBeenCalled(); expect(historyReplace).not.toHaveBeenCalled();
  expect(f.current.e.query('Row').ids()).toEqual(['Row-incumbent']); expect(runs.e.query('RunNode').ids()).toEqual(['RunNode-incumbent']);
  fs.writeFileSync(history, valid);
  await importLogicalDatabase(stores, { lmdb: f.archive, runHistory: history }, f.media, { log });
  expect(f.current.e.query('Row').ids()).toEqual(['Row-candidate']); expect(runs.e.query('RunNode').ids()).toEqual(['RunNode-candidate']);
});
it('restores the incumbent when acceptance refuses a logical import', async () => {
  const f = fixture(); await exportLogicalDatabase(f.source.db, f.archive);
  const restored = vi.fn();
  await expect(importLogicalDatabase(f.stores, { lmdb: f.archive }, f.media, { log,
    accept: async () => { expect(f.current.e.query('Row').ids()).toEqual(['Row-candidate']); throw Error('refused hydration'); }, restored,
  })).rejects.toThrow('refused hydration');
  expect(restored).toHaveBeenCalledOnce(); expect(f.current.e.query('Row').ids()).toEqual(['Row-incumbent']);
  expect(fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-'))).toEqual([]);
});
it('retains the ordinary recovery journal after an uncertain logical replacement', async () => {
  const f = fixture(); await exportLogicalDatabase(f.source.db, f.archive);
  const error = Object.assign(new Error('replacement acknowledgement lost'), { code: 'COMMIT_UNKNOWN' });
  vi.spyOn(f.current.db, 'replaceWith').mockImplementation(() => { throw error; });
  await expect(importLogicalDatabase(f.stores, { lmdb: f.archive }, f.media, { log })).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN', recoveryPath: expect.any(String) });
  const recovery = fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-import-')); expect(recovery).toHaveLength(1);
  expect(fs.existsSync(path.join(f.parent, recovery[0]!, 'recovery.json'))).toBe(true);
  expect(fs.existsSync(path.join(f.parent, recovery[0]!, 'rollback/lmdb/data.sqlite3'))).toBe(true);
  expect(fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-logical-import-'))).toEqual([]);
});

it('imports only run history without replacing or advancing the primary database', async () => {
  const f = fixture(), source = open(path.join(f.parent, 'source-runs'), 'RunNode'), history = open(path.join(f.parent, 'runHistory'), 'RunNode');
  source.e.create('RunNode', { id: 'RunNode-candidate' }); history.e.create('RunNode', { id: 'RunNode-incumbent' });
  const file = path.join(f.parent, 'history.ears'); await exportLogicalDatabase(source.db, file);
  const stores = { ...f.stores, runHistory: databaseBackupStore(history.db, history.e) }, before = f.current.e.lastCommit();
  const replace = vi.spyOn(f.current.db, 'replaceWith'), validate = vi.fn(() => { throw Error('Unrelated primary validator must not run'); });
  const preview = await readLogicalBackup(stores, { runHistory: file }, [], validate);
  expect(preview).toMatchObject({ databases: ['runHistory'], counts: [], hasMedia: false });
  expect(history.e.query('RunNode').ids()).toEqual(['RunNode-incumbent']);
  await importLogicalDatabase(stores, { runHistory: file }, f.media, { log, validate });
  expect(validate).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  expect(f.current.e.lastCommit()).toBe(before); expect(f.current.e.query('Row').ids()).toEqual(['Row-incumbent']);
  expect(history.e.query('RunNode').ids()).toEqual(['RunNode-candidate']);
});
it('fully validates preview archives and primary acceptance without touching either live store', async () => {
  const f = fixture(); await exportLogicalDatabase(f.source.db, f.archive);
  const before = f.current.e.lastCommit(), replace = vi.spyOn(f.current.db, 'replaceWith'), validate = vi.fn();
  const preview = await readLogicalBackup(f.stores, { lmdb: f.archive }, ['Row'], validate);
  expect(preview).toMatchObject({ databases: ['lmdb'], counts: [['Row', 1]], hasMedia: false }); expect(validate).toHaveBeenCalledOnce();
  await expect(readLogicalBackup(f.stores, { lmdb: f.archive }, [], () => { throw Error('preview validation refused'); })).rejects.toThrow('preview validation refused');
  const bytes = fs.readFileSync(f.archive); fs.writeFileSync(f.archive, bytes.subarray(0, -1));
  await expect(readLogicalBackup(f.stores, { lmdb: f.archive })).rejects.toThrow('Truncated');
  expect(replace).not.toHaveBeenCalled(); expect(f.current.e.lastCommit()).toBe(before);
  expect(fs.readdirSync(f.parent).filter(name => name.startsWith('.apack-logical-import-'))).toEqual([]);
});
