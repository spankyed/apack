// Untrusted archive records land in a newly owned spool; only a fully verified stream receives a seal.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { Unpackr } from 'msgpackr';
import { decodeLogicalSnapshot, type LogicalHeader, type LogicalRecord, type LogicalStreamOptions } from './logical-format.ts';

export interface LogicalStage {
  path: string;
  sequence: number;
  counts: Record<LogicalRecord['kind'], number>;
}
const refuse = (message: string, cause?: unknown): never => {
  throw Object.assign(new Error(message, { cause }), { code: 'DUMP_INVALID' });
};
const bind = (value: null | string | number | Uint8Array) => value instanceof Uint8Array ? Buffer.from(value) : value;

/** The destination must not exist. This is a sealed ingestion spool, not a restored or published app store. */
export async function stageLogicalSnapshot(chunks: AsyncIterable<Uint8Array>, destination: string,
  options: LogicalStreamOptions = {}): Promise<LogicalStage> {
  // Reservation occurs before taking ownership; never remove a caller's existing directory on refusal.
  mkdirSync(destination, { mode: 0o700 });
  let db: InstanceType<typeof NativeDatabase> | undefined;
  const decoded = decodeLogicalSnapshot(chunks, options);
  let result: LogicalStage | undefined, failed = false, failure: unknown;
  try {
    db = new NativeDatabase(join(destination, 'archive.sqlite3'));
    db.pragma('foreign_keys=ON'); db.pragma('journal_mode=DELETE'); db.pragma('synchronous=FULL');
    db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY COLLATE BINARY,value BLOB NOT NULL);
      CREATE TABLE identities(seq INTEGER PRIMARY KEY);
      CREATE TABLE entities(id TEXT PRIMARY KEY COLLATE BINARY,type TEXT NOT NULL,seq INTEGER NOT NULL UNIQUE,
        trashed INTEGER NOT NULL,short_code TEXT UNIQUE);
      CREATE TABLE logical_values(entity_id TEXT NOT NULL REFERENCES entities(id),field TEXT NOT NULL COLLATE BINARY,
        kind TEXT NOT NULL,value,PRIMARY KEY(entity_id,field));
      CREATE TABLE relations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,source TEXT NOT NULL REFERENCES entities(id),
        target TEXT NOT NULL REFERENCES entities(id),seq INTEGER NOT NULL UNIQUE,info BLOB,weight BLOB);
      CREATE TABLE embeddings(entity_id TEXT NOT NULL REFERENCES entities(id),index_name TEXT NOT NULL,chunk INTEGER NOT NULL,
        hash TEXT NOT NULL,model TEXT NOT NULL,dims INTEGER NOT NULL,embedding BLOB NOT NULL,
        PRIMARY KEY(entity_id,index_name,chunk,hash,model,dims));
      CREATE TABLE archive_state(key TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
    const statements = {
      meta: db.prepare('INSERT INTO meta VALUES (?,?)'), identity: db.prepare('INSERT INTO identities VALUES (?)'),
      entity: db.prepare('INSERT INTO entities VALUES (?,?,?,?,?)'), value: db.prepare('INSERT INTO logical_values VALUES (?,?,?,?)'),
      relation: db.prepare('INSERT INTO relations(id,kind,source,target,seq,info,weight) VALUES (?,?,?,?,?,?,?)'), embedding: db.prepare('INSERT INTO embeddings VALUES (?,?,?,?,?,?,?)'),
    };
    const counts: LogicalStage['counts'] = { meta: 0, entity: 0, value: 0, relation: 0, embedding: 0 };
    let header: LogicalHeader | undefined;
    db.exec('BEGIN IMMEDIATE');
    for (;;) {
      const next = await decoded.next();
      if (next.done) break; // The decoder verifies count/hash, footer and trailing EOF before returning done.
      const row = next.value;
      if (row.kind === 'header') { if (header) refuse('Duplicate logical archive header'); header = row; continue; }
      try {
        switch (row.kind) {
          case 'meta': statements.meta.run(row.key, Buffer.from(row.value)); break;
          case 'entity':
            statements.identity.run(row.seq); statements.entity.run(row.id, row.type, row.seq, Number(row.trashed), row.shortCode); break;
          case 'value': statements.value.run(row.id, row.field, row.storageKind, bind(row.value)); break;
          case 'relation':
            statements.identity.run(row.seq); statements.relation.run(row.id, row.relationKind, row.source, row.target, row.seq, row.info === null ? null : Buffer.from(row.info), row.weight === null ? null : Buffer.from(row.weight)); break;
          case 'embedding': statements.embedding.run(row.id, row.index, row.chunk, row.hash, row.model, row.dimensions, Buffer.from(row.bytes)); break;
        }
      } catch (error) {
        if (String((error as { code?: unknown })?.code).startsWith('SQLITE_CONSTRAINT')) refuse('Conflicting or inconsistent logical archive identity', error);
        throw error;
      }
      counts[row.kind]++;
    }
    if (!header) return refuse('Missing logical archive header');
    const unpacker = new Unpackr({ useRecords: false, mapsAsObjects: false, int64AsType: 'number' });
    const meta = (key: string): unknown => {
      const row = db!.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value: Uint8Array} | undefined;
      if (!row) return undefined;
      try { return unpacker.unpack(row.value); } catch (error) { return refuse('Invalid logical archive metadata encoding', error); }
    };
    const storedCommit = meta('commit'), commit = storedCommit === undefined ? 0 : storedCommit;
    if (commit !== header.sequence) refuse('Archive commit metadata does not match its header');
    const nextIdentity = meta('seq'), revision = meta('schemaRevision');
    const maximum = (db.prepare('SELECT coalesce(max(seq),0) n FROM identities').get() as {n: number}).n;
    if ((nextIdentity !== undefined && (typeof nextIdentity !== 'number' || !Number.isSafeInteger(nextIdentity) || nextIdentity < 1)) ||
        (maximum > 0 && (typeof nextIdentity !== 'number' || nextIdentity <= maximum))) refuse('Invalid logical archive identity counter');
    if (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) refuse('Invalid archive schema revision');
    db.prepare('INSERT INTO archive_state VALUES (?,?)').run('sequence', header.sequence);
    db.prepare('INSERT INTO archive_state VALUES (?,?)').run('sealed', 1);
    db.exec('COMMIT');
    result = { path: destination, sequence: header.sequence, counts };
  } catch (error) { failed = true; failure = error; }
  const cleanup: unknown[] = [];
  try { await decoded.return(undefined); } catch (error) { cleanup.push(error); }
  if (db?.inTransaction) try { db.exec('ROLLBACK'); } catch (error) { cleanup.push(error); }
  try { db?.close(); } catch (error) { cleanup.push(error); }
  if (failed || cleanup.length) try { rmSync(destination, { recursive: true, force: true }); } catch (error) { cleanup.push(error); }
  if (cleanup.length) throw Object.assign(new AggregateError(failed ? [failure, ...cleanup] : cleanup,
    'Logical archive staging cleanup failed', { cause: failed ? failure : cleanup[0] }), { code: (failure as {code?: unknown})?.code });
  if (failed) throw failure;
  return result!;
}
