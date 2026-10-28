import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => {
  for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); }
  vi.restoreAllMocks();
});
const schema: EngineSchema = {
  types: {
    Row: { required: [], fields: { rank: { type: 'number' }, body: { type: 'string' } } },
    Other: { required: [], fields: { body: { type: 'string' }, rank: { type: 'number' } } },
  }, relations: {}, roles: [],
};
function open() {
  const path = mkdtempSync(join(tmpdir(), 'ears-query-cost-'));
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema(schema) });
  held.push({ db, path });
  return { db, e: createEarsEngine({ database: db }) };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite ordering work', () => {
  it('orders a small field without loading unrelated bodies or issuing per-entity SQL', () => {
    const { db, e } = open();
    e.transact(() => {
      for (let i = 0; i < 256; i++) e.create('Row', { id: `Row-${i}`, rank: 255 - i, body: 'large body '.repeat(1600) });
    });
    const read = vi.spyOn(db.values, 'read');
    const explained = e.query('Row').orderBy('rank').limit(10).explain();
    expect(explained.ids).toEqual(Array.from({ length: 10 }, (_, i) => `Row-${255 - i}`));
    expect(explained.backend).toBe('sqlite');
    if (explained.backend === 'sqlite') expect(explained.statementCount).toBeLessThanOrEqual(16);
    expect(read.mock.calls.every(call => call[2] !== undefined && !call[2].includes('body'))).toBe(true);
  });

  it('preserves stable input order and duplicate ids across different physical type layouts', () => {
    const { e } = open();
    e.transact(() => {
      e.create('Row', { id: 'Row-a', rank: 2, body: 'row' });
      e.create('Row', { id: 'Row-b', rank: 1, body: 'row' });
      e.create('Other', { id: 'Other-a', rank: 1, body: 'other' });
      e.create('Other', { id: 'Other-b', rank: 2, body: 'other' });
    });
    const ids = ['Other-b', 'Row-b', 'Other-a', 'Row-a', 'Row-b'] as const;
    expect(e.query.ids(ids).orderBy('rank').ids()).toEqual(['Row-b', 'Other-a', 'Row-b', 'Other-b', 'Row-a']);
    expect(e.query.ids(ids).orderBy('rank', 'desc').ids()).toEqual(['Other-b', 'Row-a', 'Row-b', 'Other-a', 'Row-b']);
  });
});
