// Traverse logical primary records from an immutable private copy; physical slot IDs never enter the stream.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from './database.ts';
import { encodeLogicalSnapshot, type LogicalFieldKind, type LogicalRecord, type LogicalStreamOptions } from './logical-format.ts';
import type { SqliteValueLayout } from './values.ts';

type Entity = { id: string; type: string; seq: number; trashed: number; short_code: string | null };
const fail = (message: string): never => { throw Object.assign(new Error(message), { code: 'CORRUPT' }); };
const key = (id: string, field: string) => JSON.stringify([id, field]);

async function* values(db: SqliteDatabase, layout: SqliteValueLayout, ids: string[]): AsyncGenerator<LogicalRecord> {
  const fields = [...layout.fields], columns = fields.flatMap(([, slot]) => [`v.k${slot}`, `v.v${slot}`]);
  const input = JSON.stringify(ids);
  const native = db.all(`SELECT v.entity_id${columns.length ? ',' + columns.join(',') : ''}
    FROM json_each(?) seed JOIN ${layout.table} v ON v.entity_id=seed.value ORDER BY seed.key`, [input]);
  if (native.length !== ids.length) return fail('Missing authoritative entity values');
  const outside = new Set<string>(), inline = new Set<string>();
  for (const row of native) for (const [field, slot] of fields) {
    const kind = row[`k${slot}`] as string | null;
    if (kind === null) continue;
    const identity = key(row.entity_id, field);
    if (kind === '@') { outside.add(identity); continue; }
    db.values.validateCell(kind, row[`v${slot}`]); inline.add(identity);
    yield { kind: 'value', id: row.entity_id, field, storageKind: kind as LogicalFieldKind, value: row[`v${slot}`] };
  }
  for (const value of db.statement(`SELECT entity_id,field,kind,value FROM value_overflow
    WHERE entity_id IN (SELECT value FROM json_each(?)) ORDER BY entity_id,field`).iterate(input)) {
    const row = value as { entity_id: string; field: string; kind: LogicalFieldKind; value: null | string | number | Uint8Array };
    const identity = key(row.entity_id, row.field);
    if (inline.has(identity) || row.field === 'id' || row.field === 'entityType') return fail('Duplicate authoritative logical field');
    db.values.validateCell(row.kind, row.value); outside.delete(identity);
    yield { kind: 'value', id: row.entity_id, field: row.field, storageKind: row.kind, value: row.value };
  }
  if (outside.size) return fail('Missing authoritative overflow field');
}

async function* records(db: SqliteDatabase): AsyncGenerator<LogicalRecord> {
  if (db.get('SELECT 1 FROM entities WHERE seq<1 OR trashed NOT IN (0,1) LIMIT 1')) return fail('Invalid primary catalog');
  if (db.get('SELECT 1 FROM value_overflow o LEFT JOIN entities e ON e.id=o.entity_id WHERE e.id IS NULL LIMIT 1')) return fail('Orphan primary overflow value');
  const layouts = new Map<string, SqliteValueLayout>();
  for (const type of db.all('SELECT name FROM value_types ORDER BY name')) {
    const layout = db.values.layout(String(type.name));
    if (!layout) return fail('Missing logical value layout');
    if (db.get(`SELECT 1 FROM ${layout.table} v LEFT JOIN entities e ON e.id=v.entity_id AND e.type=? WHERE e.id IS NULL LIMIT 1`, [layout.name]))
      return fail('Orphan primary value row');
    layouts.set(layout.name, layout);
  }
  for (const value of db.statement('SELECT key,value FROM meta ORDER BY key').iterate()) {
    const row = value as { key: string; value: Uint8Array }; yield { kind: 'meta', key: row.key, value: row.value };
  }
  let after = 0;
  for (;;) {
    // Native inline pages are bounded by 16 rows and the admitted slot count; overflow values stream separately.
    const page = db.all('SELECT id,type,seq,trashed,short_code FROM entities WHERE seq>? ORDER BY seq LIMIT 16', [after]) as Entity[];
    if (!page.length) break;
    const groups = new Map<string, string[]>();
    for (const row of page) {
      yield { kind: 'entity', id: row.id, type: row.type, seq: row.seq, trashed: row.trashed === 1, shortCode: row.short_code };
      const ids = groups.get(row.type) ?? []; ids.push(row.id); groups.set(row.type, ids);
    }
    for (const [type, ids] of groups) {
      const layout = layouts.get(type); if (!layout) return fail('Missing authoritative value layout');
      yield* values(db, layout, ids);
    }
    after = page.at(-1)!.seq;
  }
  for (const value of db.statement('SELECT id,kind,source,target,seq,info FROM relations ORDER BY seq').iterate()) {
    const row = value as {id: string; kind: string; source: string; target: string; seq: number; info: Uint8Array | null};
    yield { kind: 'relation', id: row.id, relationKind: row.kind, source: row.source, target: row.target, seq: row.seq, info: row.info };
  }
  // Several derived generations may carry the same logical identity. Retain its latest populated version,
  // matching generation reuse, instead of serializing disposable acceleration history as primary versions.
  for (const value of db.statement(`SELECT c.entity_id,c.index_name,c.chunk,c.hash,c.model,c.dims,c.embedding FROM chunks c
    WHERE c.embedding IS NOT NULL AND c.generation=(SELECT max(n.generation) FROM chunks n
      WHERE n.entity_id=c.entity_id AND n.index_name=c.index_name AND n.chunk=c.chunk AND n.hash=c.hash
      AND n.model=c.model AND n.dims=c.dims AND n.embedding IS NOT NULL)
    ORDER BY c.entity_id,c.index_name,c.chunk,c.hash,c.model,c.dims`).iterate()) {
    const row = value as {entity_id: string; index_name: string; chunk: number; hash: string; model: string; dims: number; embedding: Uint8Array};
    yield { kind: 'embedding', id: row.entity_id, index: row.index_name, chunk: row.chunk, hash: row.hash,
      model: row.model, dimensions: row.dims, bytes: row.embedding };
  }
}

function cleanup(db: SqliteDatabase | undefined, root: string, failed: boolean, primary: unknown): void {
  const errors: unknown[] = [];
  try { db?.close(); } catch (error) { errors.push(error); }
  try { rmSync(root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(failed ? [primary, ...errors] : errors, 'Logical snapshot cleanup failed', { cause: failed ? primary : errors[0] });
}

/** Internal producer; caller owns backpressure and temporary/exclusive publication of the resulting bytes. */
export async function* exportLogicalSnapshot(source: SqliteDatabase, options: LogicalStreamOptions = {}): AsyncGenerator<Uint8Array> {
  const root = mkdtempSync(join(tmpdir(), 'ears-logical-export-'));
  let snapshot: SqliteDatabase | undefined, failed = false, failure: unknown;
  try {
    const path = join(root, 'snapshot');
    await source.withExclusiveWrites(async () => { source.backup(path); });
    snapshot = new SqliteDatabase({ path, readOnly: true });
    yield* encodeLogicalSnapshot(snapshot.sequence, records(snapshot), options);
  } catch (error) { failed = true; failure = error; throw error; }
  finally { cleanup(snapshot, root, failed, failure); }
}
