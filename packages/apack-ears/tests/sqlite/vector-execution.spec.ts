import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EARS } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { auditSqliteDatabase } from '../../src/sqlite/audit.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => { for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); } });
function fixture(dimensions = 3) {
  const path = mkdtempSync(join(tmpdir(), 'ears-vector-execution-'));
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: {
    Row: { required: [], embed: { from: ['title'], model: 'fixture', dims: dimensions, chunk: 'paragraph' } },
  }, relations: {}, roles: [] }) });
  held.push({ db, path }); return { db, e: createEarsEngine({ database: db }) };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('native vector execution', () => {
  it('bounds exact reranking by candidate owners, filters before K and reads unit/savepoint changes', async () => {
    const { db, e } = fixture(128), ids: EARS.EntityId[] = [];
    const positive = [1, ...Array<number>(127).fill(0)], negative = [-1, ...Array<number>(127).fill(0)];
    e.transact(() => {
      for (let i = 0; i < 4600; i++) ids.push(e.create('Row', {
        title: i === 0 ? Array.from({ length: 300 }, (_, n) => `chunk ${n}`).join('\n\n') : `row ${i}`,
      }).id());
    });
    const pending = e.pendingEmbeddings('Row', { limit: 10000 });
    expect(pending.chunks).toHaveLength(4899);
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: positive })));
    expect(db.get('SELECT count(*) n FROM embedding_search')!.n).toBe(4899);

    // Independent scalar instrumentation makes the exact-scan mutation fail this test. It does not
    // replace native Hamming candidate selection and is never registered by production code.
    let reranked = 0;
    db.sql.function('vec_distance_cosine', { deterministic: true }, (a: Uint8Array, b: Uint8Array) => {
      reranked++;
      const x = new DataView(a.buffer, a.byteOffset, a.byteLength), y = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let dot = 0, xx = 0, yy = 0;
      for (let offset = 0; offset < x.byteLength; offset += 4) {
        const left = x.getFloat32(offset, true), right = y.getFloat32(offset, true);
        dot += left * right; xx += left * left; yy += right * right;
      }
      return 1 - dot / Math.sqrt(xx * yy);
    });
    expect(e.query('Row').near(positive, { k: 5 }).ids()).toEqual(ids.slice(0, 5));
    expect(reranked).toBe(555); // All 300 chunks of the first owner, plus 255 other owners.
    reranked = 0;
    expect(e.query.ids(ids.slice(300)).near(positive, { k: 5 }).ids()).toEqual(ids.slice(300, 305));
    expect(reranked).toBe(256); // Excludes the entire unfiltered candidate prefix before limiting.
    e.write(ids[0]!).trash();
    expect(e.query('Row').near(positive, { k: 5 }).ids()).toEqual(ids.slice(1, 6));
    reranked = 0;
    expect(e.query('Row').near(positive, { k: 300 }).ids()).toEqual(ids.slice(1, 301));
    expect(reranked).toBe(4599);

    const first = pending.chunks.find(chunk => chunk.id === ids[1])!, second = pending.chunks.find(chunk => chunk.id === ids[2])!;
    const replace = (chunk: typeof first) => e.embed([{ ...chunk, model: pending.model, vector: negative }]);
    const nearest = () => e.query('Row').near(positive, { k: 1 }).ids();
    const seen: EARS.EntityId[][] = [], watching = e.watch(nearest, result => seen.push(result));
    try {
      await e.admin.watchesSettled(); expect(seen).toEqual([[ids[1]]]);
      expect(() => e.transact(() => {
        replace(first); expect(nearest()).toEqual([ids[2]]);
        expect(() => e.transact(() => { replace(second); expect(nearest()).toEqual([ids[3]]); throw Error('nested'); })).toThrow('nested');
        expect(nearest()).toEqual([ids[2]]); throw Error('outer');
      })).toThrow('outer');
      await e.admin.watchesSettled(); expect(seen).toEqual([[ids[1]]]);
      replace(first); await e.admin.watchesSettled(); expect(seen).toEqual([[ids[1]], [ids[2]]]);
      e.write(ids[1]!).destroy();
      expect(db.get('SELECT 1 FROM embedding_search p LEFT JOIN embedding_values v ON v.id=p.embedding_id WHERE v.id IS NULL')).toBeUndefined();
    } finally { watching.stop(); }
  });

  it('keeps finite cosine scores for extreme directions without rewriting canonical bytes', () => {
    const { db, e } = fixture();
    const vectors = [[1e-25, 0, 0], [2 ** 120, 0, 0], [-1e-25, 0, 0], [0, 1e-25, 0]];
    const ids = vectors.map((_, i) => e.create('Row', { title: String(i) }).id());
    const pending = e.pendingEmbeddings('Row');
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: vectors[ids.indexOf(chunk.id)]! })));
    const canonical = db.all('SELECT * FROM embedding_values ORDER BY id');
    for (const query of [[1e-25, 0, 0], [2 ** 120, 0, 0]]) {
      const hits = e.query('Row').near(query).hits();
      expect(hits.map(hit => hit.id)).toEqual([ids[0], ids[1], ids[3], ids[2]]);
      expect(hits.every(hit => Number.isFinite(hit.score))).toBe(true);
      expect(hits.map(hit => hit.score)).toEqual([1, 1, 0, -1]);
    }
    expect(db.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(canonical);
  });

  it('audits missing projections and rebuilds them without changing primary bytes or commit identity', async () => {
    const { db, e } = fixture(); e.create('Row', { title: 'one' });
    const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
    const canonical = db.all('SELECT * FROM embedding_values'), sequence = db.sequence;
    db.sql.exec('DELETE FROM embedding_search');
    expect((await auditSqliteDatabase(db)).ok).toBe(false);
    db.rebuildIndexes(); await db.indexesReady();
    expect((await auditSqliteDatabase(db)).ok).toBe(true);
    expect(db.all('SELECT * FROM embedding_values')).toEqual(canonical); expect(db.sequence).toBe(sequence);
  });
});
