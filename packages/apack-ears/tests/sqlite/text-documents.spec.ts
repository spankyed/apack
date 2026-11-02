import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { searchTable } from '../../src/sqlite/index-builds.ts';
import { auditSqliteDatabase } from '../../src/sqlite/audit.ts';
import { SQLITE_TEXT_REVISION, TEXT_LEAD_MAX_UNITS } from '../../src/sqlite/text-policy.ts';
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
  it('prefers a leading mention over an incidental mention late in a shorter field', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-lead', body: 'needle ' + 'context '.repeat(2000) });
    e.create('Row', { id: 'Row-late', body: 'context '.repeat(60) + 'needle' });
    expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-lead', 'Row-late']);
  });

  it('bounds indexed leading text without introducing truncated-word matches', () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-boundary', body: 'x '.repeat(125) + 'suffixword' });
    const job = db.indexBuilds.jobs().find(job => job.kind === 'text')!;
    const lead = db.get(`SELECT body FROM ${searchTable(job)} WHERE entity_id=? AND portion=1`, ['Row-boundary'])!.body;
    expect(lead.length).toBeLessThanOrEqual(TEXT_LEAD_MAX_UNITS);
    expect(e.query('Row').search('suffix', { fuzzy: false }).ids()).toEqual([]);
    expect(e.query('Row').search('"x suffixword"', { fuzzy: false }).ids()).toEqual(['Row-boundary']);
  });

  it('audits and rebuilds leading-text damage from authoritative fields', async () => {
    const { db, e } = open();
    const body = 'needle context ' + 'background '.repeat(60);
    e.create('Row', { id: 'Row-one', body });
    await db.indexesReady();
    const job = db.indexBuilds.jobs().find(job => job.kind === 'text')!, sequence = db.sequence;
    db.run(`UPDATE ${searchTable(job)} SET body=? WHERE portion=1`, ['unrelated']);
    const damaged = await auditSqliteDatabase(db);
    expect(damaged.ok).toBe(false);
    expect(damaged.issues.some(issue => issue.includes("derived text contents differ"))).toBe(true);
    expect(e.getRow('Row-one')?.body).toBe(body);
    db.rebuildIndexes(); await db.indexesReady();
    expect(db.sequence).toBe(sequence);
    expect((await auditSqliteDatabase(db)).ok).toBe(true);
  });

  it('replaces obsolete text generations on writable reopen and refuses a read-only upgrade', async () => {
    const { db, e } = open();
    e.create('Row', { id: 'Row-one', body: 'needle context' });
    await db.indexesReady();
    const job = db.indexBuilds.jobs().find(job => job.kind === 'text')!, sequence = db.sequence;
    const definition = { ...job.definition }; delete definition.textRevision;
    const current = searchTable(job), legacy = searchTable({ ...job, definition });
    // Construct the actual old six-column FTS layout, preserving its primary values and generation.
    db.sql.exec(`CREATE VIRTUAL TABLE ${legacy} USING fts5(entity_id UNINDEXED,field UNINDEXED,element UNINDEXED,body,aliases,owner,
      tokenize='unicode61 remove_diacritics 2');
      INSERT INTO ${legacy}(rowid,entity_id,field,element,body,aliases,owner)
        SELECT rowid,entity_id,field,element,body,aliases,owner FROM ${current} WHERE portion=0;
      CREATE TABLE ${legacy}_docs AS SELECT id,entity_id,field,element FROM ${current}_docs WHERE portion=0;
      CREATE UNIQUE INDEX ${legacy}_docs_entity ON ${legacy}_docs(entity_id,field,element);
      DROP TABLE ${current}; DROP TABLE ${current}_docs;`);
    db.run('UPDATE index_builds SET definition=? WHERE generation=?', [JSON.stringify(definition), job.generation]);
    db.close();
    const file = join(db.path, 'data.sqlite3'), before = readFileSync(file);
    expect(() => open(db.path, true)).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
    expect(readFileSync(file)).toEqual(before);
    const reopened = open(db.path);
    await reopened.db.indexesReady();
    const rebuilt = reopened.db.indexBuilds.jobs().find(job => job.kind === 'text')!;
    expect(rebuilt.generation).not.toBe(job.generation);
    expect(rebuilt.definition.textRevision).toBe(SQLITE_TEXT_REVISION);
    expect(reopened.db.sequence).toBe(sequence);
    expect(reopened.e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
    expect(reopened.e.getRow('Row-one')?.body).toBe('needle context');
  });

  it('combines unquoted compound terms across fields while keeping explicit phrases adjacent', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-split', name: 'generate', body: ['unrelated', 'entries'] });
    e.create('Row', { id: 'Row-phrase', body: 'unrelated generate-entries' });
    e.create('Row', { id: 'Row-half', name: 'generate', body: 'unrelated' });
    e.create('Row', { id: 'Row-other', name: 'unrelated' });
    const ids = (query: string, any = false) => e.query('Row').search(query, { fuzzy: false, any }).ids().sort();
    expect(ids('generate-entries')).toEqual(['Row-phrase', 'Row-split']);
    expect(ids('"generate-entries"')).toEqual(['Row-phrase']);
    expect(ids('generate-entries missing', true)).toEqual(['Row-phrase', 'Row-split']);
    expect(ids('unrelated -generate-entries')).toEqual(['Row-half', 'Row-other']);
    expect(ids('name:generate-entries')).toEqual([]);
    expect(ids('body:generate-entries')).toEqual(['Row-phrase']);
    const hit = e.query('Row').search('generate-entries', { fuzzy: false }).hits({ highlights: true })
      .find(hit => hit.id === 'Row-split');
    expect(hit?.highlights).toEqual({ name: [[0, 0, 8]], body: [[1, 0, 7]] });
  });

  it('combines stemmed compound terms across weighted fields without making a phrase match', () => {
    const { e } = open();
    e.admin.setSchema({ ...schema, types: { Row: { required: [], search: { fields: { name: 3, body: 1 }, stem: 'en' } } } });
    e.create('Row', { id: 'Row-generated', name: 'Generated files', body: 'These entries describe the output.' });
    expect(e.query('Row').search('generate-entries', { fuzzy: false }).ids()).toEqual(['Row-generated']);
    expect(e.query('Row').search('"generate-entries"', { fuzzy: false }).ids()).toEqual([]);
  });

  it('preserves native Unicode token characters when separating ASCII identifiers', () => {
    const { e } = open();
    e.create('Row', { id: 'Row-private', name: '\ue000key', body: 'suffix' });
    e.create('Row', { id: 'Row-accent', name: 'cafe\u0301', body: 'suffix' });
    expect(e.query('Row').search('\ue000key-suffix', { fuzzy: false }).ids()).toEqual(['Row-private']);
    expect(e.query('Row').search('key-suffix', { fuzzy: false }).ids()).toEqual([]);
    expect(e.query('Row').search('cafe\u0301.suffix', { fuzzy: false }).ids()).toEqual(['Row-accent']);
  });

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
