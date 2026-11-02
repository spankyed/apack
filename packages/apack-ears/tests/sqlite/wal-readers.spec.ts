import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine } from '../../src/index.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';
import { toElmdbSchema } from '../../src/schema.ts';

const stores: SqliteDatabase[] = [];
const paths: string[] = [];
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite retained readers', () => {
  it('keeps a pinned snapshot while writes grow WAL, then permits truncation after release', () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-wal-reader-')); paths.push(path);
    const writer = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema({
      types: { Row: { required: [] } }, relations: {}, roles: [],
    }) }); stores.push(writer);
    const e = createEarsEngine({ database: writer });
    e.create('Row', { id: 'Row-before' });
    writer.all('PRAGMA wal_checkpoint(TRUNCATE)');
    writer.sql.exec('PRAGMA wal_autocheckpoint=0');
    const reader = new SqliteDatabase({ path, readOnly: true }); stores.push(reader);
    // Hold a real SQLite read transaction, as a separate long-lived reader would. EARS readSync
    // normally releases its snapshot before returning, so it cannot model this retained reader.
    reader.sql.exec('BEGIN');
    try {
      expect(reader.get('SELECT count(*) n FROM entities')!.n).toBe(1);
      for (let i = 0; i < 16; i++) e.create('Row', { id: `Row-new-${i}`, body: 'x'.repeat(32768) });
      expect(e.query('Row').count()).toBe(17);
      expect(reader.get('SELECT count(*) n FROM entities')!.n).toBe(1);
      const before = statSync(join(path, 'data.sqlite3-wal')).size;
      expect(before).toBeGreaterThan(16 * 32768);
      const blocked = writer.all('PRAGMA wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>;
      expect(blocked[0]!.busy).toBe(1);
      expect(blocked[0]!.checkpointed).toBeLessThan(blocked[0]!.log);
      expect(statSync(join(path, 'data.sqlite3-wal')).size).toBe(before);
    } finally { reader.sql.exec('ROLLBACK'); }
    expect(reader.get('SELECT count(*) n FROM entities')!.n).toBe(17);
    const released = writer.all('PRAGMA wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    expect(released[0]!.busy).toBe(0);
    expect(statSync(join(path, 'data.sqlite3-wal')).size).toBe(0);
    expect(e.query('Row').count()).toBe(17);
  });
});
