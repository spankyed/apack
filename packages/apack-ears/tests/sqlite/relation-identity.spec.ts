import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); }
});

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite relation identity work', () => {
  it('stops at a matching key and releases its cursor before mutation, refusal and exhaustion', () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-relation-key-work-'));
    const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({
      types: { Row: { required: [] } }, relations: { edge: { key: ['handle'] } }, roles: [],
    }) });
    held.push({ db, path });
    const e = createEarsEngine({ database: db }), a = e.create('Row', {}).id(), b = e.create('Row', {}).id();
    e.transact(() => { for (let i = 0; i < 128; i++)
      e.write(a).link('edge', b, { info: { handle: i, payload: 'large info '.repeat(512) } });
    });
    const original = e.findRelations();
    const statement = db.statement('SELECT * FROM relations WHERE kind=? AND source=? AND target=? AND id<>? ORDER BY seq');
    const iterate = statement.iterate.bind(statement);
    let rows = 0, active = 0;
    vi.spyOn(statement, 'iterate').mockImplementation(function* (...parameters) {
      active++;
      try { for (const row of iterate(...parameters)) { rows++; yield row; } }
      finally { active--; }
    });
    const run = db.run.bind(db);
    vi.spyOn(db, 'run').mockImplementation((sql, parameters = []) => {
      if (/^(INSERT INTO|UPDATE) relations/.test(sql)) expect(active).toBe(0);
      return run(sql, parameters);
    });
    e.write(a).link('edge', b, { info: { handle: 0, payload: 'updated' } });
    expect(rows).toBe(1); expect(active).toBe(0);
    expect(e.getRelation(original[0]!.id)?.info).toEqual({ handle: 0, payload: 'updated' });
    const sequence = e.lastCommit(); rows = 0;
    expect(() => e.updateRelation(original[1]!.id, { info: { handle: 0 } }))
      .toThrow(expect.objectContaining({ code: 'DUPLICATE_EDGE' }));
    expect(rows).toBe(1); expect(active).toBe(0); expect(e.lastCommit()).toBe(sequence);
    expect(e.getRelation(original[1]!.id)).toEqual(original[1]);
    rows = 0;
    e.write(a).link('edge', b, { info: { handle: 128 } });
    expect(rows).toBe(128); expect(active).toBe(0);
    expect(e.findRelations()).toHaveLength(129);
    e.write(a).set('title', 'connection remains writable');
  });
});
