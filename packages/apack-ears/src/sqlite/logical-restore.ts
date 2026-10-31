// A sealed spool becomes an independently rebuilt/audited store; host replacement owns publication afterwards.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { SqliteDatabase } from './database.ts';
import { createSchemaValidator } from './schema-validation.ts';
import { auditSqliteDatabase, type SqliteAuditReport } from './audit.ts';
import type { SqliteValueLayout } from './values.ts';

export interface RestoredLogicalSnapshot { path: string; sequence: number; audit: SqliteAuditReport }
const refuse = (message: string, cause?: unknown): never => {
  throw Object.assign(new Error(message, { cause }), { code: 'DUMP_INVALID' });
};

/** Destination must not exist. A successful result is a closed, audited staging store, never a live replacement. */
export async function restoreLogicalStage(stage: string, destination: string,
  options: { syncs?: boolean } = {}): Promise<RestoredLogicalSnapshot> {
  // Neither an existing destination nor a caller-owned spool is ours to remove.
  mkdirSync(destination, { mode: 0o700 });
  let input: InstanceType<typeof NativeDatabase> | undefined, output: SqliteDatabase | undefined;
  let result: RestoredLogicalSnapshot | undefined, failed = false, failure: unknown;
  try {
    input = new NativeDatabase(join(stage, 'archive.sqlite3'), { readonly: true });
    input.exec('BEGIN'); // All validation/copy reads use one immutable spool snapshot.
    const seal = input.prepare("SELECT value FROM archive_state WHERE key='sealed'").get() as {value: number} | undefined;
    const head = input.prepare("SELECT value FROM archive_state WHERE key='sequence'").get() as {value: number} | undefined;
    if (seal?.value !== 1 || !head || !Number.isSafeInteger(head.value) || head.value < 0) refuse('Logical ingestion spool is not sealed');
    if (input.pragma('quick_check', { simple: true }) !== 'ok' || input.prepare('PRAGMA foreign_key_check').all().length)
      refuse('Logical ingestion spool fails SQLite integrity checks');
    output = new SqliteDatabase({ path: destination, syncs: options.syncs });
    output.indexBuilds.stop();
    const db = output;
    const metadata = (key: string): unknown => {
      const row = input!.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value: Uint8Array} | undefined;
      if (!row) return undefined;
      try { return db.unpack(row.value); } catch (cause) { return refuse(`Invalid logical metadata: ${key}`, cause); }
    };
    const schema = metadata('schema');
    if (schema !== undefined) createSchemaValidator()(schema);
    if ((metadata('commit') ?? 0) !== head!.value) refuse('Logical spool commit disagrees with its seal');
    const next = metadata('seq'), maximum = (input.prepare('SELECT coalesce(max(seq),0) n FROM identities').get() as {n: number}).n;
    if ((next !== undefined && (typeof next !== 'number' || !Number.isSafeInteger(next) || next < 1)) ||
      (maximum > 0 && (typeof next !== 'number' || next <= maximum))) refuse('Invalid logical identity counter');
    const layouts = new Map<string, SqliteValueLayout>();
    const layout = (type: string) => {
      let value = layouts.get(type);
      if (!value) {
        const fields = (schema as {types: Record<string, {fields?: object}>} | undefined)?.types[type]?.fields ?? {};
        value = db.values.declare(type, ['createdAt','updatedAt','trashedAt','shortCode','role', ...Object.keys(fields)]);
        layouts.set(type, value);
      }
      return value;
    };
    db.sql.exec('BEGIN IMMEDIATE');
    for (const value of input.prepare('SELECT key,value FROM meta ORDER BY key').iterate()) {
      const row = value as {key: string; value: Uint8Array};
      // Decode every metadata value now, including application counters not used by this importer.
      metadata(row.key); db.run('INSERT OR REPLACE INTO meta VALUES (?,?)', [row.key,row.value]);
    }
    // Empty declared types also need layouts when the reopened owner admits their indexes.
    if (schema) for (const type of Object.keys((schema as {types: object}).types)) layout(type);
    for (const value of input.prepare('SELECT id,type,seq,trashed,short_code FROM entities ORDER BY seq').iterate()) {
      const row = value as {id: string; type: string; seq: number; trashed: number; short_code: string | null};
      if (!/^[A-Z][A-Za-z0-9]*$/.test(row.type) || row.type === 'Relation' || !row.id.startsWith(row.type + '-') ||
        row.id.length === row.type.length + 1 || !Number.isSafeInteger(row.seq) || row.seq < 1 || ![0,1].includes(row.trashed))
        refuse('Invalid logical entity identity');
      db.run('INSERT INTO entities VALUES (?,?,?,?,?)', [row.id,row.type,row.seq,row.trashed,row.short_code]);
      db.run(`INSERT INTO ${layout(row.type).table}(entity_id) VALUES (?)`, [row.id]);
    }
    for (const value of input.prepare(`SELECT v.entity_id,e.type,v.field,v.kind,v.value FROM logical_values v
      JOIN entities e ON e.id=v.entity_id ORDER BY v.entity_id,v.field`).iterate()) {
      const row = value as {entity_id: string; type: string; field: string; kind: string; value: null | string | number | Uint8Array};
      db.values.restoreCell(layout(row.type), row.entity_id, row.field, row.kind, row.value);
    }
    // Catalog facts are redundant with reserved logical fields; never normalize conflicting archive records.
    if (input.prepare(`SELECT 1 FROM entities e
      LEFT JOIN logical_values t ON t.entity_id=e.id AND t.field='trashedAt'
      LEFT JOIN logical_values s ON s.entity_id=e.id AND s.field='shortCode'
      WHERE e.trashed!=(t.entity_id IS NOT NULL) OR (e.short_code IS NULL)!=(s.entity_id IS NULL)
        OR (e.short_code IS NOT NULL AND (s.kind!='text' OR s.value IS NOT e.short_code)) LIMIT 1`).get())
      refuse('Logical catalog disagrees with reserved primary fields');
    for (const value of input.prepare('SELECT id,kind,source,target,seq,info FROM relations ORDER BY seq').iterate()) {
      const row = value as {id: string; kind: string; source: string; target: string; seq: number; info: Uint8Array | null};
      if (!row.id.startsWith('Relation-') || row.id === 'Relation-' || !Number.isSafeInteger(row.seq) || row.seq < 1)
        refuse('Invalid logical relation identity');
      if (row.info !== null) db.unpack(row.info);
      db.run('INSERT INTO relations VALUES (?,?,?,?,?,?)', [row.id,row.kind,row.source,row.target,row.seq,row.info]);
    }
    for (const value of input.prepare('SELECT entity_id,index_name,chunk,hash,model,dims,embedding FROM embeddings ORDER BY entity_id,index_name,chunk,hash,model,dims').iterate()) {
      const row = value as {entity_id: string; index_name: string; chunk: number; hash: string; model: string; dims: number; embedding: Uint8Array};
      db.embeddings.restore({ id: row.entity_id, index: row.index_name, chunk: row.chunk, hash: row.hash,
        model: row.model, dimensions: row.dims, bytes: row.embedding });
    }
    db.commitWrite(); db.close(); output = undefined;
    // A fresh owner validates the stored declaration and derives current indexes from imported primary data.
    output = new SqliteDatabase({ path: destination, syncs: options.syncs });
    await output.indexesReady();
    const audit = await auditSqliteDatabase(output);
    if (!audit.ok) refuse('Restored logical snapshot failed semantic audit', audit);
    if (output.sequence !== head!.value) refuse('Restoration changed logical commit identity');
    result = { path: destination, sequence: head!.value, audit };
  } catch (error) { failed = true; failure = error; }
  const cleanup: unknown[] = [];
  try { output?.close(); } catch (error) { cleanup.push(error); }
  try { input?.close(); } catch (error) { cleanup.push(error); }
  if (failed || cleanup.length) try { rmSync(destination, { recursive: true, force: true }); } catch (error) { cleanup.push(error); }
  if (cleanup.length) throw Object.assign(new AggregateError(failed ? [failure, ...cleanup] : cleanup,
    'Logical store restoration cleanup failed', { cause: failed ? failure : cleanup[0] }), { code: (failure as {code?: unknown})?.code });
  if (failed) throw failure;
  return result!;
}
