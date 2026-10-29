import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { searchTable } from '../../src/sqlite/index-builds.ts';
const schema: EngineSchema = { types: { Row: { required: [], search: { fields: { name: 3, body: 1 } } } }, relations: {}, roles: [] };
const stores: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open(path?: string, readOnly = false) {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-text-docs-')); paths.push(path); }
  const db = new SqliteDatabase({ path, syncs: false, ...(readOnly ? { readOnly } : { schema: toElmdbSchema(schema) }) });
  stores.push(db); return { db, e: createEarsEngine({ database: db }) };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('source-string FTS documents', () => {
  it('maps identifier and acronym components to original UTF-16 offsets and preserves whole identifiers', () => {
    const { e } = open(); e.create('Row', { id: 'Row-code', name: '😀 openDatabaseStore HTTPRequest' });
    expect(e.query('Row').search('database', { fuzzy: false }).hits({ highlights: true })[0]?.highlights)
      .toEqual({ name: [[0, 7, 15]] });
    expect(e.query('Row').search('request', { fuzzy: false }).hits({ highlights: true })[0]?.highlights)
      .toEqual({ name: [[0, 25, 32]] });
    expect(e.query('Row').search('opendatabasestore', { fuzzy: false }).hits({ highlights: true })[0]?.highlights)
      .toEqual({ name: [[0, 3, 20]] });
    expect(e.query('Row').search('openDatabaseStore', { fuzzy: false }).hits({ highlights: true })[0]?.highlights)
      .toEqual({ name: [[0, 3, 20]] });
  });
  it('keeps phrases in a source string, preserves mixed-list element positions and combines ordinary clauses across strings', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-split', name: 'safe', body: [17, 'backup', null, 'release'] });
    e.create('Row', { id: 'Row-phrase', body: [null, 'safe backup', 'release'] });
    expect(e.query('Row').search('safe backup', { fuzzy: false }).ids()).toEqual(expect.arrayContaining(['Row-split', 'Row-phrase']));
    expect(e.query('Row').search('"safe backup"', { fuzzy: false }).ids()).toEqual(['Row-phrase']);
    expect(e.query('Row').search('release -"safe backup"', { fuzzy: false }).ids()).toEqual(['Row-split']);
    expect(e.query('Row').search('"safe backup"', { fuzzy: false }).hits({ highlights: true })[0]?.highlights)
      .toEqual({ body: [[1, 0, 11]] });
  });
  it('applies exclusions to every disjunct and preserves field-qualified phrases', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-alpha', name: 'alpha topic', body: 'safe backup' });
    e.create('Row', { id: 'Row-both', name: 'alpha beta topic', body: 'safe backup' });
    e.create('Row', { id: 'Row-beta', name: 'beta topic', body: 'safe backup' });
    expect(e.query('Row').search('alpha OR beta -beta', { fuzzy: false }).ids()).toEqual(['Row-alpha']);
    expect(e.query('Row').search('alpha beta -beta', { fuzzy: false, any: true }).ids()).toEqual(['Row-alpha']);
    expect(e.query('Row').search('body:"safe backup" -beta', { fuzzy: false }).ids()).toEqual(['Row-alpha']);
    expect(e.query('Row').search('name:"safe backup"', { fuzzy: false }).ids()).toEqual([]);
  });
  it('updates source shape and identifier postings transactionally and reopens read-only with the same answers', () => {
    const { db, e } = open(); e.create('Row', { id: 'Row-one', name: 'openDatabaseStore', body: ['alpha', 'beta'] });
    e.write('Row-one').set('body', 'alpha\n\nbeta');
    expect(e.query('Row').search('"alpha beta"', { fuzzy: false }).ids()).toEqual(['Row-one']);
    expect(() => e.transact(() => {
      e.write('Row-one').set('body', ['alpha', 'beta']); e.write('Row-one').set('name', 'renderCanvas');
      expect(e.query('Row').search('"alpha beta"', { fuzzy: false }).ids()).toEqual([]);
      expect(e.query('Row').search('database', { fuzzy: false }).ids()).toEqual([]);
      throw Error('rollback');
    })).toThrow('rollback');
    expect(e.query('Row').search('database', { fuzzy: false }).ids()).toEqual(['Row-one']);
    e.write('Row-one').set('body', [null, 'needle']); e.write('Row-one').set('body', ['needle', null]);
    expect(e.query('Row').search('needle', { fuzzy: false }).hits({ highlights: true })[0]?.highlights)
      .toEqual({ body: [[0, 0, 6]] });
    db.close(); const reader = open(db.path, true);
    expect(reader.e.query('Row').search('database needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
    expect(reader.e.query('Row').search('canvas', { fuzzy: false }).ids()).toEqual([]);
  });
  it('keeps untouched text documents and overflow sources out of a small field update', () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-large', name: 'openDatabaseStore', body: Array.from({ length: 100 }, (_, i) => 'large body ' + i + ' '.repeat(4096)) });
    const table = searchTable(db.indexBuilds.jobs().find(job => job.kind === 'text')!);
    const before = db.all(`SELECT id FROM ${table}_docs WHERE entity_id=? AND field=1 ORDER BY id`, ['Row-large']);
    const reads = vi.spyOn(db.values, 'read');
    e.write('Row-large').set('name', 'renderCanvas');
    expect(reads.mock.calls.every(([, , fields]) => fields !== undefined && !fields.includes('body'))).toBe(true);
    expect(db.all(`SELECT id FROM ${table}_docs WHERE entity_id=? AND field=1 ORDER BY id`, ['Row-large'])).toEqual(before);
    expect(e.query('Row').search('database', { fuzzy: false }).ids()).toEqual([]);
    expect(e.query('Row').search('canvas', { fuzzy: false }).ids()).toEqual(['Row-large']);
  });
  it('uses selective native FTS execution for entity combination without hydrating primary rows', () => {
    const { db, e } = open();
    e.transact(() => { for (let i = 0; i < 100; i++) e.create('Row', { id: `Row-${i}`, name: 'alpha', body: i === 99 ? ['beta', 'gamma'] : ['unrelated'] }); });
    const read = vi.spyOn(db.values, 'read'), all = db.all.bind(db), plans: string[] = [];
    vi.spyOn(db, 'all').mockImplementation((sql, args) => {
      if (sql.startsWith('WITH c0 AS MATERIALIZED')) plans.push(...all('EXPLAIN QUERY PLAN ' + sql, args).map(row => String(row.detail)));
      return all(sql, args);
    });
    expect(e.query('Row').search('alpha "beta"', { fuzzy: false }).ids()).toEqual(['Row-99']);
    expect(read).not.toHaveBeenCalled();
    expect(plans.some(detail => /VIRTUAL TABLE INDEX .*M/.test(detail))).toBe(true);
    const table = searchTable(db.indexBuilds.jobs().find(job => job.kind === 'text')!);
    expect(all(`EXPLAIN QUERY PLAN SELECT id FROM ${table}_docs WHERE entity_id=?`, ['Row-99'])
      .some(row => String(row.detail).includes('COVERING INDEX') && String(row.detail).includes('entity_id=?'))).toBe(true);
  });
});
