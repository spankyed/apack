import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import type { createRegexCompiler } from '../../src/sqlite/regex.ts';
const schema: EngineSchema = { types: {
  Row: { required: [], substrings: ['text', 'tags'] },
  Other: { required: [], substrings: ['text'] }, Plain: { required: [] },
}, relations: { edge: {} }, roles: [] };
const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => { vi.restoreAllMocks(); const stores = held.splice(0); for (const { db } of stores) db.close(); for (const path of new Set(stores.map(s => s.path))) rmSync(path, { recursive: true, force: true }); });
function open() {
  const path = mkdtempSync(join(tmpdir(), 'ears-trigrams-'));
  const db = new SqliteDatabase({ path, schema: toElmdbSchema(schema), syncs: false });
  held.push({ db, path }); return { db, e: createEarsEngine({ database: db }) };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite exact trigram filtering', () => {
  it('uses FTS5 for a selective literal, preserves duplicates and avoids whole-row hydration', () => {
    const { db, e } = open();
    e.transact(() => { for (let i = 0; i < 512; i++) e.create('Row', { id: `Row-${i}`, text: i === 400 ? 'unique needle tail' : 'other', body: 'large '.repeat(5000) }); });
    const hydrate = vi.spyOn(db.values, 'read');
    const explained = e.query('Row').containing('unique needle').explain();
    expect(explained.ids).toEqual(['Row-400']); expect(hydrate).not.toHaveBeenCalled();
    if (explained.backend !== 'sqlite') throw Error('Expected SQLite');
    expect(explained.statements.some(s => s.sql.includes(' MATCH ?'))).toBe(true);
    expect(explained.statements.flatMap(s => s.plan).some(p => p.detail.includes('VIRTUAL TABLE INDEX') && p.detail.includes('M'))).toBe(true);
    expect(e.query.ids(['Row-400', 'Row-1', 'Row-400']).containing('needle').ids()).toEqual(['Row-400', 'Row-400']);
    expect(e.query('Row').matching('unique.*tail$').ids()).toEqual(['Row-400']);
    const before = e.query('Row').limit(3).containing('needle').ids(); expect(before).toEqual([]);
    const subset = e.query.ids(['Row-400']).matching('.*').explain();
    if (subset.backend !== 'sqlite') throw Error('Expected SQLite');
    expect(subset.statements.flatMap(s => s.plan).some(p => p.detail.includes('SEARCH d') && p.detail.includes('_docs_entity'))).toBe(true);
    const compiler = (db.search.trigrams as unknown as { compiler: ReturnType<typeof createRegexCompiler> }).compiler;
    const compile = compiler.compile.bind(compiler); let checked = 0;
    vi.spyOn(compiler, 'compile').mockImplementation(pattern => {
      const matcher = compile(pattern); return { ...matcher, matches: text => { checked++; return matcher.matches(text); } };
    });
    expect(e.query('Row').matching('.*').limit(10).ids()).toHaveLength(10);
    expect(checked).toBeLessThanOrEqual(10);
  });

  it('matches individual strings, Unicode folding and short/NUL literals without crossing element boundaries', () => {
    const { e } = open();
    const inputs = ['', 'ΟΣ', 'ος', 'İ', '😀😃', 'before\0needle after', ['alpha', 'beta'], [4, 'ΩΣ', null]];
    for (const [i, text] of inputs.entries()) e.create('Row', { id: `Row-${i}`, text });
    expect(e.query('Row').containing('').ids()).toEqual(inputs.map((_, i) => `Row-${i}`));
    expect(e.query('Row').containing('alpha\n\nbeta').ids()).toEqual([]);
    expect(e.query('Row').matching('^alpha$').ids()).toEqual(['Row-6']);
    expect(e.query('Row').matching('^alphabeta$').ids()).toEqual([]);
    expect(e.query('Row').containing('οσ', { caseInsensitive: true }).ids()).toEqual(['Row-1']);
    expect(e.query('Row').containing('ος', { caseInsensitive: true }).ids()).toEqual(['Row-2']);
    expect(e.query('Row').containing('i\u0307', { caseInsensitive: true }).ids()).toEqual(['Row-3']);
    expect(e.query('Row').containing('😀😃').ids()).toEqual(['Row-4']);
    expect(e.query('Row').containing('needle').ids()).toEqual(['Row-5']);
    expect(e.query('Row').containing('\0needle').ids()).toEqual(['Row-5']);
  });

  it('keeps changed fields, units, unchecked repairs, deletes and read-only reopen consistent', () => {
    const { db, e } = open(), id = e.create('Row', { text: 'old marker' }).id();
    expect(() => e.transact(() => { e.write(id).set('text', 'aborted marker'); throw Error('abort'); })).toThrow('abort');
    expect(e.query('Row').containing('old marker').ids()).toEqual([id]);
    expect(e.query('Row').containing('aborted').ids()).toEqual([]);
    e.admin.bulkLoadAttr(id, 'text', ['new marker', 'second']);
    expect(e.query('Row').containing('old').ids()).toEqual([]);
    expect(e.query('Row').containing('new marker').ids()).toEqual([id]);
    const before = db.all("SELECT sql FROM sqlite_schema WHERE type='table' AND name LIKE 'tri_%_docs'");
    expect(before.length).toBeGreaterThan(0);
    e.write(id).set('counter', 1); expect(e.query('Row').matching('^second$').ids()).toEqual([id]);
    const path = db.path; db.close();
    const readOnly = new SqliteDatabase({ path, readOnly: true }); held.push({ db: readOnly, path });
    const reopened = createEarsEngine({ database: readOnly });
    expect(reopened.query('Row').containing('new marker').ids()).toEqual([id]);
  });

  it('releases every compiled regex on success and failures, including a later invalid pattern', () => {
    const { db, e } = open(); e.create('Row', { text: 'alpha marker' });
    const binding = createRequire(import.meta.url)('../../vendor/rregex/rregex.cjs');
    const free = vi.spyOn(binding.RRegex.prototype, 'free');
    expect(e.query('Row').matching('alpha').matching('marker').count()).toBe(1); expect(free).toHaveBeenCalledTimes(2);
    expect(() => e.query('Row').matching('alpha').matching('x(?=y)').ids()).toThrow(expect.objectContaining({ code: 'PATTERN_INVALID' }));
    expect(free).toHaveBeenCalledTimes(3);
    expect((db.search.trigrams as unknown as { matchers: Map<string, unknown> }).matchers.size).toBe(0);
    expect(db.sql.inTransaction).toBe(false);
    const all = db.all.bind(db);
    vi.spyOn(db, 'all').mockImplementation((sql, parameters) => { if (sql.includes('ears_text_match')) throw Error('injected SQL failure'); return all(sql, parameters); });
    expect(() => e.query('Row').matching('alpha').ids()).toThrow('injected SQL failure');
    expect(free).toHaveBeenCalledTimes(4);
    expect((db.search.trigrams as unknown as { matchers: Map<string, unknown> }).matchers.size).toBe(0);
  });

  it('handles empty/set-based inputs and refuses direct typed missing indexes', () => {
    const { e } = open(), row = e.create('Row', { text: 'alpha' }).id(), plain = e.create('Plain', { text: 'alpha' }).id();
    expect(e.query.ids([plain, row]).containing('alpha').ids()).toEqual([row]);
    expect(e.query('Plain').limit(0).containing('alpha').ids()).toEqual([]);
    expect(() => e.query('Plain').containing('alpha').ids()).toThrow(expect.objectContaining({ code: 'UNKNOWN_INDEX' }));
    expect(() => e.query('Plain').matching('x(?=y)').ids()).toThrow(expect.objectContaining({ code: 'PATTERN_INVALID' }));
  });

  it('notifies watches on committed text and declaration changes, with no aborted answer', async () => {
    const { e } = open(), id = e.create('Row', { text: 'old marker' }).id();
    const seen: string[][] = [], errors: unknown[] = [];
    const watch = e.watch(() => e.query('Row').containing('needle').ids(), { next: value => seen.push([...value]), error: error => errors.push(error) });
    try {
      await e.admin.watchesSettled(); expect(seen).toEqual([[]]);
      expect(() => e.transact(() => { e.write(id).set('text', 'needle'); throw Error('abort'); })).toThrow('abort');
      await e.admin.watchesSettled(); expect(seen).toEqual([[]]);
      e.write(id).set('text', 'needle'); await e.admin.watchesSettled(); expect(seen).toEqual([[], [id]]);
      e.admin.setSchema({ ...schema, types: { ...schema.types, Row: { required: [], substrings: ['tags'] } } });
      await e.admin.watchesSettled(); expect(seen).toEqual([[], [id], []]); expect(errors).toEqual([]);
    } finally { watch.stop(); }
  });

  it('agrees with the native backend across literal and regex corpora', async () => {
    const { db, e } = open(), { openDatabase } = await import('../../src/lmdb/index.ts');
    const path = mkdtempSync(join(tmpdir(), 'ears-trigram-oracle-'));
    const native = openDatabase({ path, schema, syncs: false });
    const other = createEarsEngine({ database: native });
    const texts = ['', 'ERROR timeout', 'alpha\nline', 'ΟΣ', 'ος', 'İ', '😀😃🙂', 'before\0needle', ['alpha', 'beta'], [4, 'Σ', '東京'], null, []];
    try {
      for (const [i, text] of texts.entries()) for (const engine of [e, other]) engine.create('Row', { id: `Row-${i}`, text });
      for (const text of ['', 'a', 'Σ', 'οσ', 'ος', 'i\u0307', '😀😃', 'needle', '\0needle', 'alpha\n\nbeta']) for (const caseInsensitive of [false, true]) {
        expect(e.query('Row').containing(text, { caseInsensitive }).ids(), JSON.stringify({ text, caseInsensitive }))
          .toEqual(other.query('Row').containing(text, { caseInsensitive }).ids());
      }
      for (const pattern of ['', '(?i)^error', '\\p{Greek}+', '\\b\\w+\\b', '^alpha$', 'alpha|beta', 'before.*needle', '😀😃', '[a-z&&[^b]]+']) {
        expect(e.query('Row').matching(pattern).ids(), pattern).toEqual(other.query('Row').matching(pattern).ids());
      }
      expect(db.sql.inTransaction).toBe(false);
    } finally { native.close(); rmSync(path, { recursive: true, force: true }); }
  });
});
