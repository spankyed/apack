import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema, type EARS } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => {
  for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); }
  vi.restoreAllMocks();
});
const schema: EngineSchema = {
  types: {
    Row: { required: [], fields: { rank: { type: 'number' }, body: { type: 'string' }, sortText: { type: 'string', optional: true } } },
    Other: { required: [], fields: { body: { type: 'string' }, rank: { type: 'number' } } },
  }, relations: {}, roles: [],
};
function open() {
  const path = mkdtempSync(join(tmpdir(), 'ears-query-cost-'));
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema(schema) });
  held.push({ db, path });
  return { db, e: createEarsEngine({ database: db }) };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite ordering work', () => {
  it.each(['rank', 'sortText'] as const)('orders %s without loading unrelated bodies or issuing per-entity SQL', field => {
    const { db, e } = open();
    e.transact(() => {
      for (let i = 0; i < 256; i++) e.create('Row', { id: `Row-${i}`, rank: 255 - i, sortText: String(255 - i).padStart(4, '0'), body: 'large body '.repeat(1600) });
    });
    const read = vi.spyOn(db.values, 'read');
    const explained = e.query('Row').orderBy(field).limit(10).explain();
    expect(explained.ids).toEqual(Array.from({ length: 10 }, (_, i) => `Row-${255 - i}`));
    expect(explained.backend).toBe('sqlite');
    if (explained.backend === 'sqlite') expect(explained.statementCount).toBeLessThanOrEqual(16);
    if (field === 'rank') expect(read).not.toHaveBeenCalled();
    expect(read.mock.calls.every(call => call[2] !== undefined && !call[2].includes('body'))).toBe(true);
  });

  it('returns only an adjacent limit from the SQL sort, preserving filters and earlier prefixes', () => {
    const { e } = open();
    e.transact(() => {
      for (let i = 0; i < 512; i++) e.create('Row', { id: `Row-${i}`, rank: 511 - i, body: i % 2 ? 'odd' : 'even' });
    });
    const explained = e.query('Row').orderBy('rank').limit(7).explain();
    expect(explained.ids).toEqual(Array.from({ length: 7 }, (_, i) => `Row-${511 - i}`));
    if (explained.backend !== 'sqlite') throw new Error('Expected SQLite diagnostics');
    const sorted = explained.statements.filter(s => s.sql.includes('ORDER BY CASE p._sort_kind'));
    expect(sorted).toHaveLength(1);
    expect(sorted[0].returnedRows).toBe(7);
    expect(sorted[0].sql).toMatch(/LIMIT \?$/);
    expect(e.query('Row').orderBy('rank').where('body', 'even').limit(7).ids()).toEqual(
      Array.from({ length: 7 }, (_, i) => `Row-${510 - i * 2}`));
    expect(e.query('Row').limit(12).orderBy('rank').limit(3).ids()).toEqual(['Row-11', 'Row-10', 'Row-9']);
    expect(e.query('Row').orderBy('rank').limit(0).ids()).toEqual([]);
    expect(e.query('Row').orderBy('rank').limit(7).count()).toBe(7);
  });

  it.each(['inline', 'overflow'] as const)('uses keyed sort-value reads for a single type (%s)', async storage => {
    const path = mkdtempSync(join(tmpdir(), 'ears-sort-lookups-'));
    const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: {
      Task: { required: [], indexes: ['status'], ...(storage === 'inline' ? { fields: { rank: { type: 'number' as const } } } : {}) },
    }, relations: {}, roles: [] }) });
    held.push({ db, path });
    const e = createEarsEngine({ database: db });
    e.transact(() => { for (let i = 0; i < 2000; i++) e.create('Task', {
      id: `Task-${i}`, status: i % 3 ? 'closed' : 'open', rank: 2000 - i,
    }); });
    await db.indexesReady();
    const explained = e.query('Task').where('status', 'open').orderBy('rank').explain();
    expect(explained.ids).toEqual(Array.from({ length: 667 }, (_, i) => `Task-${1998 - i * 3}`));
    if (explained.backend !== 'sqlite') throw new Error('Expected SQLite diagnostics');
    const sorted = explained.statements.find(statement => statement.sql.includes('ORDER BY CASE p._sort_kind'))!;
    expect(sorted).toBeDefined();
    expect(sorted.plan.some(row => storage === 'inline'
      ? row.detail.includes('SEARCH v USING PRIMARY KEY (entity_id=?)')
      : row.detail.includes('SEARCH o USING') && row.detail.includes('(entity_id=? AND field=?)'))).toBe(true);
    expect(sorted.plan.some(row => row.detail.includes('SCAN f LEFT-JOIN'))).toBe(false);
    expect(e.query('Task').where('status', 'open').orderBy('rank').pick(['rank']).map(row => row.rank))
      .toEqual(Array.from({ length: 667 }, (_, i) => 2 + i * 3));
  });

  it('validates scalar cells outside a pushed sort prefix', () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-first', rank: 1, body: 'a' });
    e.create('Row', { id: 'Row-last', rank: 2, body: 'b' });
    const layout = db.values.layout('Row')!, slot = layout.fields.get('rank')!;
    db.run(`UPDATE ${layout.table} SET v${slot}=? WHERE entity_id=?`, ['invalid', 'Row-last']);
    expect(() => e.query('Row').orderBy('rank').limit(1).ids()).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    expect(() => e.query('Row').orderBy('rank').limit(0).ids()).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
  });

  it('preserves stable input order and duplicate ids across different physical type layouts', () => {
    const { e } = open();
    e.transact(() => {
      e.create('Row', { id: 'Row-a', rank: 2, body: 'row' });
      e.create('Row', { id: 'Row-b', rank: 1, body: 'row' });
      e.create('Other', { id: 'Other-a', rank: 1, body: 'other' });
      e.create('Other', { id: 'Other-b', rank: 2, body: 'other' });
    });
    expect(e.query(['Row', 'Row']).orderBy('rank').ids()).toEqual(['Row-b', 'Row-a']);
    const ids = ['Other-b', 'Row-b', 'Other-a', 'Row-a', 'Row-b'] as const;
    expect(e.query.ids(ids).orderBy('rank').ids()).toEqual(['Row-b', 'Other-a', 'Row-b', 'Other-b', 'Row-a']);
    expect(e.query.ids(ids).orderBy('rank', 'desc').ids()).toEqual(['Other-b', 'Row-a', 'Row-b', 'Other-a', 'Row-b']);
  });

  it('orders actual scalar kinds from unchecked imports, with stable null and signed-zero ties', () => {
    const { db, e } = open();
    const id = (name: string) => `Row-${name}` as EARS.EntityId;
    const cells: Array<[string, unknown]> = [['null', null], ['date1', new Date(1)], ['zero', 0], ['true', true],
      ['negative', -12], ['date0', new Date(0)], ['false', false], ['minus0', -0], ['positive', 12]];
    for (const [name, value] of cells) e.admin.bulkLoadAttr(id(name), 'rank', value);
    e.admin.bulkLoadAttr(id('missing'), 'body', 'no rank');
    const read = vi.spyOn(db.values, 'read');
    expect(e.query('Row').orderBy('rank').ids()).toEqual(
      ['false', 'true', 'negative', 'zero', 'minus0', 'positive', 'date0', 'date1', 'null', 'missing'].map(id));
    expect(e.query('Row').orderBy('rank', 'desc').ids()).toEqual(
      ['null', 'missing', 'date1', 'date0', 'positive', 'zero', 'minus0', 'negative', 'true', 'false'].map(id));
    expect(read).not.toHaveBeenCalled();
    e.admin.bulkLoadAttr(id('text'), 'rank', 'Éclair');
    read.mockClear();
    expect(e.query('Row').orderBy('rank').ids()).toEqual(
      ['false', 'true', 'negative', 'zero', 'minus0', 'positive', 'date0', 'date1', 'text', 'null', 'missing'].map(id));
    expect(read).toHaveBeenCalled();
  });

  it('retains pipeline scope and prior ordering on ties', () => {
    const { e } = open();
    e.transact(() => {
      for (let i = 0; i < 8; i++) e.create('Row', { id: `Row-${i}`, rank: i % 2, body: String(i) });
    });
    expect(e.query('Row').limit(4).orderBy('rank', 'desc').ids()).toEqual(['Row-1', 'Row-3', 'Row-0', 'Row-2']);
    expect(e.query('Row').orderBy('body', 'desc').orderBy('rank').limit(4).ids()).toEqual(['Row-6', 'Row-4', 'Row-2', 'Row-0']);
  });

  it.each([{ side: 'max', a: '9223372036854775807', b: '9223372036854775806' },
    { side: 'min', a: '-9223372036854775807', b: '-9223372036854775808' }])('preserves decoder rounding of large integer ties ($side)', ({ a, b }) => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-a', rank: 0, body: 'a' });
    e.create('Row', { id: 'Row-b', rank: 0, body: 'b' });
    const layout = db.values.layout('Row')!, slot = layout.fields.get('rank')!;
    db.sql.exec(`UPDATE ${layout.table} SET v${slot}=CASE entity_id WHEN 'Row-a' THEN ${a} ELSE ${b} END`);
    expect(e.getAttr('Row-a', 'rank')).toBe(e.getAttr('Row-b', 'rank'));
    expect(e.query('Row').orderBy('rank').ids()).toEqual(['Row-a', 'Row-b']);
  });

  it.each(['invalid cell', 'missing primary'] as const)('preserves corruption refusal: %s', damage => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-a', rank: 1, body: 'a' });
    const layout = db.values.layout('Row')!, slot = layout.fields.get('rank')!;
    if (damage === 'invalid cell') db.run(`UPDATE ${layout.table} SET v${slot}=?`, ['not a number']);
    else db.sql.exec(`DELETE FROM ${layout.table}`);
    expect(() => e.query('Row').orderBy('rank').ids()).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
  });

  it('keeps a fallback for embedded-NUL field names', () => {
    const { e } = open();
    const field = 'order\0key';
    e.admin.bulkLoadAttr('Row-a', field, 2);
    e.admin.bulkLoadAttr('Row-b', field, 1);
    expect(e.query('Row').orderBy(field).ids()).toEqual(['Row-b', 'Row-a']);
  });


  it('keeps sparse flexible keys and undeclared repair types in native scalar ordering', () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-missing', rank: 0, body: 'missing loose' });
    e.admin.bulkLoadAttr('Row-loose', 'loose', 2);
    e.admin.bulkLoadAttr('Orphan-loose', 'loose', 1);
    const read = vi.spyOn(db.values, 'read');
    expect(e.query.all().orderBy('loose').ids()).toEqual(['Orphan-loose', 'Row-loose', 'Row-missing']);
    expect(e.query.all().orderBy('loose', 'desc').ids()).toEqual(['Row-missing', 'Row-loose', 'Orphan-loose']);
    expect(read).not.toHaveBeenCalled();
  });

  it('falls back to decoder date clipping for fractional stored timestamps', () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-a', rank: 0, body: 'a' });
    e.create('Row', { id: 'Row-b', rank: 0, body: 'b' });
    const layout = db.values.layout('Row')!, slot = layout.fields.get('rank')!;
    db.sql.exec(`UPDATE ${layout.table} SET k${slot}='date',v${slot}=CASE entity_id WHEN 'Row-a' THEN 0.9 ELSE 0.1 END`);
    expect(e.getAttr('Row-a', 'rank')).toEqual(new Date(0));
    expect(e.query('Row').orderBy('rank').ids()).toEqual(['Row-a', 'Row-b']);
  });


  it.each(['asc', 'desc'] as const)('matches the ICU fallback on a mixed scalar corpus (%s)', direction => {
    const { e } = open();
    const ids: EARS.EntityId[] = [];
    for (let i = 0; i < 48; i++) {
      const id = `${i % 2 ? 'Other' : 'Row'}-corpus${i}` as EARS.EntityId;
      ids.push(id);
      const value = [i - 25, -i, i % 4 === 0, new Date(i - 24), null, undefined][i % 6];
      e.admin.bulkLoadAttr(id, value === undefined ? 'body' : 'rank', value === undefined ? 'missing' : value);
    }
    ids.reverse(); ids.push(ids[0]!);
    const native = e.query.ids(ids).orderBy('rank', direction).ids();
    e.admin.bulkLoadAttr('Row-sentinel', 'rank', 'force ICU fallback');
    expect(e.query.ids([...ids, 'Row-sentinel']).orderBy('rank', direction).ids()
      .filter(id => id !== 'Row-sentinel')).toEqual(native);
  });

  it("ignores another type table's stray row but refuses a missing actual primary row", () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-a', rank: 1, body: 'a' });
    e.create('Other', { id: 'Other-b', rank: 2, body: 'b' });
    const other = db.values.layout('Other')!, slot = other.fields.get('rank')!;
    db.sql.exec(`INSERT INTO ${other.table}(entity_id,k${slot},v${slot}) VALUES ('Row-a','num',100)`);
    expect(e.query.all().orderBy('rank').ids()).toEqual(['Row-a', 'Other-b']);
    db.sql.exec(`DELETE FROM ${db.values.layout('Row')!.table}`);
    expect(() => e.query.all().orderBy('rank').ids()).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
  });


  it("does not inspect another type's missing physical table for a selected or empty candidate set", () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-a', rank: 1, body: 'a' });
    db.sql.exec(`DROP TABLE ${db.values.layout('Other')!.table}`);
    let ids: string[] = [];
    expect(() => { ids = e.query.ids('Row-a').orderBy('rank').ids(); }).not.toThrow();
    expect(ids).toEqual(['Row-a']);
    expect(e.query('Other').limit(0).orderBy('rank').ids()).toEqual([]);
  });

});
