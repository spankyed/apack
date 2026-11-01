// Compatibility qualification for an existing-function optimization; production scoring is unchanged.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => {
  for (const { db, path } of held.splice(0)) {
    try { db.close(); } finally { rmSync(path, { recursive: true, force: true }); }
  }
});
const rounded = (values: number[]) => Array.from(Float32Array.from(values));
function cosine(left: number[], right: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i]! * right[i]!; aa += left[i]! ** 2; bb += right[i]! ** 2;
  }
  return dot / Math.sqrt(aa * bb);
}

// Fallback execution stays required. Only the comparison leg loads the application-owned vec1 artifact.
describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite' && !!process.env.EARS_VEC1_EXTENSION)(
  'canonical cosine compatibility', () => {
    it.each([1, 3, 7, 8, 127, 128, 1536])(
      'matches independent cosine across fallback projections and finite Float32 magnitudes (%i dimensions)', dimensions => {
        const path = mkdtempSync(join(tmpdir(), 'ears-cosine-'));
        const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: {
          Row: { required: [], embed: { from: ['title'], model: 'fixture', dims: dimensions } },
        }, relations: {}, roles: [] }) });
        held.push({ db, path });
        const e = createEarsEngine({ database: db });
        const base = Array.from({ length: 8 }, (_, row) => Array.from({ length: dimensions }, (_, axis) =>
          Math.sin((row + 1) * (axis + 1) * 1.71)));
        // Include opposite/cancellation-heavy directions and positive scaling ties.
        base.push(base[0]!.map(value => -value), base[0]!.map((value, axis) => axis % 2 ? -value : value));
        const vectors = base.flatMap(vector => [1, 1e-30, 1e30, 1e-40].map(scale => rounded(vector.map(value => value * scale))));
        const ids = vectors.map((_, i) => e.create('Row', { title: String(i) }).id());
        const pending = e.pendingEmbeddings('Row', { limit: 100 });
        expect(pending.chunks).toHaveLength(vectors.length);
        e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model, vector: vectors[ids.indexOf(chunk.id)]! })));
        const canonical = db.all('SELECT * FROM embedding_values ORDER BY id'), sequence = db.sequence;
        expect(db.nativeVectorExtension).toBeUndefined();
        const queries = [vectors[0]!, vectors[3]!, rounded(base[2]!), rounded(base[8]!)];
        const fallback = queries.map(query => e.query('Row').near(query, { k: 64 }).hits());
        expect(db.nativeVectorExtension).toBeUndefined();
        db.loadNativeVectors(process.env.EARS_VEC1_EXTENSION!);
        for (const [ordinal, query] of queries.entries()) {
          const magnitude = Math.sqrt(query.reduce((sum, value) => sum + value ** 2, 0));
          const normalized = Buffer.from(Float32Array.from(query, value => value / magnitude).buffer);
          const scored = db.all(`SELECT v.entity_id id,
            1-vec1_cos_distance(coalesce(p.normalized,v.embedding),?) score
            FROM embedding_values v JOIN embedding_search p ON p.embedding_id=v.id`, [normalized]);
          expect(scored).toHaveLength(vectors.length);
          const byId = new Map(scored.map(row => [row.id, Number(row.score)]));
          expect(fallback[ordinal]).toHaveLength(vectors.length);
          for (const hit of fallback[ordinal]!) {
            const expected = cosine(vectors[ids.indexOf(hit.id)]!, query), candidate = byId.get(hit.id)!;
            expect(Number.isFinite(candidate)).toBe(true);
            expect(Math.abs(hit.score - expected)).toBeLessThanOrEqual(1e-5);
            expect(Math.abs(candidate - expected)).toBeLessThanOrEqual(1e-5);
          }
          // Numerical ties may exchange order; every distinctly better owner must remain ahead.
          const sorted = [...scored].sort((a, b) => b.score - a.score);
          for (let i = 1; i < sorted.length; i++) {
            const before = cosine(vectors[ids.indexOf(sorted[i - 1]!.id)]!, query);
            const after = cosine(vectors[ids.indexOf(sorted[i]!.id)]!, query);
            expect(before + 2e-5).toBeGreaterThanOrEqual(after);
          }
        }
        expect(db.all('SELECT * FROM embedding_values ORDER BY id')).toEqual(canonical);
        expect(db.sequence).toBe(sequence);
      }
    );
  }
);
