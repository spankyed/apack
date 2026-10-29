import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { auditSqliteDatabase } from '../../src/sqlite/audit.ts';
import { decodeLogicalSnapshot } from '../../src/sqlite/logical-format.ts';
import { exportLogicalSnapshot } from '../../src/sqlite/logical-export.ts';
const paths: string[] = [], stores: SqliteDatabase[] = [];
afterEach(() => { for (const db of stores.splice(0)) db.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
const root = () => { const path = mkdtempSync(join(tmpdir(), 'ears-embedding-authority-')); paths.push(path); return path; };
const schema = { types: { Row: { required: [], embed: { from: ['title'], model: 'fixture', dims: 3 } } }, relations: {}, roles: [] };
function fixture() {
  const path = root(), db = new SqliteDatabase({ path, schema: toElmdbSchema(schema), syncs: false }); stores.push(db);
  const e = createEarsEngine({ database: db }); e.create('Row', { id: 'Row-one', title: 'one' });
  const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
  return { path, db, e };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('primary embedding storage', () => {
  it('retains exactly one payload when generations are rebuilt and collected', async () => {
    const { db, e } = fixture(), before = db.get('SELECT * FROM embedding_values'), commit = e.lastCommit();
    for (let i = 0; i < 3; i++) { db.rebuildIndexes(); await db.indexesReady(); }
    for (let i = 0; i < 1000 && db.indexBuilds.step() !== 'idle'; i++); // Exercise actual generation retirement too.
    expect(db.all('SELECT * FROM embedding_values')).toEqual([before]);
    expect(db.all('PRAGMA table_info(chunks)').some(row => row.name === 'embedding')).toBe(false);
    expect(e.pendingEmbeddings('Row').count).toBe(0); expect(e.query('Row').near([1, 0, 0]).ids()).toEqual(['Row-one']);
    expect(e.lastCommit()).toBe(commit); expect((await auditSqliteDatabase(db)).ok).toBe(true);
  });
  it('recovers lost derived chunks without losing embeddings', async () => {
    const { db, path, e } = fixture(), commit = e.lastCommit(), original = db.get('SELECT * FROM embedding_values');
    db.sql.exec('DROP TABLE chunks'); db.close();
    const reopened = new SqliteDatabase({ path, syncs: false }); stores.push(reopened); await reopened.indexesReady();
    const reader = createEarsEngine({ database: reopened });
    expect(reopened.get('SELECT * FROM embedding_values')).toEqual(original);
    expect(reader.pendingEmbeddings('Row').count).toBe(0); expect(reader.query('Row').near([1, 0, 0]).ids()).toEqual(['Row-one']);
    expect(reader.lastCommit()).toBe(commit);
  });
  it('keeps dormant raw identities exportable without inventing generations and reuses matching restored bytes', async () => {
    const { db, e } = fixture();
    const current = db.get('SELECT * FROM embedding_values')!;
    db.embeddings.restore({ id: 'Row-one', index: 'dormant', chunk: 7, hash: 'old-content', model: 'old-model', dimensions: 2,
      bytes: Buffer.from(new Float32Array([0, 1]).buffer) });
    db.sql.exec('DELETE FROM chunks'); db.embeddings.relink();
    const records = []; for await (const row of decodeLogicalSnapshot(exportLogicalSnapshot(db))) if (row.kind === 'embedding') records.push(row);
    expect(records).toHaveLength(2); expect(records.find(row => row.index === 'dormant')).toMatchObject({ chunk: 7, hash: 'old-content', model: 'old-model', dimensions: 2 });
    db.rebuildIndexes(); await db.indexesReady();
    expect(db.get('SELECT * FROM embedding_values WHERE id=?', [current.id])).toEqual(current);
    expect(e.pendingEmbeddings('Row').count).toBe(0);
  });
  it('supersedes obsolete versions atomically and rolls primary bytes and references back with the unit', () => {
    const { db, e } = fixture(), before = db.all('SELECT * FROM embedding_values');
    expect(() => e.transact(() => {
      e.write('Row-one').set('title', 'changed');
      const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [0, 1, 0] })));
      expect(db.get('SELECT count(*) n FROM embedding_values')!.n).toBe(1);
      expect(e.query('Row').near([0, 1, 0]).hits()[0]!.score).toBeCloseTo(1);
      throw Error('rollback');
    })).toThrow('rollback');
    expect(db.all('SELECT * FROM embedding_values')).toEqual(before);
    expect(e.getAttr('Row-one', 'title')).toBe('one'); expect(e.query('Row').near([1, 0, 0]).hits()[0]!.score).toBeCloseTo(1);
    e.write('Row-one').set('title', 'changed'); const pending = e.pendingEmbeddings('Row');
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [0, 1, 0] })));
    expect(db.get('SELECT count(*) n FROM embedding_values')!.n).toBe(1); expect(db.get('SELECT hash FROM embedding_values')!.hash).toBe(pending.chunks[0]!.hash);
    e.write('Row-one').destroy(); expect(db.get('SELECT count(*) n FROM embedding_values')!.n).toBe(0);
  });
  it('refuses missing primary storage rather than rebuilding it as empty', () => {
    const { db, path } = fixture(); db.sql.exec('DROP TABLE embedding_values'); db.close();
    expect(() => new SqliteDatabase({ path, syncs: false })).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    const native = new NativeDatabase(join(path, 'data.sqlite3'), { readonly: true });
    try { expect(native.prepare("SELECT name FROM sqlite_schema WHERE name='embedding_values'").get()).toBeUndefined(); } finally { native.close(); }
  });
  it.each([false, true])('refuses a legacy candidate without changing its bytes (readOnly=%s)', readOnly => {
    const path = join(root(), 'old'); mkdirSync(path); const file = join(path, 'data.sqlite3');
    const native = new NativeDatabase(file); native.exec('CREATE TABLE chunks(embedding BLOB); INSERT INTO chunks VALUES (zeroblob(12))'); native.close();
    const before = readFileSync(file);
    expect(() => new SqliteDatabase({ path, readOnly, syncs: false })).toThrow(expect.objectContaining({ code: 'WRONG_FORMAT' }));
    expect(readFileSync(file)).toEqual(before);
  });
  it('refuses invalid raw Float32 payloads before replacing stored data', () => {
    const { db } = fixture(), before = db.all('SELECT * FROM embedding_values'), row = before[0]!;
    for (const bytes of [Buffer.alloc(12), Buffer.alloc(4), Buffer.from(new Float32Array([Infinity, 1, 0]).buffer)])
      expect(() => db.embeddings.restore({ id: row.entity_id, index: row.index_name, chunk: row.chunk, hash: row.hash,
        model: row.model, dimensions: row.dims, bytes })).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    expect(db.all('SELECT * FROM embedding_values')).toEqual(before);
  });
});
