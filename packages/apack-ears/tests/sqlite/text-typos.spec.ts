// Candidate typo behavior is preregistered in docs/plans/ears-sqlite-storage.md, independently of elmdb scores.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
const schema: EngineSchema = { types: { Row: { required: [], search: { fields: { name: 3, body: 1 } } } }, relations: {}, roles: [] };
const stores: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open({ path, readOnly = false, definition = schema }: { path?: string; readOnly?: boolean; definition?: EngineSchema } = {}) {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-text-typos-')); paths.push(path); }
  const db = new SqliteDatabase({ path, syncs: false, ...(readOnly ? { readOnly } : { schema: toElmdbSchema(definition) }) });
  stores.push(db); return { db, e: createEarsEngine({ database: db }) };
}
describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('bounded candidate typos', () => {
  it.each(['atabase', 'databse', 'databas', 'xdatabase', 'dataxbase', 'databasex',
    'xatabase', 'dataxase', 'databasx', 'adtabase', 'datbaase', 'databaes'])('finds database for one edit in %s', query => {
    const { e } = open(); e.create('Row', { id: 'Row-db', name: 'database' });
    expect(e.query('Row').search(query).ids()).toEqual(['Row-db']);
    expect(e.query('Row').search(query, { fuzzy: false }).ids()).toEqual([]);
  });
  it('folds a typo while preserving the original Unicode source highlight', () => {
    const { e } = open(); e.create('Row', { id: 'Row-db', name: '😀 Database!' });
    expect(e.query('Row').search('DÁTaBSE').hits({ highlights: true })[0]?.highlights)
      .toEqual({ name: [[0, 3, 11]] });
  });
  it('includes known-word neighbors and one transposition but not two independent edits', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-one', name: 'planet' }); e.create('Row', { id: 'Row-two', name: 'planes' });
    e.create('Row', { id: 'Row-long', name: 'checkpoint' });
    expect(e.query('Row').search('planet').ids().sort()).toEqual(['Row-one', 'Row-two']);
    expect(e.query('Row').search('plnaet').ids()).toEqual(['Row-one']);
    expect(e.query('Row').search('chekcpoint').ids()).toEqual(['Row-long']);
    expect(e.query('Row').search('chackpoinx').ids()).toEqual([]);
  });
  it('makes the query-length and alphabet boundaries explicit without losing literal terms', () => {
    const { e } = open(), long = 'abcdefghijklmnopqrstuvwxyz012345'; expect(long.length).toBe(32);
    e.create('Row', { id: 'Row-short', name: 'base' }); e.create('Row', { id: 'Row-five', name: 'abcde' });
    e.create('Row', { id: 'Row-32', name: long }); e.create('Row', { id: 'Row-33', name: long + 'x' });
    e.create('Row', { id: 'Row-script', name: '数据库恢复' });
    expect(e.query('Row').search('basx').ids()).toEqual([]);
    expect(e.query('Row').search('base').ids()).toEqual(['Row-short']);
    expect(e.query('Row').search('abcdx').ids()).toEqual(['Row-five']);
    expect(e.query('Row').search(long.slice(0, -1) + 'x').ids()).toContain('Row-32');
    expect(e.query('Row').search(long + 'x').ids()).toEqual(['Row-33']);
    expect(e.query('Row').search('数据库恢复').ids()).toEqual(['Row-script']);
    expect(e.query('Row').search('数据库修复').ids()).toEqual([]);
  });
  it('preserves field, boolean, candidate, phrase and prefix scope', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-a', name: 'database', body: 'archive', cohort: 'early' });
    e.create('Row', { id: 'Row-b', name: 'other', body: 'database', cohort: 'late' });
    e.create('Row', { id: 'Row-c', name: 'database backup', cohort: 'early' });
    expect(e.query('Row').search('name:databse').ids().sort()).toEqual(['Row-a', 'Row-c']);
    expect(e.query('Row').search('databse', { fields: ['body'] }).ids()).toEqual(['Row-b']);
    expect(e.query('Row').where('cohort', 'late').search('databse').ids()).toEqual(['Row-b']);
    expect(e.query('Row').search('databse').where('cohort', 'late').ids()).toEqual(['Row-b']);
    expect(e.query('Row').search('databse -backup').ids().sort()).toEqual(['Row-a', 'Row-b']);
    expect(e.query('Row').search('databse archive', { any: true }).count()).toBe(3);
    expect(e.query('Row').search('"databse"').ids()).toEqual([]);
    expect(e.query('Row').search('databse', { prefix: true }).ids().sort()).toEqual(['Row-a', 'Row-b', 'Row-c']);
    expect(e.query('Row').search('databse', { prefix: true, fuzzy: false }).ids()).toEqual([]);
    expect(e.query('Row').search('databse arch', { prefix: true }).ids()).toEqual(['Row-a']);
  });
  it('reads units, rolls back, settles watches and reopens with the same typo matches', async () => {
    const { db, e } = open(), query = () => e.query('Row').search('databse').ids();
    e.create('Row', { id: 'Row-a', name: 'other' });
    expect(() => e.transact(() => { e.write('Row-a').set('name', 'database'); expect(query()).toEqual(['Row-a']); throw Error('abort'); })).toThrow('abort');
    expect(query()).toEqual([]);
    const seen: string[][] = [], watch = e.watch(query, ids => seen.push([...ids]));
    try {
      await e.admin.watchesSettled(); expect(seen.at(-1)).toEqual([]);
      e.write('Row-a').set('name', 'database'); await e.admin.watchesSettled(); expect(seen.at(-1)).toEqual(['Row-a']);
    } finally { watch.stop(); }
    db.close(); const reader = open({ path: db.path, readOnly: true }); expect(reader.e.query('Row').search('databse').ids()).toEqual(['Row-a']);
  });
  it('checks native presence with the same Porter stemmer and identifier columns as matching', () => {
    const definition: EngineSchema = { ...schema, types: { Row: { required: [], search: { fields: { name: 3, body: 1 }, stem: 'en' } } } };
    const { e } = open({ definition });
    e.create('Row', { id: 'Row-release', name: 'releases' }); e.create('Row', { id: 'Row-code', name: 'openDatabaseStore' });
    expect(e.query('Row').search('relases').ids()).toEqual(['Row-release']);
    expect(e.query('Row').search('databse').ids()).toEqual(['Row-code']);
    expect(e.query('Row').search('relases', { fuzzy: false }).ids()).toEqual([]);
  });
  it('keeps presence pruning and final ranking in one snapshot across another handle committing', () => {
    const { db, e } = open(); e.create('Row', { id: 'Row-a', name: 'database' });
    const writer = new SqliteDatabase({ path: db.path, syncs: false }); stores.push(writer);
    const other = createEarsEngine({ database: writer }), all = db.all.bind(db); let committed = false;
    vi.spyOn(db, 'all').mockImplementation((sql, args) => {
      const rows = all(sql, args);
      if (!committed && sql.includes('FROM json_each(?) alternative')) {
        committed = true;
        other.transact(() => { other.write('Row-a').set('name', 'other'); other.create('Row', { id: 'Row-b', name: 'database' }); });
      }
      return rows;
    });
    const [hit] = e.query('Row').search('databse').limit(1).hits({ fields: ['name'], highlights: true });
    expect(committed).toBe(true); expect(hit?.id).toBe('Row-a');
    expect(hit?.row).toEqual({ id: 'Row-a', name: 'database' }); expect(hit?.highlights).toEqual({ name: [[0, 0, 8]] });
    expect(e.query('Row').search('databse').ids()).toEqual(['Row-b']);
  });
  it('uses native MATCH with query work independent of unrelated vocabulary growth', () => {
    const { db, e } = open(); e.create('Row', { id: 'Row-db', name: 'database' });
    const all = db.all.bind(db), matches: Array<{ sql: string; args: unknown[]; plan: string[] }> = [],
      probes: Array<{ args: unknown[]; returnedRows: number; plan: string[] }> = [];
    vi.spyOn(db, 'all').mockImplementation((sql, args) => {
      if (/\b(?:FROM|JOIN)\s+fts_[a-f0-9]+_vocab\b/i.test(sql)) throw Error('Vocabulary enumeration must not reach JavaScript');
      if (/^WITH c\d+ AS MATERIALIZED/.test(sql)) matches.push({ sql, args: [...(args ?? [])],
        plan: db.sql.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(args ?? [])).map((row: any) => String(row.detail)) });
      const rows = all(sql, args);
      if (sql.includes('FROM json_each(?) alternative')) probes.push({ args: [...(args ?? [])], returnedRows: rows.length,
        plan: db.sql.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(args ?? [])).map((row: any) => String(row.detail)) });
      return rows;
    });
    const query = () => e.query('Row').search('databse').limit(1).ids();
    expect(query()).toEqual(['Row-db']); const before = matches.at(-1)!;
    e.transact(() => { for (let i = 0; i < 1000; i++) e.create('Row', { name: 'lexicon' + i.toString(16).padStart(8, '0') }); });
    expect(query()).toEqual(['Row-db']); const after = matches.at(-1)!;
    expect(after.sql).toBe(before.sql); expect(after.args).toEqual(before.args);
    expect(probes).toHaveLength(2); expect(probes[1]?.args).toEqual(probes[0]?.args);
    expect(probes.every(probe => probe.returnedRows === 1)).toBe(true);
    expect(probes.every(probe => probe.plan.some(detail => /EXISTS VIRTUAL TABLE INDEX \d+:M\d/.test(detail)))).toBe(true);
    const terms = [...String(after.args[0]).matchAll(/body : "([^"]+)"/g)].map(match => match[1]);
    expect(terms).toEqual(['databse', 'database']);
    expect(after.plan.some(detail => detail.includes('VIRTUAL TABLE INDEX') && detail.includes('M'))).toBe(true);
    expect(db.all("SELECT name FROM sqlite_schema WHERE name LIKE '%_vocab'")).toEqual([]);
  });
});
