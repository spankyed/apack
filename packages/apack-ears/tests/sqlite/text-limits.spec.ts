import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
const schema: EngineSchema = { types: {
  Row: { required: [], search: { fields: { name: 3, body: 1 } } },
  Other: { required: [], search: { fields: { name: 3, body: 1 } } }, Plain: { required: [] },
}, relations: {}, roles: [] };
const stores: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open() {
  const path = mkdtempSync(join(tmpdir(), 'ears-text-limits-')); paths.push(path);
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema(schema) });
  stores.push(db); return { db, e: createEarsEngine({ database: db }) };
}
function seed(e: EarsEngine, type = 'Row', n = 128) {
  e.transact(() => { for (let i = 0; i < n; i++) e.create(type, { id: `${type}-${i}`, name: 'needle', body: 'other', n: i, bucket: i < 10 ? 'early' : 'late' }); });
}
function observe(db: SqliteDatabase, transform: (sql: string) => string = sql => sql) {
  const all = db.all.bind(db), statements: Array<{ sql: string; returnedRows: number }> = [];
  vi.spyOn(db, 'all').mockImplementation((sql, args) => {
    const rows = all(transform(sql), args); if (/^WITH c\d+ AS MATERIALIZED/.test(sql)) statements.push({ sql, returnedRows: rows.length }); return rows;
  });
  return statements;
}
describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('native text prefixes', () => {
  it('returns only the adjacent ranked prefix from native SQL and preserves counts and first terminals', () => {
    const { db, e } = open(); seed(e);
    const statements = observe(db), query = () => e.query('Row').search('needle', { fuzzy: false });
    expect(query().limit(7).ids()).toEqual(Array.from({ length: 7 }, (_, i) => `Row-${i}`));
    expect(statements.at(-1)?.returnedRows).toBe(7); expect(statements.at(-1)?.sql).toContain('LIMIT ?');
    expect(query().limit(7).count()).toBe(7);
    expect(query().limit(0).ids()).toEqual([]); expect(statements.at(-1)?.returnedRows).toBe(0);
    expect(query().first()).toBe('Row-0'); expect(statements.at(-1)?.returnedRows).toBe(1);
    expect(query().pickOne(['name'])).toEqual({ id: 'Row-0', name: 'needle' }); expect(statements.at(-1)?.returnedRows).toBe(1);
    expect(query().exists()).toBe(true); expect(statements.at(-1)?.returnedRows).toBe(1);
  });
  it('ranks a prefix without relooking up every accepted entity', () => {
    const { db, e } = open(); seed(e);
    const all = db.all.bind(db), plans: string[][] = [];
    vi.spyOn(db, 'all').mockImplementation((sql, args) => {
      const rows = all(sql, args);
      if (/^WITH c\d+ AS MATERIALIZED/.test(sql)) plans.push(db.sql.prepare('EXPLAIN QUERY PLAN ' + sql)
        .all(...(args ?? [])).map((row: any) => String(row.detail)));
      return rows;
    });
    expect(e.query('Row').search('needle', { fuzzy: false }).limit(7).ids()).toEqual(Array.from({ length: 7 }, (_, i) => `Row-${i}`));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.filter(detail => detail.includes('SEARCH e USING')).length).toBeLessThanOrEqual(1);
  });
  it('keeps filters, cursors and reorderings in their original pipeline scope', () => {
    const { db, e } = open(); seed(e, 'Row', 16); const statements = observe(db);
    const query = () => e.query('Row').search('needle', { fuzzy: false });
    expect(query().where('bucket', 'late').limit(3).ids()).toEqual(['Row-10', 'Row-11', 'Row-12']);
    expect(statements.at(-1)?.returnedRows).toBe(16);
    expect(query().after('Row-10').limit(3).ids()).toEqual(['Row-11', 'Row-12', 'Row-13']);
    expect(query().where('bucket', 'late').first()).toBe('Row-10');
    expect(query().after('Row-10').first()).toBe('Row-11');
    expect(query().orderBy('n', 'desc').first()).toBe('Row-15');
    expect(query().orderBy('n', 'desc').limit(3).ids()).toEqual(['Row-15', 'Row-14', 'Row-13']);
    expect(query().reverse().limit(3).ids()).toEqual(['Row-15', 'Row-14', 'Row-13']);
    expect(query().limit(3).where('bucket', 'late').ids()).toEqual([]);
    expect(query().limit(10).orderBy('n', 'desc').limit(3).ids()).toEqual(['Row-9', 'Row-8', 'Row-7']);
    expect(e.query('Row').limit(12).search('needle', { fuzzy: false }).limit(3).ids()).toEqual(['Row-0', 'Row-1', 'Row-2']);
  });
  it('preserves the global prefix across types and recency while keeping numeric and Date clocks equivalent', () => {
    const { db, e } = open(); seed(e, 'Row', 12); seed(e, 'Other', 3); const statements = observe(db);
    const query = () => e.query(['Other', 'Row']).search('needle', { fuzzy: false });
    expect(query().limit(5).ids()).toEqual(query().ids().slice(0, 5));
    const limited = statements.find(statement => statement.sql.includes('LIMIT ?'));
    expect(limited?.returnedRows).toBeLessThanOrEqual(5);
    e.write('Row-11').set('at', new Date(99000));
    for (let i = 0; i < 11; i++) e.write(`Row-${i}` as const).set('at', 1000);
    const recent = () => e.query('Row').search('needle', { fuzzy: false, recency: { field: 'at', halfLife: 10000, now: 100000 } });
    expect(recent().limit(1).ids()).toEqual(['Row-11']);
    expect(recent().limit(3).ids()).toEqual(recent().ids().slice(0, 3));
    const across = () => e.query(['Other', 'Row']).search('needle', { fuzzy: false, recency: { field: 'at', halfLife: 10000, now: 100000 } });
    expect(across().limit(4).ids()).toEqual(across().ids().slice(0, 4));
    for (const id of e.query(['Other', 'Row']).ids()) e.write(id).set('at', 1000);
    let clock = 100000;
    vi.spyOn(Date, 'now').mockImplementation(() => { const value = clock; clock -= 1000; return value; });
    expect(e.query(['Other', 'Row']).search('needle', { fuzzy: false, recency: { field: 'at', halfLife: 10000 } }).limit(1).ids())
      .toEqual(['Other-0']);
  });
  it('limits complete entities before expanding their highlight strings', () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-first', name: 'needle', body: ['needle one', 'needle two'] }); seed(e, 'Row', 32);
    const formatted: string[] = [];
    db.sql.function('trace_highlight', { deterministic: false }, (value: unknown) => { const text = String(value); formatted.push(text); return text; });
    const statements = observe(db, sql => sql.replace(/highlight\([^)]*\)/g, 'trace_highlight($&)'));
    const hits = e.query('Row').search('needle', { fuzzy: false }).limit(1).hits({ highlights: true });
    expect(hits.map(hit => hit.id)).toEqual(['Row-first']);
    expect(hits[0]?.highlights).toEqual({ name: [[0, 0, 6]], body: [[0, 0, 6], [1, 0, 6]] });
    expect(statements.at(-1)?.returnedRows).toBe(3);
    expect(formatted).toHaveLength(6);
  });
  it('keeps score and text fetch in one snapshot while another handle commits', () => {
    const { db, e } = open(); e.create('Row', { id: 'Row-one', name: 'needle' });
    const writer = new SqliteDatabase({ path: db.path, syncs: false }); stores.push(writer);
    const other = createEarsEngine({ database: writer }), all = db.all.bind(db); let committed = false;
    vi.spyOn(db, 'all').mockImplementation((sql, args) => {
      const rows = all(sql, args);
      if (!committed && /^WITH c\d+ AS MATERIALIZED/.test(sql) && !sql.includes('highlight(')) {
        committed = true; other.write('Row-one').set('name', 'changed');
      }
      return rows;
    });
    const [hit] = e.query('Row').search('needle', { fuzzy: false }).limit(1).hits({ fields: ['name'], highlights: true });
    expect(committed).toBe(true);
    expect(hit?.row).toEqual({ id: 'Row-one', name: 'needle' });
    expect(hit?.highlights).toEqual({ name: [[0, 0, 6]] });
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual([]);
    expect(e.getAttr('Row-one', 'name')).toBe('changed');
  });
  it('projects requested hit fields without hydrating unrelated overflow values', () => {
    const { db, e } = open(); e.create('Row', { id: 'Row-one', name: 'needle', payload: 'large '.repeat(100000) });
    const read = vi.spyOn(db.values, 'read');
    expect(e.query('Row').search('needle', { fuzzy: false }).limit(1).hits({ fields: ['name'] })[0]?.row)
      .toEqual({ id: 'Row-one', name: 'needle' });
    expect(read.mock.calls.every(([, , fields]) => fields !== undefined && !fields.includes('payload'))).toBe(true);
  });
  it('retains index refusals at a zero prefix and updates a watched prefix when an outside row becomes the winner', async () => {
    const { e } = open(); seed(e, 'Row', 16);
    expect(() => e.query('Plain').search('needle').limit(0).ids()).toThrow(expect.objectContaining({ code: 'UNKNOWN_INDEX' }));
    const seen: string[][] = [], watch = e.watch(() => e.query('Row').search('needle', { fuzzy: false }).limit(1).ids(), ids => seen.push([...ids]));
    try {
      await e.admin.watchesSettled(); expect(seen.at(-1)).toEqual(['Row-0']);
      e.write('Row-15').set('name', 'needle needle needle');
      await e.admin.watchesSettled(); expect(seen.at(-1)).toEqual(['Row-15']);
    } finally { watch.stop(); }
    e.admin.setSchema({ ...schema, types: { ...schema.types, Row: { required: [], search: { fields: { name: 4 } } } } });
    expect(() => e.query('Row').search('needle').limit(0).ids()).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
  });
});
