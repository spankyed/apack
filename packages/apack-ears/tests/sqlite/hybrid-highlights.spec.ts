import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EARS } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('hybrid winner highlights', () => {
  it('formats only final lexical winners while preserving global fusion scores, list highlights and scoped mixed-type answers', async () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-hybrid-highlights-'));
    const definition = { required: [], search: { fields: { title: 3, body: 1 } },
      embed: { from: ['title'], model: 'fixture', dims: 2 } };
    const db = new SqliteDatabase({ path, syncs: false,
      schema: toElmdbSchema({ types: { Row: definition, Other: definition }, relations: {}, roles: [] }) });
    const all = db.all.bind(db);
    try {
      const e = createEarsEngine({ database: db });
      e.transact(() => {
        for (const type of ['Row', 'Other']) for (let i = 0; i < 64; i++) e.create(type, {
          id: `${type}-${i}`, title: `title ${i}`, updated: i * 10,
          body: [i < 2 ? 'rare alpha' : 'needle alpha', `needle alpha \u0001 ${i}`],
        });
        e.create('Row', { id: 'Row-vector-only', title: 'unmatched', body: 'unrelated' });
      });
      await db.indexesReady();
      for (const type of ['Row', 'Other']) {
        const pending = e.pendingEmbeddings(type, { limit: 1000 });
        e.embed(pending.chunks.map(chunk => ({ ...chunk, model: pending.model,
          vector: chunk.id.endsWith('vector-only') ? [1, 0] : [1, (Number(chunk.id.split('-')[1]) + 1) / 64] })));
      }
      const selected: EARS.EntityId[] = ['Row-vector-only', ...Array.from({ length: 12 }, (_, i) => `Row-${i}` as const),
        ...Array.from({ length: 12 }, (_, i) => `Other-${i}` as const)];
      const scopes = [() => e.query('Row'), () => e.query.ids(selected).limit(21)];
      const options = { fuzzy: false, recency: { field: 'updated', halfLife: 50, now: 1000 } };
      for (const scope of scopes) for (const text of ['needle alpha', 'rare alpha', 'absent']) {
        db.all = all;
        const lexical = scope().search(text, options).hits({ highlights: true }), vectors = scope().near([1, 0], { k: 40 }).ids();
        const query = scope().hybrid(text, [1, 0], { ...options, k: 5 });
        const expected = query.ids(), winners = new Set(expected);
        const lexicalById = new Map(lexical.map(hit => [hit.id, hit]));
        const expectedLexical = new Set(expected.filter(id => lexicalById.has(id)));
        const formatted = new Set<string>(); let highlightRows = 0;
        db.all = (sql, parameters = []) => {
          const rows = all(sql, parameters);
          if (sql.includes('highlight(')) {
            highlightRows += rows.length;
            for (const row of rows) { expect(winners.has(row.id)).toBe(true); formatted.add(row.id); }
          }
          return rows;
        };
        const actual = query.hits({ highlights: true });
        expect(actual.map(hit => hit.id)).toEqual(expected);
        expect(formatted).toEqual(expectedLexical);
        // Two clauses × two list elements; the literal marker also requires one bounded retry.
        expect(highlightRows).toBeLessThanOrEqual(expectedLexical.size * 8);
        for (const hit of actual) {
          const textRank = lexical.findIndex(row => row.id === hit.id), vectorRank = vectors.indexOf(hit.id);
          expect(hit.score).toBeCloseTo((textRank < 0 ? 0 : 1 / (61 + textRank)) +
            (vectorRank < 0 ? 0 : 1 / (61 + vectorRank)), 12);
          expect(hit.terms).toEqual(lexicalById.get(hit.id)?.terms ?? []);
          expect(hit.highlights).toEqual(lexicalById.get(hit.id)?.highlights ?? {});
        }
        if (text === 'rare alpha') expect(actual.some(hit => !lexicalById.has(hit.id))).toBe(true);
        highlightRows = 0;
        expect(query.ids()).toEqual(expected);
        expect(highlightRows).toBe(0);
      }
    } finally { db.all = all; db.close(); rmSync(path, { recursive: true, force: true }); }
  });
});
