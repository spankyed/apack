import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EARS } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { SqliteText } from '../../src/sqlite/text.ts';

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('native text pipeline scopes', () => {
  it('uses posting estimates without reevaluating the candidate prefix and still scopes actual matches', async () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-text-estimate-scope-'));
    const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: {
      Row: { required: [], search: { fields: { body: 1 } } },
    }, relations: {}, roles: [] }) });
    const get = db.get.bind(db); let planning = false, scopeVisits = 0;
    try {
      const e = createEarsEngine({ database: db }), ids: EARS.EntityId[] = [];
      e.transact(() => { for (let i = 0; i < 48; i++) ids.push(e.create('Row', { body: 'needle alpha' }).id()); });
      await db.indexesReady();
      const selected = ids.filter((_, i) => i % 2 === 0), expected = selected.slice(0, 5);
      db.sql.function('observe_advisory_scope', { deterministic: false }, (_value: unknown) => {
        if (planning) throw Error('An advisory count evaluated the candidate prefix');
        scopeVisits++; return 1;
      });
      db.get = (sql, parameters = []) => {
        const previous = planning; planning = sql.startsWith('SELECT count(*) n');
        try { return get(sql, parameters); } finally { planning = previous; }
      };
      const text = new SqliteText(db), job = db.indexBuilds.index('Row', 'text', 'search');
      const hits = text.search(job, {
        sql: 'SELECT value FROM json_each(?) WHERE observe_advisory_scope(value)',
        parameters: [JSON.stringify(selected)],
      }, 'needle alpha', { fuzzy: false }, true, 5);
      expect(hits.map(hit => hit.id)).toEqual(expected); expect(scopeVisits).toBeGreaterThan(0);
      expect(e.query.ids(selected).search('needle alpha', { fuzzy: false }).limit(5).ids()).toEqual(expected);
    } finally { db.get = get; db.close(); rmSync(path, { recursive: true, force: true }); }
  });

  it('returns only the selected page across the binding rather than all eligible IDs', async () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-text-scope-'));
    const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: {
      Row: { required: [], fields: { category: { type: 'string' } }, search: { fields: { body: 1 } } },
    }, relations: {}, roles: [] }) });
    try {
      const e = createEarsEngine({ database: db });
      e.transact(() => { for (let i = 0; i < 512; i++)
        e.create('Row', { id: `Row-${i}`, category: i % 2 ? 'other' : 'selected', body: 'needle' });
      });
      await db.indexesReady();
      const query = e.query('Row').where('category', 'selected').search('needle', { fuzzy: false }).limit(5);
      const expected = ['Row-0', 'Row-2', 'Row-4', 'Row-6', 'Row-8'];
      expect(query.ids()).toEqual(expected);
      const explained = query.explain();
      if (explained.backend !== 'sqlite') throw Error('Expected SQLite explanation');
      expect(explained.ids).toEqual(expected);
      expect(Math.max(0, ...explained.statements.map(statement => statement.returnedRows))).toBeLessThanOrEqual(5);
    } finally { db.close(); rmSync(path, { recursive: true, force: true }); }
  });

  it('discovers a single eligible type without visiting the entire candidate set', async () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-text-type-witness-'));
    const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({ types: {
      Row: { required: [], search: { fields: { body: 1 } } },
    }, relations: {}, roles: [] }) });
    try {
      const e = createEarsEngine({ database: db }), ids: EARS.EntityId[] = [];
      e.transact(() => { for (let i = 0; i < 512; i++) ids.push(e.create('Row', { body: 'needle' }).id()); });
      await db.indexesReady();
      let typeVisits = 0;
      db.sql.function('observe_type', { deterministic: false }, value => { typeVisits++; return value; });
      // The connection-local view counts actual type evaluations without changing authoritative data.
      db.sql.exec(`CREATE TEMP VIEW entities AS SELECT id,observe_type(type) type,seq,trashed,short_code FROM main.entities`);
      expect(e.query.ids(ids).search('needle', { fuzzy: false }).limit(5).ids()).toEqual(ids.slice(0, 5));
      expect(typeVisits).toBe(1);
      typeVisits = 0;
      expect(e.query.ids([]).search('needle', { fuzzy: false }).ids()).toEqual([]);
      expect(typeVisits).toBe(0);
    } finally { db.close(); rmSync(path, { recursive: true, force: true }); }
  });
});
