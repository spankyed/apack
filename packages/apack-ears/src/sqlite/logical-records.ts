// Lossless logical primary traversal shared by archive export and transactional replacement.
import type { SqliteDatabase } from './database.ts';
import type { LogicalFieldKind, LogicalRecord } from './logical-format.ts';
import type { SqliteValueLayout } from './values.ts';
import { validateEmbeddingBytes } from './embeddings.ts';

type Entity = { id: string; type: string; seq: number; trashed: number; short_code: string | null };
const fail = (message: string): never => { throw Object.assign(new Error(message), { code: 'CORRUPT' }); };
const key = (id: string, field: string) => JSON.stringify([id, field]);

export function* logicalValues(db: SqliteDatabase, layout: SqliteValueLayout, ids: string[]): Generator<Extract<LogicalRecord, {kind: 'value'}>> {
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

export function* logicalRecords(db: SqliteDatabase): Generator<LogicalRecord> {
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
      yield* logicalValues(db, layout, ids);
    }
    after = page.at(-1)!.seq;
  }
  for (const value of db.statement('SELECT id,kind,source,target,seq,info FROM relations ORDER BY seq').iterate()) {
    const row = value as {id: string; kind: string; source: string; target: string; seq: number; info: Uint8Array | null};
    yield { kind: 'relation', id: row.id, relationKind: row.kind, source: row.source, target: row.target, seq: row.seq, info: row.info };
  }
  // Primary embedding identities survive derived retirement and declaration changes.
  for (const value of db.statement(`SELECT entity_id,index_name,chunk,hash,model,dims,embedding FROM embedding_values
    ORDER BY entity_id,index_name,chunk,hash,model,dims`).iterate()) {
    const row = value as {entity_id: string; index_name: string; chunk: number; hash: string; model: string; dims: number; embedding: Uint8Array};
    validateEmbeddingBytes(row.embedding, row.dims);
    yield { kind: 'embedding', id: row.entity_id, index: row.index_name, chunk: row.chunk, hash: row.hash,
      model: row.model, dimensions: row.dims, bytes: row.embedding };
  }
}

