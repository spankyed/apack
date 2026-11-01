import { afterEach, describe, expect, it, vi } from 'vitest';
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
    let nativePlan: ReturnType<SqliteDatabase['all']> = [], materializedIds = 0;
    const all = db.all.bind(db), eligibilityProbes: number[] = [];
    db.all = (sql, parameters = []) => {
      if (sql.startsWith('WITH candidates AS MATERIALIZED')) nativePlan = all('EXPLAIN QUERY PLAN ' + sql, parameters);
      const rows = all(sql, parameters);
      if(sql.startsWith('WITH eligible AS MATERIALIZED'))eligibilityProbes.push(Number(rows[0]!.n));
      if (sql.startsWith('SELECT p.id FROM (')) materializedIds = Math.max(materializedIds, rows.length);
      return rows;
    };
    let reranked = 0;
    db.sql.function('vec_distance_cosine', { deterministic: true }, (a, b) => {
      if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) throw Error('Expected Float32 blobs');
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
    expect(eligibilityProbes[0]).toBe(4097);
    reranked = 0;
    expect(e.query('Row').near(positive, { k: 64 }).ids()).toEqual(ids.slice(0, 64));
    expect(reranked).toBe(555); // The 64-result route retains the same bounded owner pool.

    // Canonical BLOB lookup must be driven by selected owners, rather than scanning the whole generation
    // before joining candidates. Function-call bounds alone cannot detect those unnecessary BLOB reads.
    expect(nativePlan.filter(row => row.parent === 0).some(row =>
      String(row.detail).includes('chunk_vectors') && String(row.detail).includes('entity_id=?'))).toBe(true);
    reranked = 0; materializedIds = 0;
    expect(e.query.ids(ids.slice(300)).near(positive, { k: 5 }).ids()).toEqual(ids.slice(300, 305));
    expect(reranked).toBe(256); // Excludes the entire unfiltered candidate prefix before limiting.
    expect(materializedIds).toBeLessThanOrEqual(5);
    expect(nativePlan.filter(row => row.parent === 0 && String(row.detail).startsWith('LIST SUBQUERY'))).toHaveLength(1);
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

  it('evaluates a small eligibility scope once for counting and exact scoring',()=>{
    const {db,e}=fixture(128),vector=[1,...Array<number>(127).fill(0)];
    const ids=Array.from({length:3},(_,i)=>e.create('Row',{title:String(i)}).id());
    const pending=e.pendingEmbeddings('Row');
    e.embed(pending.chunks.map(chunk=>({...chunk,model:pending.model,vector})));
    let evaluated=0;
    db.sql.function('scope_probe',{deterministic:false},(_id)=>{evaluated++;return 1;});
    const job=db.indexBuilds.jobs().find(job=>job.kind==='vector')!;
    const rows=db.search.vectors.search({sql:'SELECT id FROM entities WHERE scope_probe(id)',parameters:[]},
      'Row',job.name,job.generation,128,vector,2);
    expect(rows.map(row=>row.id)).toEqual(ids.slice(0,2));
    expect(evaluated).toBe(3);
  });

  it('stops a streaming eligibility scope at the chunk threshold and keeps limited, duplicate and empty scopes exact', () => {
    const { db, e } = fixture(128), vector = [1, ...Array<number>(127).fill(0)], ids: EARS.EntityId[] = [];
    e.transact(() => { for (let i = 0; i < 4200; i++) ids.push(e.create('Row', { title: String(i) }).id()); });
    const pending = e.pendingEmbeddings('Row', { limit: 5000 });
    e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector })));
    const job = db.indexBuilds.jobs().find(job => job.kind === 'vector')!;
    let visits = 0;
    db.sql.function('stream_scope_probe', { deterministic: false }, (_id) => { visits++; return 1; });
    const reachedNative = new Error('bounded probe reached native routing');
    const native = vi.spyOn(db.indexBuilds, 'nativeVectorOwners').mockImplementation(() => { throw reachedNative; });
    try {
      expect(() => db.search.vectors.search({ sql: 'SELECT id FROM entities WHERE stream_scope_probe(id)', parameters: [] },
        'Row', job.name, job.generation, 128, vector, 10)).toThrow(reachedNative);
      expect(visits).toBe(4097);
      visits = 0;
      expect(() => db.search.vectors.search({ sql: 'SELECT id FROM entities WHERE stream_scope_probe(id)', parameters: [] },
        'Row', job.name, job.generation, 128, vector, 10, ids[0])).toThrow(reachedNative);
      expect(visits).toBe(4098);
      visits = 0;
      const limited = db.search.vectors.search({
        sql: 'SELECT id FROM entities WHERE stream_scope_probe(id) ORDER BY seq LIMIT 20', parameters: [],
      }, 'Row', job.name, job.generation, 128, vector, 10);
      expect(limited.map(row => row.id)).toEqual(ids.slice(0, 10)); expect(visits).toBe(20);
      const duplicates = Array.from({ length: 2000 }, () => [ids[2], ids[1], ids[0]]).flat();
      const repeated = db.search.vectors.search({ sql: 'SELECT value id FROM json_each(?)', parameters: [JSON.stringify(duplicates)] },
        'Row', job.name, job.generation, 128, vector, 10);
      expect(repeated.map(row => row.id)).toEqual(ids.slice(0, 3));
      expect(db.search.vectors.search({ sql: 'SELECT value id FROM json_each(?)', parameters: ['[]'] },
        'Row', job.name, job.generation, 128, vector, 10)).toEqual([]);
      expect(native).toHaveBeenCalledTimes(2);
    } finally { native.mockRestore(); }
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

  it('audits missing or corrupt projections and rebuilds without changing primary bytes or commit identity', async () => {
    const { db, e } = fixture(); e.create('Row', { title: 'one' });
    const pending = e.pendingEmbeddings('Row'); e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: [1, 0, 0] })));
    const canonical = db.all('SELECT * FROM embedding_values'), sequence = db.sequence;
    db.sql.exec('DELETE FROM embedding_search');
    expect((await auditSqliteDatabase(db)).ok).toBe(false);
    db.rebuildIndexes(); await db.indexesReady();
    expect((await auditSqliteDatabase(db)).ok).toBe(true);
    db.run('UPDATE embedding_search SET normalized=?', [Buffer.from(new Float32Array([0, 1, 0]).buffer)]);
    expect((await auditSqliteDatabase(db)).ok).toBe(false);
    db.rebuildIndexes(); await db.indexesReady();
    expect((await auditSqliteDatabase(db)).ok).toBe(true);
    expect(e.query('Row').near([1, 0, 0]).hits()[0]!.score).toBeCloseTo(1);
    expect(db.all('SELECT * FROM embedding_values')).toEqual(canonical); expect(db.sequence).toBe(sequence);
  });
});
