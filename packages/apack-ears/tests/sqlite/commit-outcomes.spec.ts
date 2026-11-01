import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const schema: EngineSchema = { types: { Row: { required: [] } }, relations: {}, roles: [] };
const stores: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open(path?: string) {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-commit-outcome-')); paths.push(path); }
  const db = new SqliteDatabase({ path, syncs: false, ...(!stores.some(store => store.path === path) ? { schema: toElmdbSchema(schema) } : {}) });
  stores.push(db); return { db, e: createEarsEngine({ database: db }) };
}
function lostAcknowledgement(db: SqliteDatabase, applied: boolean) {
  const cause = Object.assign(new Error(applied ? 'commit acknowledgement lost' : 'commit sync failed'), { code: applied ? 'DRIVER_ACK_LOST' : 'SQLITE_IOERR_FSYNC' });
  const exec = db.sql.exec.bind(db.sql); let armed = true;
  const spy = vi.spyOn(db.sql, 'exec').mockImplementation(sql => {
    if (sql === 'COMMIT' && armed) { armed = false; exec(applied ? sql : 'ROLLBACK'); throw cause; }
    return exec(sql);
  });
  return { cause, spy };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite commit outcome handling', () => {
  it('commits the last representable identity then refuses further writes without data or watch changes', async () => {
    const { db, e } = open();
    db.run('INSERT OR REPLACE INTO meta VALUES (?,?)', ['commit', db.pack(Number.MAX_SAFE_INTEGER - 1)]);
    e.create('Row', { id: 'Row-last' });
    expect(db.sequence).toBe(Number.MAX_SAFE_INTEGER);
    const seen: string[][] = [], watch = e.watch(() => e.query('Row').ids(), ids => seen.push([...ids]));
    try {
      await e.admin.watchesSettled();
      expect(() => e.create('Row', { id: 'Row-refused' })).toThrow(expect.objectContaining({ code: 'NUMBERS_EXHAUSTED' }));
      expect(db.sql.inTransaction).toBe(false);
      expect(db.sequence).toBe(Number.MAX_SAFE_INTEGER);
      expect(e.query('Row').ids()).toEqual(['Row-last']);
      await e.admin.watchesSettled(); expect(seen).toEqual([['Row-last']]);
    } finally { watch.stop(); }
  });

  it.each([{ name: 'null', value: null }, { name: 'numeric text', value: '7' }])(
    'refuses malformed commit metadata without overwriting it ($name)', ({ value }) => {
      const { db, e } = open(); e.create('Row', { id: 'Row-before' });
      db.run('INSERT OR REPLACE INTO meta VALUES (?,?)', ['commit', db.pack(value)]);
      const original = db.get('SELECT value FROM meta WHERE key=?', ['commit'])!.value;
      expect(() => e.create('Row', { id: 'Row-refused' }))
        .toThrow(expect.objectContaining({ code: 'CORRUPT' }));
      expect(db.sql.inTransaction).toBe(false);
      expect(e.query('Row').ids()).toEqual(['Row-before']);
      expect(db.get('SELECT value FROM meta WHERE key=?', ['commit'])!.value).toEqual(original);
    }
  );

  it.each(['schema', 'bulkLoad'] as const)('rolls back %s when the commit identity is exhausted', operation => {
    const { db, e } = open(); e.create('Row', { id: 'Row-before' });
    db.run('INSERT OR REPLACE INTO meta VALUES (?,?)', ['commit', db.pack(Number.MAX_SAFE_INTEGER)]);
    const before = db.schema, jobs = db.indexBuilds.jobs();
    expect(() => operation === 'schema'
      ? e.admin.declare({ ...schema, types: { Added: { required: [] } } })
      : db.bulkLoad([{ load: 'entity', id: 'Row-refused', fields: { title: 'candidate' } }]))
      .toThrow(expect.objectContaining({ code: 'NUMBERS_EXHAUSTED' }));
    expect(db.sql.inTransaction).toBe(false); expect(db.sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(db.schema).toEqual(before); expect(db.indexBuilds.jobs()).toEqual(jobs);
    expect(e.query('Row').ids()).toEqual(['Row-before']);
    db.close(); const reopened = open(db.path);
    expect(reopened.db.schema).toEqual(before); expect(reopened.db.sequence).toBe(Number.MAX_SAFE_INTEGER);
    expect(reopened.e.query('Row').ids()).toEqual(['Row-before']);
  });

  it('admits the last schema revision then refuses declaration and rebuild without rounding it', () => {
    const original = open(); original.e.create('Row', { id: 'Row-before' });
    original.db.run('INSERT OR REPLACE INTO meta VALUES (?,?)', ['schemaRevision', original.db.pack(Number.MAX_SAFE_INTEGER - 1)]);
    original.db.close();
    const { db, e } = open(original.db.path);
    e.admin.declare({ ...schema, types: { Added: { required: [] } } });
    const before = db.schema, sequence = db.sequence, jobs = db.indexBuilds.jobs();
    const revision = () => db.unpack(db.get('SELECT value FROM meta WHERE key=?', ['schemaRevision'])!.value);
    expect(revision()).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => e.admin.declare({ ...schema, types: { More: { required: [] } } }))
      .toThrow(expect.objectContaining({ code: 'NUMBERS_EXHAUSTED' }));
    expect(() => db.rebuildIndexes()).toThrow(expect.objectContaining({ code: 'NUMBERS_EXHAUSTED' }));
    expect(db.sql.inTransaction).toBe(false); expect(revision()).toBe(Number.MAX_SAFE_INTEGER);
    expect(db.schema).toEqual(before); expect(db.sequence).toBe(sequence);
    expect(db.indexBuilds.jobs()).toEqual(jobs); expect(e.query('Row').ids()).toEqual(['Row-before']);
  });

  it.each([false, true])('does not invent a committed/refused answer after an ended commit error (applied: %s)', async applied => {
    const { db, e } = open(); e.create('Row', { id: 'Row-before' });
    const sequence = db.sequence, seen: string[][] = [], watch = e.watch(() => e.query('Row').ids(), ids => seen.push([...ids]));
    await e.admin.watchesSettled();
    const { cause, spy } = lostAcknowledgement(db, applied);
    let failure: unknown;
    try { e.create('Row', { id: 'Row-candidate' }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'COMMIT_UNKNOWN', cause });
    expect(db.sql.inTransaction).toBe(false);
    const calls = spy.mock.calls.length;
    expect(() => e.create('Row', { id: 'Row-no-replay' })).toThrow(failure as Error);
    expect(() => e.query('Row').ids()).toThrow(failure as Error);
    await expect(db.indexesReady()).rejects.toBe(failure);
    expect(spy.mock.calls.length).toBe(calls);
    await e.admin.watchesSettled(); expect(seen).toEqual([['Row-before']]);
    watch.stop(); spy.mockRestore(); db.close();
    const reopened = open(db.path);
    expect(reopened.db.sequence).toBe(sequence + (applied ? 1 : 0));
    expect(reopened.e.query('Row').ids()).toEqual(applied ? ['Row-before', 'Row-candidate'] : ['Row-before']);
    reopened.e.create('Row', { id: 'Row-recovered' });
  });

  it.each(['SQLITE_BUSY', undefined])('rolls back a failed commit that still has an active transaction (%s)', code => {
    const { db, e } = open(); e.create('Row', { id: 'Row-before' }); const sequence = db.sequence;
    const error = Object.assign(new Error('commit refused before completion'), { code });
    const exec = db.sql.exec.bind(db.sql); let armed = true;
    vi.spyOn(db.sql, 'exec').mockImplementation(sql => { if (sql === 'COMMIT' && armed) { armed = false; throw error; } return exec(sql); });
    expect(() => e.create('Row', { id: 'Row-refused' })).toThrow(error);
    expect(db.sql.inTransaction).toBe(false); expect(db.sequence).toBe(sequence);
    expect(e.query('Row').ids()).toEqual(['Row-before']); e.create('Row', { id: 'Row-recovered' });
  });

  it('refuses replacement before commit when closing its source fails', async () => {
    const { db, e } = open(), source = open();
    e.create('Row', { id: 'Row-before' }); source.e.create('Row', { id: 'Row-candidate' }); source.db.close();
    const sequence = db.sequence, seen: string[][] = [];
    const watch = e.watch(() => e.query('Row').ids(), ids => seen.push([...ids]));
    await e.admin.watchesSettled();
    const cleanup = Object.assign(new Error('source close failed'), { code: 'SQLITE_IOERR' });
    const close = SqliteDatabase.prototype.close;
    vi.spyOn(SqliteDatabase.prototype, 'close').mockImplementation(function (this: SqliteDatabase) {
      const incoming = this.path === source.db.path && this.isOpen;
      close.call(this);
      if (incoming) throw cleanup;
    });
    const exec = vi.spyOn(db.sql, 'exec');
    try {
      expect(() => e.admin.replaceWith(source.db.path)).toThrow(cleanup);
      expect(exec.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
      expect(db.sequence).toBe(sequence); expect(e.query('Row').ids()).toEqual(['Row-before']);
      await e.admin.watchesSettled(); expect(seen).toEqual([['Row-before']]);
      e.create('Row', { id: 'Row-recovered' });
    } finally { watch.stop(); }
  });

  it.each([false, true])('keeps the primary replacement refusal when source cleanup also fails (undefined: %s)', thrownUndefined => {
    const { db, e } = open(), source = open();
    e.create('Row', { id: 'Row-before' }); source.e.create('Row', { id: 'Row-candidate' }); source.db.close();
    const refusal = thrownUndefined ? undefined : Object.assign(new Error('replacement refused'), { code: 'REPLACEMENT_REFUSED' });
    const cleanup = new Error('source cleanup failed'), close = SqliteDatabase.prototype.close;
    vi.spyOn(db.values, 'restoreCell').mockImplementationOnce(() => { throw refusal; });
    vi.spyOn(SqliteDatabase.prototype, 'close').mockImplementation(function (this: SqliteDatabase) {
      const incoming = this.path === source.db.path && this.isOpen;
      close.call(this);
      if (incoming) throw cleanup;
    });
    let failure: unknown;
    try { e.admin.replaceWith(source.db.path); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({ cause: refusal, code: refusal?.code, errors: [refusal, cleanup] });
    expect(e.query('Row').ids()).toEqual(['Row-before']); e.create('Row', { id: 'Row-recovered' });
  });

  it.each([false, true])('closes the replacement source before an uncertain destination commit (applied: %s)', applied => {
    const { db, e } = open(), source = open();
    e.create('Row', { id: 'Row-before' }); source.e.create('Row', { id: 'Row-candidate' }); source.db.close();
    const sequence = db.sequence, close = SqliteDatabase.prototype.close;
    let sourceClosed = 0;
    vi.spyOn(SqliteDatabase.prototype, 'close').mockImplementation(function (this: SqliteDatabase) {
      const incoming = this.path === source.db.path && this.isOpen;
      close.call(this);
      if (incoming) {
        sourceClosed++;
        if (!db.sql.inTransaction) throw new Error('source closed after destination commit');
      }
    });
    const { cause, spy } = lostAcknowledgement(db, applied);
    expect(() => e.admin.replaceWith(source.db.path)).toThrow(expect.objectContaining({ code: 'COMMIT_UNKNOWN', cause }));
    expect(sourceClosed).toBe(1);
    expect(() => e.query('Row').ids()).toThrow(expect.objectContaining({ code: 'COMMIT_UNKNOWN', cause }));
    spy.mockRestore(); db.close(); const reopened = open(db.path);
    expect(reopened.db.sequence).toBe(sequence + (applied ? 1 : 0));
    expect(reopened.e.query('Row').ids()).toEqual(applied ? ['Row-candidate'] : ['Row-before']);
  });

  it('captures fallible watch changes before committing', () => {
    const { db, e } = open(), sequence = db.sequence;
    const error = new Error('change capture failed');
    const capture = vi.spyOn(db as unknown as { touched(changes: Set<string>): number[] }, 'touched').mockImplementationOnce(() => { throw error; });
    expect(() => e.create('Row', { id: 'Row-refused' })).toThrow(error);
    capture.mockRestore(); expect(db.sequence).toBe(sequence); expect(e.query('Row').ids()).toEqual([]);
    e.create('Row', { id: 'Row-recovered' });
  });

  it.each(['schema', 'bulkLoad'] as const)('uses the same uncertain-commit boundary for %s', operation => {
    const { db, e } = open(); e.create('Row', { id: 'Row-before' });
    const { cause, spy } = lostAcknowledgement(db, true);
    expect(() => operation === 'schema'
      ? e.admin.declare({ ...schema, types: { Added: { required: [] } } })
      : db.bulkLoad([{ load: 'entity', id: 'Row-candidate', fields: { title: 'candidate' } }]))
      .toThrow(expect.objectContaining({ code: 'COMMIT_UNKNOWN', cause }));
    expect(() => e.query('Row').ids()).toThrow(expect.objectContaining({ code: 'COMMIT_UNKNOWN' }));
    spy.mockRestore(); db.close(); const reopened = open(db.path);
    if (operation === 'schema') expect((reopened.db.schema as { types: object }).types).toHaveProperty('Added');
    else expect(reopened.e.query('Row').ids()).toEqual(['Row-before', 'Row-candidate']);
  });

  it('stops a background commit without replaying it or writing a false failure marker', async () => {
    const { db, e } = open(); for (let i = 0; i < 150; i++) e.create('Row', { title: 'marker ' + i });
    e.admin.setSchema({ ...schema, types: { Row: { required: [], substrings: ['title'] } } });
    const ready = db.indexesReady(); const rejection = expect(ready).rejects.toMatchObject({ code: 'COMMIT_UNKNOWN' });
    const { spy } = lostAcknowledgement(db, true);
    expect(db.indexBuilds.step()).toBe('failed'); await rejection;
    expect(spy.mock.calls.map(([sql]) => sql).filter(sql => sql === 'COMMIT')).toHaveLength(1);
    expect(spy.mock.calls.map(([sql]) => sql).filter(sql => sql.startsWith('ROLLBACK'))).toEqual([]);
    spy.mockRestore(); db.close(); const reopened = open(db.path); await reopened.db.indexesReady();
    expect(reopened.e.query('Row').containing('marker').count()).toBe(150);
  });
});
