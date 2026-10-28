import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => {
  vi.restoreAllMocks(); const opened = held.splice(0);
  for (const { db } of opened) db.close();
  for (const path of new Set(opened.map(entry => entry.path))) rmSync(path, { recursive: true, force: true });
});
function open() {
  const path = mkdtempSync(join(tmpdir(), 'ears-sqlite-full-'));
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: { Row: { required: [] } }, relations: {}, roles: [] }) });
  held.push({ db, path });
  const e = createEarsEngine({ database: db }); e.create('Row', { id: 'Row-before', title: 'incumbent' });
  db.sql.pragma('wal_checkpoint(TRUNCATE)');
  return { db, e, path };
}
function limit(db: SqliteDatabase) { db.sql.pragma(`max_page_count=${Number(db.sql.pragma('page_count', { simple: true })) + 8}`); }
const restoreCapacity = (db: SqliteDatabase) => db.sql.pragma('max_page_count=2147483646');
const large = 'x'.repeat(2 * 1024 * 1024);

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite transaction failure state', () => {
  it.each(['write', 'bulkLoad'] as const)('preserves automatic SQLITE_FULL rollback and recovery for %s', async mode => {
    const { db, e } = open(), sequence = db.sequence, seen: string[][] = [];
    const watch = e.watch(() => e.query('Row').ids(), ids => seen.push([...ids]));
    try {
      await e.admin.watchesSettled(); limit(db);
      expect(() => mode === 'write' ? e.create('Row', { id: 'Row-refused', body: large })
        : db.bulkLoad([{ load: 'entity', id: 'Row-refused', fields: { body: large } }]))
        .toThrow(expect.objectContaining({ code: 'SQLITE_FULL' }));
      expect(db.sql.inTransaction).toBe(false); expect(db.sequence).toBe(sequence);
      expect(e.query('Row').ids()).toEqual(['Row-before']);
      await e.admin.watchesSettled(); expect(seen).toEqual([['Row-before']]);
      restoreCapacity(db); e.create('Row', { id: 'Row-recovered' });
      expect(e.query('Row').ids()).toEqual(['Row-before', 'Row-recovered']);
    } finally { watch.stop(); }
  });

  it('ends the entire unit when SQLite rolls it back, even if its caller catches the full error', () => {
    const { db, e } = open(), sequence = db.sequence; limit(db);
    expect(() => e.transact(() => {
      e.create('Row', { id: 'Row-earlier' });
      expect(() => e.create('Row', { id: 'Row-refused', body: large })).toThrow(expect.objectContaining({ code: 'SQLITE_FULL' }));
      e.create('Row', { id: 'Row-cannot-resume' });
    })).toThrow(expect.objectContaining({ code: 'CLOSED' }));
    expect(db.sql.inTransaction).toBe(false); expect(db.sequence).toBe(sequence);
    expect(e.query('Row').ids()).toEqual(['Row-before']);
    restoreCapacity(db); e.create('Row', { id: 'Row-recovered' });
  });

  it('retains both errors and refuses reuse after rollback itself fails, while allowing close and reopen', () => {
    const { db, e, path } = open();
    const primary = Object.assign(new Error('injected write failure'), { code: 'SQLITE_IOERR_WRITE' });
    const rollback = new Error('injected rollback failure');
    const run = db.run.bind(db), exec = db.sql.exec.bind(db.sql);
    const writing = vi.spyOn(db, 'run').mockImplementation((sql, args) => { if (sql.startsWith('INSERT INTO entities')) throw primary; return run(sql, args); });
    const aborting = vi.spyOn(db.sql, 'exec').mockImplementation(sql => { if (sql.startsWith('ROLLBACK')) throw rollback; return exec(sql); });
    let failure: unknown;
    try { e.create('Row', { id: 'Row-refused' }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([primary, rollback]);
    expect(failure).toMatchObject({ code: 'SQLITE_IOERR_WRITE', cause: primary });
    expect(() => e.create('Row', { id: 'Row-no-reuse' })).toThrow(failure as Error);
    expect(() => e.query('Row').ids()).toThrow(failure as Error);
    writing.mockRestore(); aborting.mockRestore(); db.close();
    const reopened = new SqliteDatabase({ path, readOnly: true }); held.push({ db: reopened, path });
    expect(createEarsEngine({ database: reopened }).query('Row').ids()).toEqual(['Row-before']);
  });
});
