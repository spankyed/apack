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
