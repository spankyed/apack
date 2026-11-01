import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => { for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); } });
function open() {
  const path = mkdtempSync(join(tmpdir(), 'ears-statement-cache-'));
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: { Row: { required: [] } }, relations: {}, roles: [] }) });
  held.push({ db, path }); return db;
}
const owned = (db: SqliteDatabase) => (db as unknown as { statements: { size: number; calculatedSize: number } }).statements;

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite statement cache resource policy', () => {
  it('evicts old query shapes while retaining frequently reused statements', () => {
    const db = open(), coldSql = 'SELECT 1 answer /* cold */', hotSql = 'SELECT 2 answer /* hot */';
    const cold = db.statement(coldSql), hot = db.statement(hotSql);
    for (let i = 0; i < 600; i++) {
      expect(db.statement(hotSql)).toBe(hot);
      expect(db.statement(`SELECT ? answer /* shape-${i} */`).get(i)).toEqual({ answer: i });
      expect(owned(db).size).toBeLessThanOrEqual(256);
    }
    expect(db.statement(coldSql)).not.toBe(cold);
    expect(db.statement(hotSql)).toBe(hot);
    // Eviction releases only the cache's reference, preserving a caller's borrowed live statement.
    expect(cold.get()).toEqual({ answer: 1 });
  });

  it('also limits retained SQL text by UTF-8 bytes, independently of entry count', () => {
    const db = open(), comment = '🐈'.repeat(80_000);
    const query = (i: number) => `SELECT ? answer /* ${comment}-${i} */`;
    const first = db.statement(query(0));
    for (let i = 1; i < 4; i++) expect(db.statement(query(i)).get(i)).toEqual({ answer: i });
    expect(owned(db).size).toBeLessThan(256);
    expect(owned(db).calculatedSize).toBeLessThanOrEqual(1024 * 1024);
    expect(db.statement(query(0))).not.toBe(first);
    expect(first.get(42)).toEqual({ answer: 42 });
  });

  it('executes oversized SQL without retaining it or flushing an existing hot statement', () => {
    const db = open(), hotSql = 'SELECT 7 answer /* keep */', hot = db.statement(hotSql);
    const oversized = `SELECT ? answer /* ${'x'.repeat(1024 * 1024)} */`;
    const first = db.statement(oversized), second = db.statement(oversized);
    expect(first).not.toBe(second);
    expect(first.get(1)).toEqual({ answer: 1 }); expect(second.get(2)).toEqual({ answer: 2 });
    expect(db.statement(hotSql)).toBe(hot);
    expect(owned(db).calculatedSize).toBeLessThanOrEqual(1024 * 1024);
  });

  it('keeps real EARS answers correct while dynamic field predicates churn the cache', () => {
    const db = open(), e = createEarsEngine({ database: db }), id = e.create('Row', { title: 'kept' }).id();
    for (let i = 0; i < 600; i++) {
      expect(e.query('Row').where(`dynamicField${i}`, 'absent').ids()).toEqual([]);
      expect(owned(db).size).toBeLessThanOrEqual(256);
      expect(owned(db).calculatedSize).toBeLessThanOrEqual(1024 * 1024);
    }
    expect(e.getAttr(id, 'title')).toBe('kept'); e.write(id).set('title', 'after');
    expect(e.query('Row').where('title', 'after').ids()).toEqual([id]);
  });

  it('owns caches per connection, including when another connection closes', () => {
    const a = open(), b = open(), sql = 'SELECT ? answer';
    const first = a.statement(sql), second = b.statement(sql);
    expect(first).not.toBe(second); a.close();
    expect(b.statement(sql)).toBe(second); expect(second.get(42)).toEqual({ answer: 42 });
    expect(() => a.statement(sql)).toThrow(expect.objectContaining({ code: 'CLOSED' }));
  });

  it('releases all owned cache references on close and refuses even cached SQL afterwards', () => {
    const db = open(), sql = 'SELECT 1 answer'; db.statement(sql);
    const cache = owned(db); expect(cache.size).toBeGreaterThan(0);
    db.close(); expect(cache.size).toBe(0); expect(cache.calculatedSize).toBe(0);
    expect(() => db.statement(sql)).toThrow(expect.objectContaining({ code: 'CLOSED' }));
  });
});
