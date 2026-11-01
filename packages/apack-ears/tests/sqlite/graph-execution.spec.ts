import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EARS } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); }
});

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite graph execution', () => {
  it.each([16, 256])('batches a width-%i frontier and closes an early-return cursor before the next write', width => {
    const path = mkdtempSync(join(tmpdir(), 'ears-graph-execution-'));
    const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({
      types: { Row: { required: [] } }, relations: { refs: {} }, roles: [],
    }) });
    held.push({ db, path });
    const e = createEarsEngine({ database: db });
    const root = e.create('Row').id(), target = e.create('Row').id();
    const children: EARS.EntityId[] = [];
    e.transact(() => {
      for (let i = 0; i < width; i++) {
        const child = e.create('Row').id(); children.push(child);
        e.write(root).link('refs', child);
        e.write(child).link('refs', target);
      }
    });
    const all = vi.spyOn(db, 'all');
    const explained = e.query.ids(root).pathTo(target, 'refs').explain();
    expect(explained.ids).toEqual([root, children[0], target]);
    if (explained.backend !== 'sqlite') throw Error('Expected SQLite diagnostics');
    const adjacency = explained.statements.filter(statement => statement.sql.includes('seed.value parent'));
    expect(adjacency).toHaveLength(2);
    // The second layer stops at the first match instead of bringing every duplicate edge into JS.
    expect(adjacency.map(statement => statement.returnedRows)).toEqual([width, 1]);
    expect(explained.statementCount).toBeLessThanOrEqual(24);
    expect(all.mock.calls.some(([sql]) => sql.includes('seed.value parent'))).toBe(false);
    expect(adjacency.flatMap(statement => statement.plan).some(row =>
      /SEARCH r USING(?: COVERING)? INDEX [^(]+\(source=\?/.test(row.detail))).toBe(true);
    // The synchronous path answer must release its cursor before subsequent transactions.
    expect(() => e.write(root).set('afterPath', true)).not.toThrow();
    expect(e.getAttr(root, 'afterPath')).toBe(true);
    expect(e.query.ids(root).descendants('refs', undefined, { depth: 1 }).ids()).toEqual(children);
  });
});
