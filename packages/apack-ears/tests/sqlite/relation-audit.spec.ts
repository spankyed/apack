import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { auditSqliteDatabase } from '../../src/sqlite/audit.ts';
import * as identity from '../../src/sqlite/relation-identity.ts';

const held: Array<{ db: SqliteDatabase; path: string }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const { db, path } of held.splice(0)) { db.close(); rmSync(path, { recursive: true, force: true }); }
});
function fixture(count = 128) {
  const path = mkdtempSync(join(tmpdir(), 'ears-relation-audit-'));
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({
    types: { Row: { required: [] } }, relations: { edge: { key: ['slot'] } }, roles: [],
  }) });
  held.push({ db, path });
  const e = createEarsEngine({ database: db }), source = e.create('Row', {}).id(), target = e.create('Row', {}).id();
  db.bulkLoad(Array.from({ length: count }, (_, i) => ({
    load: 'relation' as const, id: `Relation-${i}`, kind: 'edge', source, target, info: { slot: { a: i, b: 2 } },
  })));
  return { db, e, source, target };
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite relation audit grouping', () => {
  it('groups distinct keys on disk and compares only colliding fingerprints without changing source data', async () => {
    const { db, e, source, target } = fixture(512);
    const same = vi.spyOn(identity, 'sameRelationKey');
    const before = db.all('SELECT * FROM relations ORDER BY seq'), sequence = e.lastCommit();
    expect(await auditSqliteDatabase(db)).toMatchObject({ ok: true, checkedRelations: 512 });
    expect(same).not.toHaveBeenCalled();
    expect(db.all('SELECT * FROM relations ORDER BY seq')).toEqual(before); expect(e.lastCommit()).toBe(sequence);
    db.bulkLoad([{ load: 'relation', id: 'Relation-duplicate', kind: 'edge', source, target,
      info: { slot: { b: 2, a: 17 } } }]);
    same.mockClear();
    const duplicateState = db.all('SELECT * FROM relations ORDER BY seq'), duplicateSequence = e.lastCommit();
    const report = await auditSqliteDatabase(db);
    expect(report.ok).toBe(false); expect(report.issues.some(issue => issue.includes('duplicate relation identity'))).toBe(true);
    expect(same).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT * FROM relations ORDER BY seq')).toEqual(duplicateState); expect(e.lastCommit()).toBe(duplicateSequence);
  });

  it('checks existing equality after forced fingerprint collisions instead of inventing duplicates', async () => {
    const { db } = fixture(32);
    vi.spyOn(identity, 'relationKeyFingerprint').mockReturnValue('forced-collision');
    const same = vi.spyOn(identity, 'sameRelationKey');
    expect(await auditSqliteDatabase(db)).toMatchObject({ ok: true, checkedRelations: 32 });
    expect(same).toHaveBeenCalledTimes(32 * 31 / 2);
  });

  it('closes and removes a failed private identity spool while preserving the original error and writable source', async () => {
    const { db, e } = fixture(4), sequence = e.lastCommit();
    const failure = Object.assign(new Error('private spool setup failed'), { code: 'SQLITE_IOERR' });
    const exec = NativeDatabase.prototype.exec; let scratch: string | undefined;
    const fault = vi.spyOn(NativeDatabase.prototype, 'exec').mockImplementation(function (this: InstanceType<typeof NativeDatabase>, sql) {
      const result = exec.call(this, sql);
      if (sql.includes('CREATE TABLE identities')) { scratch = dirname(this.name); throw failure; }
      return result;
    });
    await expect(auditSqliteDatabase(db)).rejects.toBe(failure); fault.mockRestore();
    expect(scratch).toBeDefined(); expect(existsSync(scratch!)).toBe(false); expect(e.lastCommit()).toBe(sequence);
    e.create('Row', { title: 'still writable' });
  });

  it('buckets persisted key values consistently with existing equality and skips nonreflexive decoded keys', () => {
    const { db } = fixture(0);
    const values = [undefined, null, false, true, 0, -0, 1, '1', '', [], [undefined], [null], [1, 2], [2, 1],
      {}, { a: undefined }, { a: 1, b: 2 }, { b: 2, a: 1 }, new Uint8Array([1]), Buffer.from([1]),
      new Uint8Array([1, 2]), new Date(0), new Date(1), Object.fromEntries([['__proto__', { x: 1 }]])];
    for (const a of values) for (const b of values) {
      const left = db.unpack(db.pack({ slot: a })), right = db.unpack(db.pack({ slot: b }));
      const equal = identity.sameRelationKey(['slot'], left, right);
      const x = identity.relationKeyFingerprint(['slot'], left), y = identity.relationKeyFingerprint(['slot'], right);
      if (equal) expect(x).toBe(y); else expect(x).not.toBe(y);
    }
    const dense = db.unpack(db.pack({ slot: [, 1] })).slot as unknown[];
    expect(Object.hasOwn(dense, 0)).toBe(true);
    const left = db.unpack(db.pack({ slot: { nested: NaN } })), right = db.unpack(db.pack({ slot: { nested: NaN } }));
    expect(identity.sameRelationKey(['slot'], left, right)).toBe(false);
    expect(identity.relationKeyFingerprint(['slot'], left)).toBeUndefined();
  });
});
