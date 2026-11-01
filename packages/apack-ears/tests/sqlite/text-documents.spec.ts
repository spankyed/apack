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

function observeNativeMatches(db: SqliteDatabase) {
  const expressions: string[] = [], plans: string[] = [], all = db.all.bind(db);
  db.sql.function('trace_match', { deterministic: false }, (value: unknown) => { const text = String(value); expressions.push(text); return text; });
  vi.spyOn(db, 'all').mockImplementation((sql, args) => {
    if (/^WITH c\d+ AS MATERIALIZED/.test(sql)) plans.push(...all('EXPLAIN QUERY PLAN ' + sql, args).map(row => String(row.detail)));
    const observed = sql.replace(/(WHERE fts_[a-f0-9]+ MATCH )([\s\S]*?)( AND CAST\(f\.field)/g, '$1trace_match($2)$3');
    return all(observed, args);
  });
  return { expressions, plans, all };
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
  it('preserves conjunctions, disjunctions and exclusions independently of clause order', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-ab', name: 'alpha', body: ['beta'] });
    e.create('Row', { id: 'Row-ac', name: 'alpha', body: ['gamma'] });
    e.create('Row', { id: 'Row-cd', name: 'gamma', body: ['delta'] });
    e.create('Row', { id: 'Row-a', name: 'alpha' });
    const ids = (query: string, any = false) => e.query('Row').search(query, { fuzzy: false, any }).ids().sort();
    expect(ids('alpha beta')).toEqual(['Row-ab']);
    expect(ids('beta alpha')).toEqual(['Row-ab']);
    expect(ids('-gamma beta alpha')).toEqual(['Row-ab']);
    expect(ids('alpha -beta gamma')).toEqual(['Row-ac']);
    expect(ids('alpha beta OR gamma delta')).toEqual(['Row-ab', 'Row-cd']);
    expect(ids('gamma delta OR beta alpha')).toEqual(['Row-ab', 'Row-cd']);
    expect(ids('alpha beta OR gamma delta -beta')).toEqual(['Row-cd']);
    expect(ids('-alpha gamma delta OR beta alpha')).toEqual(['Row-cd']);
    expect(ids('alpha beta -alpha')).toEqual([]);
    expect(ids('-alpha')).toEqual([]);
    expect(ids('alpha beta -gamma', true)).toEqual(['Row-a', 'Row-ab']);
    expect(ids('name:missing alpha')).toEqual([]);
  });
  it('keeps native cardinality probes bounded while choosing between medium and common clauses', () => {
    const { db, e } = open();
    e.transact(() => { for (let i = 0; i < 250; i++) e.create('Row', { id: `Row-${i}`, body: i < 100 ? 'common facet' : 'common' }); });
    const get = db.get.bind(db), probes: Array<{ bound: number; count: number }> = [];
    vi.spyOn(db, 'get').mockImplementation((sql, args) => {
      const value = get(sql, args);
      if (sql.startsWith('SELECT count(*) n FROM (SELECT f.rowid')) probes.push({ bound: Number(args?.at(-1)), count: Number(value?.n) });
      return value;
    });
    const expected = Array.from({ length: 100 }, (_, i) => `Row-${i}`);
    expect(e.query('Row').search('common facet', { fuzzy: false }).ids()).toEqual(expected);
    expect(e.query('Row').search('facet common', { fuzzy: false }).ids()).toEqual(expected);
    expect(probes.some(probe => probe.bound > 32)).toBe(true);
    expect(probes.every(probe => probe.count <= probe.bound && probe.bound <= 2048)).toBe(true);
  });
  it('bounds native owner masks without truncating either the masked or fallback answer', () => {
    const { db, e } = open();
    e.transact(() => { for (let i = 0; i < 2200; i++) e.create('Row', { id: `Row-${i}`, name: 'groupCommon', body: 'common', cohort: i < 2000 }); });
    const { expressions } = observeNativeMatches(db);
    expect(e.query('Row').where('cohort', true).search('name:groupCommon body:common', { fuzzy: false }).count()).toBe(2000);
    const masked = expressions.filter(expression => expression.includes('body : "common"'));
    expect(masked.some(expression => expression.includes(' AND owner : ('))).toBe(true);
    expect(masked.every(expression => (expression.match(/\be\d+\b/g) ?? []).length <= 2048)).toBe(true);
    expressions.length = 0;
    expect(e.query('Row').search('name:groupCommon body:common', { fuzzy: false }).count()).toBe(2200);
    const fallback = expressions.filter(expression => expression.includes('body : "common"'));
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.every(expression => !expression.includes(' AND owner : ('))).toBe(true);
    expect(e.query('Row').search('e1', { fuzzy: false }).ids()).toEqual([]);
  });
  it('returns empty text queries without reading the vocabulary', () => {
    const { db, e } = open(); e.create('Row', { name: 'openDatabaseStore' });
    const all = db.all.bind(db), vocabulary: string[] = [];
    vi.spyOn(db, 'all').mockImplementation((sql, args) => { if (sql.includes('_vocab')) vocabulary.push(sql); return all(sql, args); });
    expect(e.query('Row').search('').ids()).toEqual([]);
    expect(e.query('Row').search('   ').ids()).toEqual([]);
    expect(vocabulary).toEqual([]);
  });
  it('uses selective native FTS execution for entity combination without hydrating primary rows', () => {
    const { db, e } = open();
    e.transact(() => { for (let i = 0; i < 100; i++) e.create('Row', { id: `Row-${i}`, name: 'alpha', body: i === 99 ? ['beta', 'gamma'] : ['unrelated'] }); });
    const read = vi.spyOn(db.values, 'read'), { expressions, plans, all } = observeNativeMatches(db);
    expect(e.query('Row').search('alpha "beta"', { fuzzy: false }).ids()).toEqual(['Row-99']);
    expect(e.query('Row').search('"beta" alpha', { fuzzy: false }).ids()).toEqual(['Row-99']);
    const forward = e.query('Row').search('alpha "beta"', { fuzzy: false }).hits({ highlights: true });
    const reverse = e.query('Row').search('"beta" alpha', { fuzzy: false }).hits({ highlights: true });
    expect(forward.map(hit => ({ id: hit.id, score: hit.score, highlights: hit.highlights })))
      .toEqual(reverse.map(hit => ({ id: hit.id, score: hit.score, highlights: hit.highlights })));
    expect(read).not.toHaveBeenCalled();
    expect(plans.some(detail => /VIRTUAL TABLE INDEX .*M/.test(detail))).toBe(true);
    expect(expressions.some(expression => expression.includes(' AND owner : ('))).toBe(true);
    const table = searchTable(db.indexBuilds.jobs().find(job => job.kind === 'text')!);
    expect(all(`EXPLAIN QUERY PLAN SELECT id FROM ${table}_docs WHERE entity_id=?`, ['Row-99'])
      .some(row => String(row.detail).includes('COVERING INDEX') && String(row.detail).includes('entity_id=?'))).toBe(true);
  });
});
