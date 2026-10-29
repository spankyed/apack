import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteSearch } from '../../src/sqlite/search.ts';
import { searchTable } from '../../src/sqlite/index-builds.ts';
import { SqliteValues } from '../../src/sqlite/values.ts';

const schema: EngineSchema = { types: {
  Row: { required: [], search: { fields: { title: 1 } }, substrings: ['title'], embed: { from: ['title'], model: 'fixture', dims: 3 } },
  Other: { required: [] },
}, relations: {}, roles: [] };
const stores: SqliteDatabase[] = [], paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open(path?: string, readOnly = false) {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-search-recovery-')); paths.push(path); }
  const db = new SqliteDatabase({ path, readOnly, syncs: false, ...(!stores.some(s => s.path === path) ? { schema: toElmdbSchema(schema) } : {}) });
  stores.push(db); return { db, e: createEarsEngine({ database: db }) };
}
function seed() {
  const { db, e } = open();
  e.create('Row', { id: 'Row-one', title: 'alpha needle' });
  e.create('Row', { id: 'Row-two', title: 'second marker' });
  e.create('Other', { id: 'Other-large', body: 'unrelated '.repeat(10000) });
  const { model, chunks } = e.pendingEmbeddings('Row');
  e.embed(chunks.map(c => ({ ...c, model, vector: c.id === 'Row-one' ? [1, 0, 0] : [0, 1, 0] })));
  const names = db.all("SELECT name FROM sqlite_schema WHERE type='table'").map(r => String(r.name));
  const text = names.find(n => /^fts_[a-f0-9]{24}$/.test(n))!;
  const tri = names.find(n => /^tri_[a-f0-9]{24}$/.test(n))!;
  return { db, e, text, tri };
}
const components: Array<[string, 'TABLE' | 'INDEX' | 'TRIGGER', (text: string, tri: string) => string]> = [
  ['trigram table', 'TABLE', (_t, g) => g],
  ['trigram documents', 'TABLE', (_t, g) => g + '_docs'],
  ['trigram owner index', 'INDEX', (_t, g) => g + '_docs_entity'],
  ...['ai', 'ad', 'au'].map(suffix => ['trigram trigger ' + suffix, 'TRIGGER', (_t: string, g: string) => g + '_docs_' + suffix] as typeof components[number]),
  ['text table', 'TABLE', t => t],
  ['text documents', 'TABLE', t => t + '_docs'],
  ['text owner index', 'INDEX', t => t + '_docs_entity'],
  ['text metadata', 'TABLE', () => 'text_meta'],
  ['vector chunks', 'TABLE', () => 'chunks'],
  ['pending vector index', 'INDEX', () => 'chunk_pending'],
  ['vector reuse index', 'INDEX', () => 'chunk_reuse'],
  ['vector retirement index', 'INDEX', () => 'chunk_generation'],
  ['text retirement index', 'INDEX', () => 'text_generation'],
  ['trigram shadow index', 'TABLE', (_t, g) => g + '_idx'],
  ['text shadow content', 'TABLE', t => t + '_content'],
];

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite missing search storage recovery', () => {
  it.each(components)('refuses read-only and reconstructs %s in a private background generation', async (_label, kind, name) => {
    const { db, text, tri } = seed(), path = db.path, sequence = db.sequence;
    db.close();
    const damage = new NativeDatabase(join(path, 'data.sqlite3'));
    try { damage.unsafeMode(true); damage.exec(`DROP ${kind} ${name(text, tri)}`); }
    finally { damage.close(); }
    expect(() => open(path, true)).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    const reads = vi.spyOn(SqliteValues.prototype, 'read');
    const { db: repaired, e } = open(path);
    expect(reads).not.toHaveBeenCalled();
    await repaired.indexesReady();
    expect(repaired.sequence, 'derived repair is not a logical mutation').toBe(sequence);
    expect(reads.mock.calls.every(([layout, , fields]) => layout.name === 'Row' && fields?.every(f => f === 'title'))).toBe(true);
    expect(e.query('Row').containing('needle').ids()).toEqual(['Row-one']);
    expect(e.query('Row').matching('second.*marker').ids()).toEqual(['Row-two']);
    expect(e.query('Row').search('needle').ids()).toEqual(['Row-one']);
    expect(e.query('Row').search('databse').ids()).toEqual([]);
    if (name(text, tri) === 'chunks') {
      expect(e.pendingEmbeddings('Row').count).toBe(2);
    } else {
      expect(e.pendingEmbeddings('Row').count).toBe(0);
      expect(e.query('Row').near([1, 0, 0], { k: 1 }).ids()).toEqual(['Row-one']);
    }
    repaired.close();
    const readonly = open(path, true); expect(readonly.e.query('Row').search('marker').ids()).toEqual(['Row-two']);
  });

  it('rebuilds stale external-content postings after a missing update trigger', async () => {
    const { db, e, tri } = seed(), path = db.path;
    db.sql.exec(`DROP TRIGGER ${tri}_docs_ai`);
    e.write('Row-one').set('title', 'new current text');
    db.close();
    const repaired = open(path); await repaired.db.indexesReady();
    expect(repaired.e.query('Row').containing('needle').ids()).toEqual([]);
    expect(repaired.e.query('Row').containing('current').ids()).toEqual(['Row-one']);
  });

  it('rolls back partial postings on a background repair failure, refuses incomplete reads and retries cleanly', async () => {
    const { db, text } = seed(), path = db.path, sequence = db.sequence;
    db.sql.exec(`DROP TABLE ${text}`); db.close();
    const repaired = open(path), job = repaired.db.indexBuilds.jobs().find(j => j.kind === 'text')!, table = searchTable(job);
    const original = SqliteSearch.prototype.refileIndex; let calls = 0;
    const refile = vi.spyOn(SqliteSearch.prototype, 'refileIndex').mockImplementation(function(this: SqliteSearch, ...args) {
      original.apply(this, args); if (++calls === 2) throw Error('injected repair failure');
    });
    expect(repaired.db.indexBuilds.step()).toBe('failed');
    expect(repaired.db.get(`SELECT count(*) n FROM ${table}`)!.n).toBe(0);
    expect(() => repaired.e.query('Row').search('needle').ids()).toThrow(expect.objectContaining({ code: 'INDEX_FAILED' }));
    await expect(repaired.db.indexesReady()).rejects.toMatchObject({ code: 'INDEX_FAILED' });
    refile.mockRestore(); repaired.db.close();
    const retry = open(path); await retry.db.indexesReady(); expect(retry.db.sequence).toBe(sequence);
    expect(retry.e.query('Row').search('needle').ids()).toEqual(['Row-one']);
  });

  it('preserves repair and rollback errors, stops scheduling and discards the transaction on close', async () => {
    const { db, text } = seed(), path = db.path;
    db.sql.exec(`DROP TABLE ${text}`); db.close();
    const repaired = open(path), job = repaired.db.indexBuilds.jobs().find(j => j.kind === 'text')!, table = searchTable(job);
    const refile = vi.spyOn(repaired.db.search, 'refileIndex').mockImplementation(() => { throw Error('primary repair failure'); });
    const exec = repaired.db.sql.exec.bind(repaired.db.sql);
    const rollback = vi.spyOn(repaired.db.sql, 'exec').mockImplementation(sql => {
      if (sql === 'ROLLBACK') throw Error('secondary rollback failure'); return exec(sql);
    });
    expect(repaired.db.indexBuilds.step()).toBe('failed');
    expect(repaired.db.indexBuilds.lastError).toBeInstanceOf(AggregateError);
    expect((repaired.db.indexBuilds.lastError as AggregateError).errors.map((error: Error) => error.message))
      .toEqual(['primary repair failure', 'secondary rollback failure']);
    await expect(repaired.db.indexesReady()).rejects.toBe(repaired.db.indexBuilds.lastError);
    expect(repaired.db.indexBuilds.step()).toBe('paused');
    rollback.mockRestore(); refile.mockRestore(); repaired.db.close();
    const raw = new NativeDatabase(join(path, 'data.sqlite3'), { readonly: true });
    try { expect(raw.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 }); }
    finally { raw.close(); }
    const retry = open(path); await retry.db.indexesReady(); expect(retry.e.query('Row').search('needle').ids()).toEqual(['Row-one']);
  });

  it('opens healthy storage while another handle owns a write unit and reads only its committed state', () => {
    const { db, e } = seed();
    let second: ReturnType<typeof open> | undefined;
    e.transact(() => {
      e.write('Row-one').set('title', 'not committed yet');
      second = open(db.path);
      expect(second.e.getAttr('Row-one', 'title')).toBe('alpha needle');
      expect(second.e.query('Row').containing('needle').ids()).toEqual(['Row-one']);
    });
    expect(second!.e.getAttr('Row-one', 'title')).toBe('not committed yet');
    expect(second!.e.query('Row').containing('needle').ids()).toEqual([]);
  });

  it('pages only affected search inputs and leaves a healthy reopen free of hydration', async () => {
    const { db, e, tri } = seed(), path = db.path;
    e.transact(() => { for (let i = 0; i < 300; i++) e.create('Row', { id: `Row-${i}`, title: 'needle ' + i, body: 'large '.repeat(1000) }); });
    db.sql.exec(`DROP TABLE ${tri}`); db.close();
    const reads = vi.spyOn(SqliteValues.prototype, 'read');
    const repaired = open(path); expect(reads).not.toHaveBeenCalled(); await repaired.db.indexesReady();
    expect(Math.max(...reads.mock.calls.map(([, ids]) => ids.length))).toBeLessThanOrEqual(repaired.db.indexBuilds.batchRows);
    expect(reads.mock.calls.every(([layout, , fields]) => layout.name === 'Row' && fields?.every(f => f === 'title'))).toBe(true);
    expect(repaired.e.query('Row').containing('needle').count()).toBe(301);
    repaired.db.close(); reads.mockClear();
    open(path); expect(reads).not.toHaveBeenCalled();
  });
});
